import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authPasswordSchema, changePasswordSchema, type AuthStatus } from '@budget/shared';
import type { Db } from '../db/index.ts';
import { sessions, settings } from '../db/schema.ts';
import { HttpError } from '../http-error.ts';

export const SESSION_COOKIE = 'budget_session';
const SESSION_DAYS = 90;
const PASSWORD_KEY = 'password_hash';

// Όριο σε λάθος κωδικούς: 5 ανά 15 λεπτά ανά διεύθυνση
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60_000;

/** scrypt με τυχαίο salt: "scrypt$<salt>$<hash>" */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('base64url');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');

/**
 * Σύνδεση με κωδικό για έναν χρήστη. Με `enabled: false` (tests, δοκιμές στο UI με AUTH=off) όλα είναι ανοιχτά.
 * Η συνεδρία είναι cookie (httpOnly) με τυχαίο token. Στη βάση αποθηκεύεται μόνο το hash του.
 */
export function authRoutes(app: FastifyInstance, db: Db, { enabled }: { enabled: boolean }) {
  const failures = new Map<string, { count: number; first: number }>();

  const passwordHash = () => db.select().from(settings).where(eq(settings.key, PASSWORD_KEY)).get()?.value;

  const isAuthenticated = (req: FastifyRequest) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return false;
    const session = db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token))).get();
    return !!session && session.expiresAt > new Date().toISOString();
  };

  const startSession = (req: FastifyRequest, reply: FastifyReply) => {
    const token = randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    db.delete(sessions).where(lt(sessions.expiresAt, new Date().toISOString())).run();
    db.insert(sessions).values({ tokenHash: hashToken(token), expiresAt: expires.toISOString() }).run();
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      // Πίσω από το «tailscale serve» το request έρχεται τοπικά, αλλά ο browser βλέπει https
      secure: req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https',
      expires,
    });
  };

  /** Μετράει τις λάθος προσπάθειες. Μετά από 5 μέσα σε 15 λεπτά, 429. */
  const checkRateLimit = (req: FastifyRequest) => {
    const entry = failures.get(req.ip);
    if (entry && Date.now() - entry.first < FAILURE_WINDOW_MS && entry.count >= MAX_FAILURES) {
      throw new HttpError(429, 'Πολλές λάθος προσπάθειες. Δοκίμασε ξανά σε 15 λεπτά.');
    }
  };
  const recordFailure = (req: FastifyRequest) => {
    const entry = failures.get(req.ip);
    if (!entry || Date.now() - entry.first >= FAILURE_WINDOW_MS) failures.set(req.ip, { count: 1, first: Date.now() });
    else entry.count += 1;
  };

  // Όλο το /api/ θέλει σύνδεση, εκτός από το /api/auth/
  app.addHook('onRequest', async (req, reply) => {
    if (!enabled || !req.url.startsWith('/api/') || req.url.startsWith('/api/auth/')) return;
    if (!isAuthenticated(req)) return reply.code(401).send({ error: 'Χρειάζεται σύνδεση' });
  });

  app.get('/api/auth/status', (req): AuthStatus => {
    if (!enabled) return { enabled: false, configured: true, authenticated: true };
    return { enabled: true, configured: !!passwordHash(), authenticated: isAuthenticated(req) };
  });

  // Πρώτη φορά: ορισμός κωδικού (μόνο αν δεν υπάρχει ήδη)
  app.post('/api/auth/setup', (req, reply) => {
    const { password } = authPasswordSchema.parse(req.body);
    if (passwordHash()) throw new HttpError(409, 'Ο κωδικός έχει ήδη οριστεί');
    db.insert(settings).values({ key: PASSWORD_KEY, value: hashPassword(password) }).run();
    startSession(req, reply);
    return reply.code(204).send();
  });

  app.post('/api/auth/login', (req, reply) => {
    checkRateLimit(req);
    const { password } = authPasswordSchema.parse(req.body);
    const stored = passwordHash();
    if (!stored || !verifyPassword(password, stored)) {
      recordFailure(req);
      throw new HttpError(401, 'Λάθος κωδικός');
    }
    failures.delete(req.ip);
    startSession(req, reply);
    return reply.code(204).send();
  });

  app.post('/api/auth/logout', (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  // Αλλαγή κωδικού: αποσυνδέει όλες τις άλλες συσκευές
  app.post('/api/auth/password', (req, reply) => {
    if (enabled && !isAuthenticated(req)) throw new HttpError(401, 'Χρειάζεται σύνδεση');
    checkRateLimit(req);
    const { current, next } = changePasswordSchema.parse(req.body);
    const stored = passwordHash();
    if (!stored || !verifyPassword(current, stored)) {
      recordFailure(req);
      throw new HttpError(401, 'Λάθος τρέχων κωδικός');
    }
    db.transaction(tx => {
      tx.update(settings).set({ value: hashPassword(next) }).where(eq(settings.key, PASSWORD_KEY)).run();
      tx.delete(sessions).run();
    });
    startSession(req, reply);
    return reply.code(204).send();
  });
}

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthStatus } from '@budget/shared';
import { buildApp } from './app.ts';
import { dailyBackup } from './backup.ts';
import { openDb } from './db/index.ts';
import { fakeMarket } from './market/fake-market.ts';
import { hashPassword, verifyPassword } from './routes/auth.ts';

let app: ReturnType<typeof buildApp>;
let cookie = '';

async function api<T = unknown>(method: 'GET' | 'POST', url: string, payload?: object) {
  const res = await app.inject({ method, url, payload, headers: cookie ? { cookie } : {} });
  const setCookie = res.headers['set-cookie'];
  if (setCookie) cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0]!;
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T, setCookie };
}

beforeEach(() => {
  cookie = '';
  app = buildApp(openDb(':memory:'), { market: fakeMarket(), auth: true });
});

describe('passwords', () => {
  it('hashes with a salt and verifies', () => {
    const a = hashPassword('μυστικό123');
    expect(a).not.toBe(hashPassword('μυστικό123'));
    expect(verifyPassword('μυστικό123', a)).toBe(true);
    expect(verifyPassword('λάθος', a)).toBe(false);
  });
});

describe('auth', () => {
  it('requires setting a password first, then a session for every /api call', async () => {
    expect((await api<AuthStatus>('GET', '/api/auth/status')).body).toEqual({ enabled: true, configured: false, authenticated: false });
    expect((await api('GET', '/api/accounts')).status).toBe(401);
    expect((await api('POST', '/api/auth/setup', { password: '123' })).status).toBe(400);

    const setup = await api('POST', '/api/auth/setup', { password: 'σωστός-κωδικός' });
    expect(setup.status).toBe(204);
    expect(String(setup.setCookie)).toContain('HttpOnly');
    expect((await api<AuthStatus>('GET', '/api/auth/status')).body).toMatchObject({ configured: true, authenticated: true });
    expect((await api('GET', '/api/accounts')).status).toBe(200);
    // Ο κωδικός ορίζεται μία φορά
    expect((await api('POST', '/api/auth/setup', { password: 'άλλος-κωδικός' })).status).toBe(409);

    await api('POST', '/api/auth/logout');
    cookie = '';
    expect((await api('GET', '/api/accounts')).status).toBe(401);
    expect((await api('POST', '/api/auth/login', { password: 'λάθος-κωδικός' })).status).toBe(401);
    expect((await api('POST', '/api/auth/login', { password: 'σωστός-κωδικός' })).status).toBe(204);
    expect((await api('GET', '/api/accounts')).status).toBe(200);
  });

  it('blocks after 5 wrong passwords', async () => {
    await api('POST', '/api/auth/setup', { password: 'σωστός-κωδικός' });
    cookie = '';
    for (let i = 0; i < 5; i++) expect((await api('POST', '/api/auth/login', { password: `λάθος-${i}-κωδικός` })).status).toBe(401);
    const blocked = await api<{ error: string }>('POST', '/api/auth/login', { password: 'σωστός-κωδικός' });
    expect(blocked.status).toBe(429);
  });

  it('changing the password signs out other devices', async () => {
    await api('POST', '/api/auth/setup', { password: 'πρώτος-κωδικός' });
    const other = cookie;
    await api('POST', '/api/auth/login', { password: 'πρώτος-κωδικός' });
    expect((await api('POST', '/api/auth/password', { current: 'λάθος', next: 'δεύτερος-κωδικός' })).status).toBe(401);
    expect((await api('POST', '/api/auth/password', { current: 'πρώτος-κωδικός', next: 'δεύτερος-κωδικός' })).status).toBe(204);
    expect((await api('GET', '/api/accounts')).status).toBe(200);
    const mine = cookie;
    cookie = other;
    expect((await api('GET', '/api/accounts')).status).toBe(401);
    cookie = mine;
    expect((await api('POST', '/api/auth/login', { password: 'δεύτερος-κωδικός' })).status).toBe(204);
  });

  it('is open when disabled (tests, AUTH=off)', async () => {
    app = buildApp(openDb(':memory:'), { market: fakeMarket() });
    expect((await api<AuthStatus>('GET', '/api/auth/status')).body).toEqual({ enabled: false, configured: true, authenticated: true });
    expect((await api('GET', '/api/accounts')).status).toBe(200);
  });
});

describe('serving the app', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'budget-static-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Budget</title>');
    app = buildApp(openDb(':memory:'), { market: fakeMarket(), auth: true, staticDir: dir });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('serves index.html for app routes without login, but not for /api', async () => {
    const page = await app.inject({ method: 'GET', url: '/month/2026-11' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<title>Budget</title>');
    expect((await app.inject({ method: 'GET', url: '/api/nope' })).statusCode).toBe(401);
  });
});

describe('daily backups', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'budget-daily-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes one backup per day and keeps the latest ones', () => {
    const db = openDb(':memory:');
    const backups = join(dir, 'backups');
    mkdirSync(backups);
    writeFileSync(join(backups, 'budget-reset.db'), 'x');
    for (const date of ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']) {
      expect(dailyBackup(db, backups, 3, date)).toBe(join(backups, `daily-${date}.db`));
    }
    // Ίδια μέρα: δεν ξαναγράφεται
    expect(dailyBackup(db, backups, 3, '2026-11-04')).toBeNull();
    expect(readdirSync(backups).sort()).toEqual(['budget-reset.db', 'daily-2026-11-02.db', 'daily-2026-11-03.db', 'daily-2026-11-04.db']);
    expect(existsSync(join(backups, 'daily-2026-11-01.db'))).toBe(false);
  });
});

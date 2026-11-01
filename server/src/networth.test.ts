import { beforeEach, describe, expect, it } from 'vitest';
import type { AccountWithBalance, Instrument, NetWorthHistory } from '@budget/shared';
import { buildApp } from './app.ts';
import { openDb } from './db/index.ts';
import { fakeMarket } from './market/fake-market.ts';

let app: ReturnType<typeof buildApp>;
let market: ReturnType<typeof fakeMarket>;

async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) {
  const res = await app.inject({ method, url, payload });
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
}

beforeEach(() => {
  market = fakeMarket();
  app = buildApp(openDb(':memory:', { seed: 'demo' }), { market });
});

describe('net worth', () => {
  it('returns initial balances when there is no activity', async () => {
    const accounts = (await api<AccountWithBalance[]>('GET', '/api/accounts')).body;
    const piraeus = accounts.find(a => a.name === 'Τράπεζα Πειραιώς')!;
    await api('PUT', `/api/accounts/${piraeus.id}`, { name: piraeus.name, type: 'bank', initialBalance: 100_000 });
    const nw = (await api<NetWorthHistory>('GET', '/api/networth')).body;
    expect(nw).toMatchObject({ months: [], years: [], since: null, current: { cash: 100_000, total: 100_000 } });
  });

  it('computes month-end net worth and explains every change', async () => {
    const accounts = (await api<AccountWithBalance[]>('GET', '/api/accounts')).body;
    const account = (name: string) => accounts.find(a => a.name === name)!;
    const piraeus = account('Τράπεζα Πειραιώς');
    const revolut = account('Revolut');
    const vusa = (await api<Instrument[]>('GET', '/api/instruments')).body.find(i => i.ticker === 'VUSA.AS')!;
    const categories = (await api<Array<{ id: number; name: string }>>('GET', '/api/categories')).body;
    const category = (name: string) => categories.find(c => c.name === name)!.id;

    await api('PUT', `/api/accounts/${piraeus.id}`, { name: piraeus.name, type: 'bank', initialBalance: 100_000 });
    // Ιούλιος: μισθός και έξοδα
    await api('POST', '/api/transactions', { type: 'income', date: '2026-07-01', amount: 180_000, accountId: piraeus.id, categoryId: category('Μισθός') });
    await api('POST', '/api/transactions', { type: 'expense', date: '2026-07-10', amount: 30_000, accountId: piraeus.id, categoryId: category('Στέγαση') });
    // Αύγουστος: 100 € στη Revolut, αγορά 1 VUSA (85 €), αρχική θέση 10 VUSA (παλιό κόστος 700 €)
    await api('POST', '/api/transactions', { type: 'transfer', date: '2026-08-01', amount: 10_000, accountId: piraeus.id, toAccountId: revolut.id });
    await api('POST', '/api/trades', { date: '2026-08-10', accountId: revolut.id, instrumentId: vusa.id, side: 'buy', quantity: 1, amountEur: 8_500 });
    await api('POST', '/api/trades', { date: '2026-08-15', accountId: revolut.id, instrumentId: vusa.id, side: 'opening', quantity: 10, amountEur: 70_000 });
    // Διόρθωση υπολοίπου τον Σεπτέμβριο
    await api('POST', `/api/accounts/${piraeus.id}/reconcile`, { actualBalance: 230_000, date: '2026-09-15' });

    const nw = (await api<NetWorthHistory>('GET', '/api/networth')).body;
    expect(nw.since).toBe('2026-07');
    const [jul, aug, sep] = nw.months;

    // Αφετηρία (τέλος Ιουνίου): η διόρθωση −100 € και οι 10 VUSA της αρχικής θέσης (× 75 €) μετράνε από την αρχή
    expect(jul).toMatchObject({ month: '2026-07', start: 165_000, change: 155_000, savings: 150_000, marketChange: 5_000 });
    expect(jul!.end).toMatchObject({ cash: 240_000, stocks: 80_000, total: 320_000 });

    // Τέλος Αυγούστου: Πειραιώς 2.300 €, Revolut 15 €, 11 VUSA × 90 € = 990 €
    expect(aug!.end).toMatchObject({ cash: 230_000, brokerCash: 1_500, stocks: 99_000, total: 330_500 });
    // Η αρχική θέση δεν φαίνεται ως μεταβολή: μόνο η άνοδος της αγοράς (99 − 80 − 8,50 αγορά)
    expect(aug).toMatchObject({ change: 10_500, savings: 0, marketChange: 10_500, incomplete: false });

    // Σεπτέμβριος: η διόρθωση δεν φαίνεται ως μεταβολή, μόνο η άνοδος 11 × 5 €
    expect(sep).toMatchObject({ marketChange: 5_500, change: 5_500 });

    for (const m of nw.months) expect(m.change).toBe(m.savings + m.marketChange);
    expect(nw.years).toEqual([expect.objectContaining({ year: 2026, start: 165_000, end: nw.current.total })]);
    // Σήμερα η περιουσία περιλαμβάνει κανονικά τη διόρθωση (ίδια με τα υπόλοιπα των λογαριασμών)
    expect(nw.current.cash).toBe(230_000);
    // Σήμερα: τιμή 100 €
    expect(nw.current.stocks).toBe(110_000);

    // Δεύτερη φορά από την cache της βάσης, χωρίς ιστορικές κλήσεις
    const before = market.calls.filter(c => c.startsWith('history')).length;
    await api('GET', '/api/networth');
    expect(market.calls.filter(c => c.startsWith('history')).length).toBe(before);
  });
});

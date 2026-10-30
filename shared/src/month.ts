// Μήνες ως "YYYY-MM", ημερομηνίες ως "YYYY-MM-DD".

const MONTH_NAMES = ['Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος',
  'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος'];

export const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const ISO_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const pad = (n: number) => String(n).padStart(2, '0');

export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today(): string {
  return toIsoDate(new Date());
}

export function currentMonth(): string {
  return today().slice(0, 7);
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${pad(new Date(y, m, 0).getDate())}`;
}

/** "2026-10" → "Οκτώβριος 2026" */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** "2026-10-28" + 3 → "2026-10-31" */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return toIsoDate(new Date(y, m - 1, d + days));
}

/** Όλοι οι μήνες από `from` έως και `to`: ("2026-11", "2027-01") → ["2026-11", "2026-12", "2027-01"] */
export function monthRange(from: string, to: string): string[] {
  const months: string[] = [];
  for (let m = from; m <= to; m = shiftMonth(m, 1)) months.push(m);
  return months;
}

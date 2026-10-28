// Όλα τα ποσά χρημάτων είναι ακέραια cents.

const eurFormatter = new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' });

export function formatEur(cents: number): string {
  return eurFormatter.format(cents / 100);
}

export function formatEurSigned(cents: number): string {
  return (cents > 0 ? '+' : '') + formatEur(cents);
}

/**
 * Διαβάζει ποσό σε ελληνική ή αγγλική μορφή και επιστρέφει cents.
 * "1.234,56" → 123456, "1234.56" → 123456, "1.500" → 150000, "12,5" → 1250.
 * Επιστρέφει null για κενό ή μη έγκυρο input.
 */
export function parseAmount(input: string): number | null {
  let s = input.trim().replace(/[\s€]/g, '');
  if (!s) return null;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    // Μόνο τελείες σε θέσεις χιλιάδων: ελληνικό διαχωριστικό χιλιάδων
    s = s.replace(/\./g, '');
  }
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/** Μορφή για προ-συμπλήρωση input, π.χ. 123456 → "1234,56". */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

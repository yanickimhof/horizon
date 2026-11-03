import type { Snapshot } from './types';
import { activeNow } from './timing';

export interface Slice {
  key: string;
  label: string;
  value: number;
  /** Part du total, 0 à 1. */
  share: number;
}

export interface Summary {
  base: 'CHF';
  grossAssets: number;
  debts: number;
  netWorth: number;
  income: number;
  expenses: number;
  surplus: number;
  /** Marge / revenus. Null si les revenus sont inconnus. */
  savingsRate: number | null;
  /** Dettes / actifs bruts. */
  debtToAssets: number | null;
  byClass: Slice[];
  byCurrency: Slice[];
  byRegion: Slice[];
}

const CLASS_LABEL: Record<string, string> = {
  cash: 'Liquidités', securities: 'Titres', crypto: 'Crypto', real_estate: 'Immobilier', pension: 'Prévoyance', business: 'Entreprise', other: 'Autres',
};
const REGION_LABEL: Record<string, string> = { CH: 'Suisse', US: 'États-Unis', EU: 'Europe', WORLD: 'Monde' };

function slices<T>(items: T[], key: (t: T) => string, label: (k: string) => string, value: (t: T) => number): Slice[] {
  const sums = new Map<string, number>();
  for (const it of items) sums.set(key(it), (sums.get(key(it)) ?? 0) + value(it));
  const total = [...sums.values()].reduce((a, b) => a + b, 0);
  return [...sums.entries()]
    .map(([k, v]) => ({ key: k, label: label(k), value: v, share: total > 0 ? v / total : 0 }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
}

/** Situation financière d'un coup d'œil, tout en francs suisses au dernier cours connu. */
export function summarize(s: Snapshot): Summary {
  const grossAssets = s.assets.reduce((a, x) => a + x.value, 0);
  const debts = s.liabilities.reduce((a, x) => a + x.balance, 0);
  const income = s.incomes.filter(activeNow).reduce((a, x) => a + x.monthly, 0);
  const expenses = s.expenses.filter(activeNow).reduce((a, x) => a + x.monthly, 0);
  const surplus = income - expenses;
  return {
    base: 'CHF',
    grossAssets,
    debts,
    netWorth: grossAssets - debts,
    income,
    expenses,
    surplus,
    savingsRate: income > 0 ? surplus / income : null,
    debtToAssets: grossAssets > 0 ? debts / grossAssets : null,
    byClass: slices(s.assets, (a) => a.class, (k) => CLASS_LABEL[k] ?? k, (a) => a.value),
    byCurrency: slices(s.assets, (a) => (a.class === 'crypto' ? 'CRYPTO' : a.currency), (k) => (k === 'CRYPTO' ? 'Crypto' : k), (a) => a.value),
    byRegion: slices(s.assets, (a) => a.region, (k) => REGION_LABEL[k] ?? k, (a) => a.value),
  };
}

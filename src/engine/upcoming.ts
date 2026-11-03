import type { Snapshot } from './types';
import { monthlyExpenses } from './horizons';

export interface Upcoming {
  key: string;
  label: string;
  /** Dans combien de mois. */
  inMonths: number;
  kind: 'start' | 'end' | 'lump' | 'income-start';
  /** Poids sans montant: part du coût de vie mensuel actuel (récurrent) ou nombre de mois de vie (ponctuel). */
  weight: number;
  unit: 'of-monthly' | 'months-of-life';
}

/** Ce qui change dans les années à venir, trié par date. */
export function upcoming(s: Snapshot, withinMonths = 240): Upcoming[] {
  const base = monthlyExpenses(s) || 1;
  const out: Upcoming[] = [];
  for (const e of s.expenses) {
    if (e.lump && e.lump.month > 0 && e.lump.month <= withinMonths) {
      out.push({ key: e.key, label: e.label, inMonths: e.lump.month, kind: 'lump', weight: e.lump.amount / base, unit: 'months-of-life' });
    }
    if (!e.lump && e.startMonth !== undefined && e.startMonth > 0 && e.startMonth <= withinMonths) {
      out.push({ key: e.key, label: e.label, inMonths: e.startMonth, kind: 'start', weight: e.monthly / base, unit: 'of-monthly' });
    }
    if (!e.lump && e.endMonth !== undefined && e.endMonth > 0 && e.endMonth <= withinMonths) {
      out.push({ key: e.key + ':end', label: e.label, inMonths: e.endMonth, kind: 'end', weight: e.monthly / base, unit: 'of-monthly' });
    }
  }
  for (const i of s.incomes) {
    if (i.stable && i.startMonth !== undefined && i.startMonth > 0 && i.startMonth <= withinMonths) {
      out.push({ key: i.key, label: i.label, inMonths: i.startMonth, kind: 'income-start', weight: i.monthly / base, unit: 'of-monthly' });
    }
  }
  return out.sort((a, b) => a.inMonths - b.inMonths);
}

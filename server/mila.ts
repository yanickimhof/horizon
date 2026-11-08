import { init } from './budget';
import type { Ledger } from './ledger';

/** Une règle de repérage des frais liés à Mila (sur place à Ste-Croix / Yverdon, école). */
export interface MilaRule {
  kind: 'loyer' | 'ecole' | 'nourriture' | 'virement' | 'poche';
  re: string;
  /** Catégories acceptées (vide: toutes). */
  categories?: string[];
  from?: string;
}

export const MILA_START = '2026-01-01';

export const DEFAULT_MILA_RULES: MilaRule[] = [
  { kind: 'loyer', re: 'balcon du jura', categories: ['enfants'] },
  { kind: 'ecole', re: 'cpnv|cataropro|payot', categories: ['enfants', 'quotidien'] },
  { kind: 'poche', re: '^mila imhof, all' },
  { kind: 'virement', re: 'transfert mila' },
  { kind: 'nourriture', re: 'ste-croix|sainte-croix|yverdon', categories: ['alimentation', 'restaurants'] },
];

export interface MilaMonth {
  month: string;
  loyer: number;
  ecole: number;
  nourriture: number;
  /** Argent de poche (épargne de Mila) et virements vers son compte: suivis à part, pas un coût sur place. */
  poche: number;
  virement: number;
}

export interface MilaView {
  from: string;
  months: MilaMonth[];
  /** Coût sur place: école + nourriture, hors loyer. */
  surPlaceMensuel: number;
  /** Loyer inclus. */
  totalMensuel: number;
  projection4ans: number;
  totals: { loyer: number; ecole: number; nourriture: number; poche: number; virement: number };
}

export function milaRules(l: Ledger): MilaRule[] {
  try {
    const r = JSON.parse(l.getSetting('mila.rules') || '[]') as MilaRule[];
    return r.length ? r : DEFAULT_MILA_RULES;
  } catch {
    return DEFAULT_MILA_RULES;
  }
}

export function milaView(l: Ledger, now: Date = new Date()): MilaView {
  init(l);
  const rules = milaRules(l);
  const rows = l.raw
    .prepare("SELECT date, amount, label, category FROM budget_txs WHERE date >= ? AND amount < 0 AND category <> 'doublon' AND category <> 'interne'")
    .all(MILA_START) as unknown as { date: string; amount: number; label: string; category: string }[];
  const byMonth = new Map<string, MilaMonth>();
  for (const r of rows) {
    const rule = rules.find((x) => new RegExp(x.re, 'i').test(r.label) && (!x.categories?.length || x.categories.includes(r.category)) && (!x.from || r.date >= x.from));
    if (!rule) continue;
    const m = r.date.slice(0, 7);
    const e = byMonth.get(m) ?? { month: m, loyer: 0, ecole: 0, nourriture: 0, poche: 0, virement: 0 };
    e[rule.kind] += -r.amount;
    byMonth.set(m, e);
  }
  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  const totals = { loyer: 0, ecole: 0, nourriture: 0, poche: 0, virement: 0 };
  for (const m of months) for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += m[k];
  // Moyenne sur les mois pleins écoulés depuis l'arrivée sur place (août 2026); le mois en cours est exclu.
  const current = now.toISOString().slice(0, 7);
  const onSite = months.filter((m) => m.month >= '2026-09' && m.month < current);
  const n = Math.max(1, onSite.length);
  const surPlace = onSite.reduce((t, m) => t + m.ecole + m.nourriture, 0) / n;
  const loyer = onSite.length ? onSite.reduce((t, m) => t + m.loyer, 0) / n : 450;
  return {
    from: MILA_START,
    months,
    surPlaceMensuel: Math.round(surPlace),
    totalMensuel: Math.round(surPlace + loyer),
    projection4ans: Math.round((surPlace + loyer) * 12 * 4),
    totals,
  };
}

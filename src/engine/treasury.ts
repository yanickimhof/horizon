import type { Snapshot } from './types';
import { activeNow } from './timing';

/** Ce dont la trésorerie a besoin du budget: des mois, des dépenses et l'immobilier par bien. */
export interface BudgetLike {
  months: { month: string; partial: boolean; spend: number; immo: Record<string, { loyers: number; charges: number }> }[];
  homes: string[];
}

export interface TLine { key: string; label: string; monthly: number }

export interface TScenario {
  id: 'favorable' | 'central' | 'prudent';
  label: string;
  /** Hypothèses de ce scénario, en clair. */
  rule: string;
  income: number;
  outflow: number;
  margin: number;
  /** Mois que tiennent les liquidités si la marge est négative; null si la marge est positive. */
  reserveMonths: number | null;
}

export interface Treasury {
  incomeLines: TLine[];
  outLines: TLine[];
  salary: number;
  bonus: number;
  rents: number;
  other: number;
  /** Sorties mensualisées hors solde d'impôt. */
  fixed: number;
  taxSolde: number;
  /** Amortissements: sortis du compte, mais ils réduisent la dette (épargne forcée). */
  amortization: number;
  scenarios: TScenario[];
  liquid: number;
  /** Salaire net mensuel en dessous duquel le cas prudent devient négatif. */
  breakEvenSalary: number;
  /** Relevés des 12 derniers mois complets: dépenses moyennes par mois, comparées aux faits. */
  observed: { months: number; spendMonthly: number; factsSpendMonthly: number } | null;
  /** Charges payées sur les biens locatifs d'après les relevés, au-delà de ce que les faits modélisent (par an). */
  rentalGap: number | null;
}

const RENT = /^income:loc-/;
const BONUS = /bonus/i;
const SOLDE = /impots-solde/;
const AMORT = /amort/i;

/** Les 12 derniers mois complets. */
export function lastFullMonths<T extends { partial: boolean }>(months: T[], n = 12): T[] {
  return months.filter((m) => !m.partial).slice(-n);
}

/**
 * Trésorerie de maintenant: ce qui rentre et sort chaque mois avec le revenu actuel (sans chômage ni versement unique),
 * en trois hypothèses explicites. Chaque ligne vient d'un fait; l'écart avec les relevés est montré à part.
 */
export function treasury(snap: Snapshot, budget: BudgetLike | null, opts: { rentCut?: number } = {}): Treasury {
  const rentCut = opts.rentCut ?? 0.1;
  const incomes = snap.incomes.filter((i) => activeNow(i) && i.monthly > 0);
  const salary = incomes.filter((i) => !i.stable && !BONUS.test(i.key + i.label)).reduce((s, i) => s + i.monthly, 0);
  const bonus = incomes.filter((i) => BONUS.test(i.key + i.label)).reduce((s, i) => s + i.monthly, 0);
  const rents = incomes.filter((i) => RENT.test(i.key)).reduce((s, i) => s + i.monthly, 0);
  const other = incomes.filter((i) => i.stable && !RENT.test(i.key)).reduce((s, i) => s + i.monthly, 0);

  const outs = snap.expenses.filter((e) => activeNow(e) && !e.lump && e.monthly > 0);
  const taxSolde = outs.filter((e) => SOLDE.test(e.key)).reduce((s, e) => s + e.monthly, 0);
  const fixed = outs.filter((e) => !SOLDE.test(e.key)).reduce((s, e) => s + e.monthly, 0);
  const amortization = outs.filter((e) => AMORT.test(e.key + e.label)).reduce((s, e) => s + e.monthly, 0);

  const liquid = snap.assets.filter((a) => a.class === 'cash').reduce((s, a) => s + a.value, 0);

  let observed: Treasury['observed'] = null;
  let rentalGap: number | null = null;
  if (budget) {
    const full = lastFullMonths(budget.months);
    if (full.length >= 6) {
      const spend = full.reduce((s, m) => s + m.spend, 0) / full.length;
      observed = { months: full.length, spendMonthly: spend, factsSpendMonthly: fixed + taxSolde };
      // Biens locatifs: ceux qui ont reçu des loyers sur la période, hors domicile désigné.
      const homes = new Set(budget.homes.map((h) => h.toLowerCase()));
      const tot = new Map<string, { loyers: number; charges: number }>();
      for (const m of full) for (const [b, v] of Object.entries(m.immo)) {
        const t = tot.get(b) ?? { loyers: 0, charges: 0 };
        t.loyers += v.loyers;
        t.charges += v.charges;
        tot.set(b, t);
      }
      const paid = [...tot.entries()].filter(([b, v]) => v.loyers > 0 && !homes.has(b.toLowerCase())).reduce((s, [, v]) => s + v.charges, 0) * (12 / full.length);
      const modelled = outs
        .filter((e) => e.category === 'housing' && /int[ée]r[êe]ts|taxe fonci|travaux/i.test(e.label) && !/osiris|mila/i.test(e.label))
        .reduce((s, e) => s + e.monthly * 12, 0);
      rentalGap = Math.max(0, paid - modelled);
    }
  }

  const gapMonthly = (rentalGap ?? 0) / 12;
  const build = (id: TScenario['id'], label: string, rule: string, income: number, outflow: number): TScenario => {
    const margin = income - outflow;
    return { id, label, rule, income, outflow, margin, reserveMonths: margin >= 0 ? null : Math.floor(liquid / -margin) };
  };
  const scenarios: TScenario[] = [
    build('favorable', 'Favorable', 'Bonus compté; pas de solde d’impôt; loyers au niveau actuel.', salary + bonus + rents + other, fixed),
    build('central', 'Central', 'Bonus compté; solde d’impôt de la taxation 2025 reconduit; loyers au niveau actuel.', salary + bonus + rents + other, fixed + taxSolde),
    build(
      'prudent',
      'Prudent',
      `Sans bonus; solde d’impôt reconduit; loyers moins ${Math.round(rentCut * 100)} %${rentalGap ? '; charges de biens locatifs relevées au-delà du modèle' : ''}.`,
      salary + rents * (1 - rentCut) + other,
      fixed + taxSolde + gapMonthly,
    ),
  ];

  const top = (xs: TLine[], n: number): TLine[] => {
    const sorted = [...xs].sort((a, b) => b.monthly - a.monthly);
    const head = sorted.slice(0, n).map(({ key, label, monthly }) => ({ key, label, monthly }));
    const rest = sorted.slice(n).reduce((s, x) => s + x.monthly, 0);
    return rest > 0 ? [...head, { key: 'rest', label: 'Autres lignes', monthly: rest }] : head;
  };

  return {
    incomeLines: top(incomes, 8),
    outLines: top(outs, 9),
    salary,
    bonus,
    rents,
    other,
    fixed,
    taxSolde,
    amortization,
    scenarios,
    liquid,
    breakEvenSalary: Math.max(0, scenarios[2].outflow - (rents * (1 - rentCut) + other)),
    observed,
    rentalGap,
  };
}

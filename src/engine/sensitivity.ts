import type { Snapshot } from './types';
import { CASES, type Assumptions, type CaseId } from './assumptions';
import { isWage, simulateRetirement, type RetirementParams } from './retirement';

/**
 * Solidité du verdict de retraite. Au lieu d'un seul chiffre, trois réponses:
 * - la marge de budget: jusqu'à quel budget mensuel les liquidités tiennent jusqu'à l'âge final, sans vendre de bien;
 * - la fourchette: cette marge et le patrimoine final dans le pire cas, le cas de base et le meilleur cas;
 * - les facteurs: de combien le patrimoine à l'âge final bouge si chaque hypothèse change.
 */

const CASE_IDS: CaseId[] = ['worst', 'base', 'best'];

/** Budget mensuel maximal pour lequel les liquidités ne tombent jamais sous zéro, sans vente automatique. */
export function breakEvenBudget(s: Snapshot, p: RetirementParams, as: Assumptions, cap = 60_000): number {
  const ok = (b: number) => simulateRetirement(s, { ...p, monthlyBudget: b, autoSell: false }, as).liquidityEndsAge === null;
  if (!ok(0)) return 0;
  if (ok(cap)) return cap;
  let lo = 0;
  let hi = cap;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

export interface Move {
  label: string;
  /** Variation du patrimoine à l'âge final, en francs. */
  delta: number;
  /** Même variation, en part du patrimoine de départ. */
  pct: number;
}

export interface Factor {
  id: string;
  label: string;
  low: Move;
  high: Move;
}

export interface CaseResult {
  id: CaseId;
  label: string;
  breakEven: number;
  margin: number;
  finalNetWorth: number;
}

export interface Robustness {
  /** Budget mensuel de retraite retenu. */
  budget: number;
  breakEven: number;
  /** breakEven / budget - 1: part de budget en plus que les liquidités supportent. */
  margin: number;
  finalNetWorth: number;
  cases: CaseResult[];
  factors: Factor[];
}

interface Variant {
  s?: Snapshot;
  p?: Partial<RetirementParams>;
  as?: Assumptions;
}

const scaleAssets = (s: Snapshot, f: number): Snapshot => {
  const o = structuredClone(s);
  for (const a of o.assets) if (a.class === 'real_estate') a.value *= f;
  return o;
};
const scaleIncomes = (s: Snapshot, f: number, pick: (i: Snapshot['incomes'][number]) => boolean): Snapshot => {
  const o = structuredClone(s);
  for (const i of o.incomes) if (pick(i)) i.monthly *= f;
  return o;
};
const shiftReturns = (as: Assumptions, d: number): Assumptions => ({
  ...as,
  realGrowth: { ...as.realGrowth, cash: as.realGrowth.cash + d, securities: as.realGrowth.securities + d, crypto: as.realGrowth.crypto + d, other: as.realGrowth.other + d },
});

export function robustness(s: Snapshot, p: RetirementParams, as: Assumptions, now: { finalNetWorth?: number } = {}): Robustness {
  const run = (v: Variant = {}) => simulateRetirement(v.s ?? s, { ...p, autoSell: false, ...v.p }, v.as ?? as);
  const base = run();
  const baseNw = now.finalNetWorth ?? base.finalNetWorth;
  const budget = base.budget;
  const denom = Math.max(1, Math.abs(baseNw));
  const move = (label: string, v: Variant): Move => {
    const delta = run(v).finalNetWorth - base.finalNetWorth;
    return { label, delta, pct: delta / denom };
  };
  const none = (label: string): Move => ({ label, delta: 0, pct: 0 });

  const factors: Factor[] = [
    { id: 'valeurs', label: 'Valeur des biens immobiliers', low: move('−10 %', { s: scaleAssets(s, 0.9) }), high: move('+10 %', { s: scaleAssets(s, 1.1) }) },
    { id: 'salaire', label: 'Salaire et bonus jusqu’à la retraite', low: move('−20 %', { s: scaleIncomes(s, 0.8, isWage) }), high: move('+10 %', { s: scaleIncomes(s, 1.1, isWage) }) },
    { id: 'loyers', label: 'Loyers encaissés', low: move('−20 %, vacance', { s: scaleIncomes(s, 0.8, (i) => !isWage(i) && /loyer/i.test(i.label)) }), high: none('inchangés') },
    { id: 'rendement', label: 'Rendement réel des liquidités', low: move('−1 point', { as: shiftReturns(as, -0.01) }), high: move('+2 points', { as: shiftReturns(as, 0.02) }) },
    { id: 'taux', label: 'Taux des dettes variables', low: move('+2 points', { p: { rateShock: Math.max(p.rateShock, 0) + 0.02 } }), high: none('inchangés') },
    { id: 'budget', label: 'Budget de retraite', low: move('+20 %', { p: { monthlyBudget: budget * 1.2 } }), high: move('−10 %', { p: { monthlyBudget: budget * 0.9 } }) },
    { id: 'depart', label: 'Âge de départ', low: move('60 ans', { p: { retireAge: 60 } }), high: move('67 ans', { p: { retireAge: 67 } }) },
  ].sort((a, b) => Math.max(Math.abs(b.low.delta), Math.abs(b.high.delta)) - Math.max(Math.abs(a.low.delta), Math.abs(a.high.delta)));

  const cases: CaseResult[] = CASE_IDS.map((id) => {
    const a = CASES[id].assumptions;
    const be = breakEvenBudget(s, p, a);
    const nw = simulateRetirement(s, { ...p, autoSell: false }, a);
    return { id, label: CASES[id].label, breakEven: be, margin: be / Math.max(1, nw.budget) - 1, finalNetWorth: nw.finalNetWorth };
  });

  const breakEven = breakEvenBudget(s, p, as);
  return { budget, breakEven, margin: breakEven / Math.max(1, budget) - 1, finalNetWorth: baseNw, cases, factors };
}

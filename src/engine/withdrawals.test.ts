import { describe, expect, it } from 'vitest';
import { capitalTax, projectItem, withdrawals, CAPITAL_TAX_SINGLE } from './withdrawals';
import { CASES } from './assumptions';
import type { Snapshot } from './types';

const pension = (key: string, label: string, account: string, value: number, contribution = 0) => ({ key, label, class: 'pension' as const, account, value, currency: 'CHF', valueNative: value, fx: 1, region: 'CH', real: false, liquidityMonths: 0, haircut: 0.1, contribution, certainty: 'confirmed' as const });
const snap = {
  asOf: '2026-11-08',
  base: 'CHF',
  rates: {},
  household: { name: 'T', birthYear: 1975, adults: 2, children: 0, owner: true, retirementAge: 65 },
  assets: [pension('a:lpp', '2e pilier', 'lpp', 170000, 3000), pension('a:3a1', '3a A', '3a', 50000), pension('a:3a2', '3a B', '3a', 68000), pension('a:3a3', '3a C', '3a', 3000), pension('a:401', '401(k)', '401k', 600000)],
  liabilities: [], incomes: [], expenses: [], goals: [],
} as unknown as Snapshot;

describe('capitalTax', () => {
  it('retrouve les points publiés (couple, Lausanne 2026)', () => {
    expect(capitalTax(100_000)).toBeCloseTo(3640, 6);
    expect(capitalTax(500_000)).toBeCloseTo(37_900, 6);
    expect(capitalTax(1_000_000)).toBeCloseTo(86_800, 6);
  });
  it('est plus élevé pour une personne seule', () => {
    expect(capitalTax(250_000, CAPITAL_TAX_SINGLE)).toBeGreaterThan(capitalTax(250_000));
  });
  it('augmente plus vite que le montant (progressif)', () => {
    expect(capitalTax(400_000)).toBeGreaterThan(2 * capitalTax(200_000));
  });
});

describe('projectItem', () => {
  it('sans croissance ni cotisation, garde la valeur', () => {
    expect(projectItem({ key: 'k', label: 'k', account: '3a', now: 1000, contribution: 0 }, 14, 14, 0)).toBe(1000);
  });
  it('ajoute les cotisations jusqu’à la retraite seulement', () => {
    expect(projectItem({ key: 'k', label: 'k', account: 'lpp', now: 0, contribution: 100 }, 20, 10, 0)).toBeCloseTo(12000, 6);
  });
});

describe('withdrawals', () => {
  const w = withdrawals(snap, CASES.base.assumptions, 65)!;
  it('exclut le 401(k) et garde LPP et 3a', () => {
    expect(w.items.map((i) => i.key).sort()).toEqual(['a:3a1', 'a:3a2', 'a:3a3', 'a:lpp']);
    expect(w.excluded.some((x) => x.includes('401(k)'))).toBe(true);
  });
  it('échelonner ne coûte jamais plus que tout la même année', () => {
    const [once, sep, split] = w.plans;
    expect(sep.tax).toBeLessThanOrEqual(once.tax);
    expect(split.tax).toBeLessThanOrEqual(sep.tax);
    expect(once.saving).toBe(0);
    expect(split.saving).toBeGreaterThan(0);
  });
  it('les capitaux répartis totalisent le capital à 65 ans pour le plan d’un seul coup', () => {
    expect(w.plans[0].years).toHaveLength(1);
    expect(w.plans[0].years[0].capital).toBeCloseTo(w.total, 4);
  });
  it('la borne haute dépasse la borne centrale', () => {
    for (const p of w.plans) expect(p.taxHigh).toBeGreaterThan(p.tax);
  });
});

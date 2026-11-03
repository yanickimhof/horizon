import { describe, expect, it } from 'vitest';
import type { Asset, Snapshot } from './types';
import { DEFAULT_PARAMS, simulateRetirement } from './retirement';
import { breakEvenBudget, robustness } from './sensitivity';
import { CASES } from './assumptions';

const asset = (o: Partial<Asset> & Pick<Asset, 'key' | 'label' | 'class' | 'value'>): Asset => ({
  currency: 'CHF', valueNative: o.value, fx: 1, region: 'CH', real: false, liquidityMonths: 0, haircut: 0, certainty: 'confirmed', ...o,
});

const snap = (): Snapshot => ({
  asOf: '2026-11-01T00:00:00.000Z',
  base: 'CHF',
  rates: { base: 'CHF', rates: {} } as never,
  household: { name: 'T', birthYear: 1975, adults: 1, children: 0, owner: true, retirementAge: 65 },
  assets: [
    asset({ key: 'asset:cash', label: 'Cash', class: 'cash', value: 400_000 }),
    asset({ key: 'asset:lpp', label: 'LPP', class: 'pension', value: 300_000, haircut: 0.1, account: 'lpp' }),
    asset({ key: 'asset:ppe-tilleuls', label: 'PPE Les Tilleuls', class: 'real_estate', value: 500_000, haircut: 0.1, subtype: 'rental', real: true, liquidityMonths: 60 }),
  ],
  liabilities: [{ key: 'liability:t', label: 'Hypothèque Tilleuls', balance: 200_000, currency: 'CHF', balanceNative: 200_000, fx: 1, rate: 0.01, variable: true, securedBy: 'asset:ppe-tilleuls', certainty: 'confirmed' }],
  incomes: [
    { key: 'income:sal', label: 'Salaire', monthly: 8_000, stable: false, certainty: 'confirmed' },
    { key: 'income:t', label: 'Loyers Tilleuls', monthly: 1_500, stable: true, certainty: 'confirmed' },
  ],
  expenses: [
    { key: 'expense:vie', label: 'Vie courante', category: 'lifestyle', monthly: 4_000, essential: true, certainty: 'confirmed' },
    { key: 'expense:t-int', label: 'Intérêts Tilleuls', category: 'housing', monthly: 170, essential: true, certainty: 'confirmed' },
  ],
  goals: [],
});

const as = CASES.base.assumptions;

describe('solidité du verdict', () => {
  it('le budget maximal est la frontière entre tenir et manquer', () => {
    const s = snap();
    const be = breakEvenBudget(s, DEFAULT_PARAMS, as);
    expect(be).toBeGreaterThan(0);
    expect(simulateRetirement(s, { ...DEFAULT_PARAMS, monthlyBudget: be * 0.99, autoSell: false }, as).liquidityEndsAge).toBeNull();
    expect(simulateRetirement(s, { ...DEFAULT_PARAMS, monthlyBudget: be * 1.02, autoSell: false }, as).liquidityEndsAge).not.toBeNull();
  });

  it('la marge compare le budget maximal au budget retenu', () => {
    const r = robustness(snap(), DEFAULT_PARAMS, as);
    expect(r.margin).toBeCloseTo(r.breakEven / r.budget - 1, 6);
    expect(r.margin).toBeGreaterThan(0);
  });

  it('la fourchette est ordonnée du pire au meilleur cas', () => {
    const r = robustness(snap(), DEFAULT_PARAMS, as);
    const [worst, base, best] = r.cases;
    expect(worst.breakEven).toBeLessThanOrEqual(base.breakEven);
    expect(base.breakEven).toBeLessThanOrEqual(best.breakEven);
    expect(worst.finalNetWorth).toBeLessThan(best.finalNetWorth);
  });

  it('chaque facteur bouge dans le bon sens', () => {
    const f = Object.fromEntries(robustness(snap(), DEFAULT_PARAMS, as).factors.map((x) => [x.id, x]));
    expect(f.valeurs.low.delta).toBeLessThan(0);
    expect(f.valeurs.high.delta).toBeGreaterThan(0);
    expect(f.salaire.low.delta).toBeLessThan(0);
    expect(f.taux.low.delta).toBeLessThan(0);
    expect(f.taux.high.delta).toBe(0);
    expect(f.budget.low.delta).toBeLessThan(0);
    expect(f.budget.high.delta).toBeGreaterThan(0);
    expect(f.depart.low.delta).toBeLessThan(0);
  });

  it('classe les facteurs du plus au moins important', () => {
    const fs = robustness(snap(), DEFAULT_PARAMS, as).factors;
    const size = (x: (typeof fs)[number]) => Math.max(Math.abs(x.low.delta), Math.abs(x.high.delta));
    for (let i = 1; i < fs.length; i++) expect(size(fs[i - 1])).toBeGreaterThanOrEqual(size(fs[i]));
  });
});

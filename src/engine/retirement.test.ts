import { describe, expect, it } from 'vitest';
import type { Asset, Snapshot } from './types';
import { DEFAULT_PARAMS as DEFAULTS, defaultRetirementMode, assess, properties, propertyToken, simulateRetirement } from './retirement';
import { CASES, DEFAULT_ASSUMPTIONS, resolvePhase, valueAt, type Assumptions } from './assumptions';

/** Paramètres sans modèle d'impôts détaillé ni vacance: les tests historiques en dépendent. */
const DEFAULT_PARAMS = { ...DEFAULTS, detailedTax: false, vacancyRate: 0, normalRate: 0 };

const asset = (o: Partial<Asset> & Pick<Asset, 'key' | 'label' | 'class' | 'value'>): Asset => ({
  currency: 'CHF', valueNative: o.value, fx: 1, region: 'CH', real: false, liquidityMonths: 0, haircut: 0, certainty: 'confirmed', ...o,
});

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    asOf: '2026-11-01T00:00:00.000Z',
    base: 'CHF',
    rates: { base: 'CHF', rates: {} } as never,
    household: { name: 'T', birthYear: 1975, adults: 1, children: 0, owner: true, retirementAge: 65 },
    assets: [
      asset({ key: 'asset:cash', label: 'Cash', class: 'cash', value: 100_000 }),
      asset({ key: 'asset:lpp', label: 'LPP', class: 'pension', value: 200_000, haircut: 0.1, account: 'lpp' }),
      asset({ key: 'asset:ppe-cedres', label: 'PPE Cèdres (studio)', class: 'real_estate', value: 300_000, haircut: 0.1, subtype: 'rental', real: true, liquidityMonths: 60 }),
    ],
    liabilities: [{ key: 'liability:o', label: 'Hypothèque Cèdres', balance: 150_000, currency: 'CHF', balanceNative: 150_000, fx: 1, rate: 0.01, variable: true, securedBy: 'asset:ppe-cedres', certainty: 'confirmed' }],
    incomes: [
      { key: 'income:sal', label: 'Salaire', monthly: 8_000, stable: false, certainty: 'confirmed' },
      { key: 'income:cedres', label: 'Loyers Cèdres', monthly: 1_000, stable: true, certainty: 'confirmed' },
    ],
    expenses: [
      { key: 'expense:vie', label: 'Vie courante', category: 'lifestyle', monthly: 4_000, essential: true, certainty: 'confirmed' },
      { key: 'expense:cedres-int', label: 'Intérêts Cèdres', category: 'housing', monthly: 150, essential: true, certainty: 'confirmed' },
      { key: 'expense:impots', label: 'Impôts', category: 'tax', monthly: 1_000, essential: true, certainty: 'confirmed' },
    ],
    goals: [],
    ...over,
  };
}

/** Hypothèses sans dérive du coût de la vie: les tests chiffrés en dépendent. */
const FLAT: Assumptions = { ...DEFAULT_ASSUMPTIONS, expenseGrowth: 0 };
const sim = (s: Snapshot, p: Parameters<typeof simulateRetirement>[1], as: Assumptions = FLAT) => simulateRetirement(s, p, as);

describe('simulation de retraite', () => {
  it('relie loyers, charges et dette au bien par son nom', () => {
    expect(propertyToken('PPE Les Tilleuls')).toBe('tilleuls');
    expect(propertyToken('Résidence principale (PPE Les Alpes)')).toBe('alpes');
    const [p] = properties(snap());
    expect(p.incomes.map((i) => i.key)).toEqual(['income:cedres']);
    expect(p.expenses.map((e) => e.key)).toEqual(['expense:cedres-int']);
    expect(p.liabilities).toHaveLength(1);
  });

  it('retire les impôts du budget de retraite et applique un taux sur les loyers', () => {
    const r = sim(snap(), { ...DEFAULT_PARAMS });
    expect(r.budget).toBe(4_150);
    const atRetire = r.rows.find((x) => Math.round(x.age) === 65)!;
    expect(atRetire.spending).toBeCloseTo(4_150 + 1_000 * 0.12, 0);
    expect(atRetire.income).toBe(1_000);
  });

  it('verse les avoirs de prévoyance à la retraite, impôt de sortie déduit', () => {
    const r = sim(snap(), { ...DEFAULT_PARAMS });
    const before = r.rows.find((x) => x.age === 64)!;
    const after = r.rows.find((x) => x.age === 65)!;
    expect(before.pensions).toBeGreaterThan(150_000);
    expect(after.pensions).toBe(0);
    expect(after.liquid).toBeGreaterThan(before.liquid + 150_000);
  });

  it('les cotisations de prévoyance font croître le 2e pilier jusqu’à la retraite', () => {
    const s = snap();
    const lpp = s.assets.find((x) => x.key === 'asset:lpp')!;
    const sans = sim(s, { ...DEFAULT_PARAMS }, CASES.base.assumptions);
    lpp.contribution = 2_000;
    const avec = sim(s, { ...DEFAULT_PARAMS }, CASES.base.assumptions);
    const a = sans.rows.find((x) => x.age === 64)!.pensions;
    const b = avec.rows.find((x) => x.age === 64)!.pensions;
    // 13 ans de cotisations à 2 000 par mois, moins l'impôt de sortie de 10 %.
    expect(b - a).toBeGreaterThan(13 * 12 * 2_000 * 0.9 * 0.95);
    expect(b - a).toBeLessThan(14 * 12 * 2_000);
  });

  it('une perte de salaire réduit les liquidités à la retraite', () => {
    const base = sim(snap(), DEFAULT_PARAMS);
    const loss = sim(snap(), { ...DEFAULT_PARAMS, salaryLossMonths: 24 });
    const a = base.rows.find((x) => x.age === 65)!.liquid;
    const b = loss.rows.find((x) => x.age === 65)!.liquid;
    expect(a - b).toBeGreaterThan(24 * 7_000 * 0.9);
  });

  it('le chômage compense une partie du salaire pendant 18 mois seulement', () => {
    const s = snap();
    const sans = sim(s, { ...DEFAULT_PARAMS, salaryLossMonths: 24 });
    const avec = sim(s, { ...DEFAULT_PARAMS, salaryLossMonths: 24, unemploymentBenefit: 5_000 });
    const a = sans.rows.find((x) => x.age === 65)!.liquid;
    const b = avec.rows.find((x) => x.age === 65)!.liquid;
    expect(b - a).toBeGreaterThan(18 * 5_000 * 0.95);
    expect(b - a).toBeLessThan(18 * 5_000 * 1.2);
  });

  it('une hausse des taux alourdit les dépenses', () => {
    const a = sim(snap(), DEFAULT_PARAMS);
    const b = sim(snap(), { ...DEFAULT_PARAMS, rateShock: 0.02 });
    expect(b.rows[0].spending - a.rows[0].spending).toBeCloseTo((150_000 * 0.02) / 12, 1);
  });

  it('la vente supprime loyer et charges, encaisse la valeur nette', () => {
    const r = sim(snap(), { ...DEFAULT_PARAMS, sales: [{ key: 'asset:ppe-cedres', age: 60 }] });
    expect(r.sold[0].label).toBe('PPE Cèdres (studio)');
    const row = r.rows.find((x) => x.age === 61)!;
    expect(row.realEstate).toBe(0);
    expect(row.income).toBe(8_000);
    expect(row.spending).toBe(5_000);
  });

  it('un budget trop élevé épuise les liquidités, puis la vente automatique prend le relais', () => {
    const a = assess(snap(), { ...DEFAULT_PARAMS, monthlyBudget: 6_000 }, CASES.base.assumptions);
    expect(a.noSale.liquidityEndsAge).not.toBeNull();
    expect(a.withSales.sold.length).toBe(1);
    expect(['sales', 'short']).toContain(a.verdict);
  });

  it('un budget modeste tient jusqu’à l’âge final sans vente', () => {
    const a = assess(snap(), { ...DEFAULT_PARAMS, monthlyBudget: 1_200 }, CASES.base.assumptions);
    expect(a.verdict).toBe('ok');
    expect(a.noSale.sold).toHaveLength(0);
  });

  it('la vacance locative réduit les loyers avant et après la retraite', () => {
    const r = sim(snap(), { ...DEFAULT_PARAMS, vacancyRate: 0.1 });
    expect(r.rows.find((x) => x.age === 52)!.income).toBeCloseTo(8_000 + 1_000 * 0.9, 5);
  });

  it('l’impôt sur la fortune alourdit la retraite quand les liquidités sont élevées', () => {
    const s = snap();
    s.assets.find((a) => a.key === 'asset:cash')!.value = 2_000_000;
    const simple = sim(s, DEFAULT_PARAMS);
    const detaille = sim(s, { ...DEFAULT_PARAMS, detailedTax: true });
    const a = simple.rows.find((x) => x.age === 70)!.spending;
    const b = detaille.rows.find((x) => x.age === 70)!.spending;
    expect(b - a).toBeGreaterThan(500);
  });

  it('avant la retraite, seule la hausse de l’impôt sur la fortune s’ajoute', () => {
    const s = snap();
    const base = sim(s, { ...DEFAULT_PARAMS, detailedTax: true });
    const first = base.rows[0].spending;
    const later = base.rows.find((x) => x.age === 60)!.spending;
    expect(first).toBeCloseTo(4_000 + 150 + 1_000, 0);
    expect(later).toBeGreaterThanOrEqual(first);
  });

  it('un loyer de remplacement suit la vente de la résidence', () => {
    const s = snap();
    s.assets.push(asset({ key: 'asset:residence', label: 'Résidence principale', class: 'real_estate', value: 1_000_000, haircut: 0.2, subtype: 'home', real: true }));
    const sale = { sales: [{ key: 'asset:residence', age: 60 }] };
    const sans = sim(s, { ...DEFAULT_PARAMS, ...sale, replacementRentRate: 0 });
    const avec = sim(s, { ...DEFAULT_PARAMS, ...sale, replacementRentRate: 0.03 });
    const d = avec.rows.find((x) => x.age === 62)!.spending - sans.rows.find((x) => x.age === 62)!.spending;
    expect(d).toBeGreaterThan(2_400);
    expect(d).toBeLessThan(2_800);
  });

  it('un amortissement déclaré réduit la dette et augmente le produit net d’une vente', () => {
    const base = snap();
    const amorti = snap({ liabilities: [{ ...base.liabilities[0], amortization: 6_000 }] });
    const sale = { sales: [{ key: 'asset:ppe-cedres', age: 60 }] };
    const a = sim(base, { ...DEFAULT_PARAMS, ...sale });
    const b = sim(amorti, { ...DEFAULT_PARAMS, ...sale });
    const row = (r: typeof a) => r.rows.find((x) => x.age === 61)!.liquid;
    // 9 ans à 6 000 par an: 54 000 de dette en moins à la vente (le décaissement vient d'une dépense déclarée à part).
    expect(row(b) - row(a)).toBeGreaterThan(50_000);
    expect(row(b) - row(a)).toBeLessThan(58_000);
  });

  it('sans amortissement déclaré, la dette reste stable', () => {
    const r = sim(snap(), { ...DEFAULT_PARAMS });
    expect(r.rows[0].realEstate).toBeGreaterThan(0);
    const same = sim(snap({ liabilities: [{ ...snap().liabilities[0], amortization: undefined }] }), { ...DEFAULT_PARAMS });
    expect(same.finalNetWorth).toBeCloseTo(r.finalNetWorth, 5);
  });

  it('les dettes variables passent au moins au taux normal à long terme', () => {
    // Hypothèque Cèdres: 150 000 à 1 %. Au taux normal de 2 %, 1 500 de plus par an, soit 125 par mois.
    const bas = sim(snap(), { ...DEFAULT_PARAMS, normalRate: 0 });
    const normal = sim(snap(), { ...DEFAULT_PARAMS, normalRate: 0.02 });
    const d = normal.rows.find((x) => x.age === 52)!.spending - bas.rows.find((x) => x.age === 52)!.spending;
    expect(d).toBeGreaterThan(120);
    expect(d).toBeLessThan(130);
  });

  it('un taux déjà au-dessus du taux normal n’ajoute rien', () => {
    const haut = snap({ liabilities: [{ ...snap().liabilities[0], rate: 0.03 }] });
    const a = sim(haut, { ...DEFAULT_PARAMS, normalRate: 0 });
    const b = sim(haut, { ...DEFAULT_PARAMS, normalRate: 0.02 });
    expect(b.finalNetWorth).toBeCloseTo(a.finalNetWorth, 5);
  });

  it('classe les dépenses à la retraite selon leur nature, et le choix de l’utilisateur l’emporte', () => {
    const e = (key: string, label: string, category = 'other') => ({ key, label, category, monthly: 100, essential: true, certainty: 'confirmed' as const });
    expect(defaultRetirementMode(e('expense:impots-avances', 'Avances d’impôts', 'tax'))).toBe('gone');
    expect(defaultRetirementMode(e('expense:enfant-loyer', 'Loyer de l’enfant'))).toBe('gone');
    expect(defaultRetirementMode(e('expense:transit', 'Transports publics', 'transport'))).toBe('lower');
    expect(defaultRetirementMode(e('expense:holidays', 'Vacances', 'lifestyle'))).toBe('higher');
    expect(defaultRetirementMode(e('expense:css', 'Assurance maladie'))).toBe('same');
    expect(defaultRetirementMode(e('expense:leasings', 'Leasings Tesla et Fiat', 'transport'))).toBe('same');
    expect(defaultRetirementMode(e('expense:fiduc', 'Fiduciaire (déclaration d’impôts)'))).toBe('same');
    const budget = (mode?: 'gone' | 'lower' | 'same' | 'higher') => {
      const s = snap({ expenses: [{ ...e('expense:vie', 'Vie courante', 'lifestyle'), monthly: 4_000, ...(mode ? { retirement: mode } : {}) }] });
      return sim(s, { ...DEFAULT_PARAMS }).budget;
    };
    expect(budget()).toBe(4_000);
    expect(budget('lower')).toBeCloseTo(2_800, 5);
    expect(budget('higher')).toBeCloseTo(5_200, 5);
    expect(budget('gone')).toBe(0);
  });

  it('la dérive réelle du coût de la vie alourdit les dépenses avec le temps', () => {
    const plat = sim(snap(), { ...DEFAULT_PARAMS });
    const derive = sim(snap(), { ...DEFAULT_PARAMS }, { ...FLAT, expenseGrowth: 0.01 });
    const d = (r: typeof plat) => r.rows.find((x) => x.age === 70)!.spending;
    // 19 ans à 1 % par an: environ 21 % de plus sur la part qui dérive.
    expect(d(derive)).toBeGreaterThan(d(plat) * 1.1);
    expect(derive.rows[0].spending).toBeCloseTo(plat.rows[0].spending, 0);
  });

  it('le pire cas ne dure qu’une décennie autour de la retraite', () => {
    const worst = CASES.worst.assumptions;
    const base = CASES.base.assumptions;
    expect(worst.phase).toBeDefined();
    const bien = asset({ key: 'asset:x', label: 'Bien', class: 'real_estate', value: 1_000_000 });
    // Avant 60 ans (9 ans pour 51 ans): identique au cas de base.
    const phaseAvant = valueAt(bien, 8 * 12, resolvePhase(worst, 51));
    expect(phaseAvant).toBeCloseTo(valueAt(bien, 8 * 12, base), 3);
    // Pendant la décennie, l’immobilier recule; ensuite il repart au rythme du cas de base.
    const fin = valueAt(bien, 19 * 12, resolvePhase(worst, 51));
    const attendu = 1_000_000 * Math.pow(1.005, 9) * Math.pow(1 - 0.025, 10);
    expect(fin).toBeCloseTo(attendu, 3);
    expect(valueAt(bien, 29 * 12, resolvePhase(worst, 51))).toBeCloseTo(attendu * Math.pow(1.005, 10), 3);
  });

  it('une ligne d’impôts ne compte jamais dans le budget, même si l’utilisateur a choisi autre chose', () => {
    const e = { key: 'expense:impots-avances', label: 'Impôts: avances mensuelles', category: 'tax', monthly: 1_600, essential: true, certainty: 'confirmed' as const, retirement: 'lower' as const };
    const budget = (list: typeof e[]) => sim(snap({ expenses: list }), { ...DEFAULT_PARAMS }).budget;
    expect(budget([e])).toBe(0);
  });
});

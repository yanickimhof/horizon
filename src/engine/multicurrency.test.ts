import { describe, expect, it } from 'vitest';
import { Ledger } from '../../server/ledger';
import { loadDemo } from '../../server/demo';
import { project } from '../core/project';
import type { FactDraft } from '../core/types';
import { rateFor, staleRates, toBase, type RateTable } from './fx';
import { accessProfile } from './accounts';
import { CASES, DEFAULT_ASSUMPTIONS, cumulativeDemand, valueAt } from './assumptions';
import { rings, runwayMonths } from './horizons';
import { runScenarios } from './stress';
import { comparablesStats, estimateProperty, projectValue } from './property';
import { suggestMissing } from './gaps';

/** Date fixe pour les calculs d'ancienneté; instantanés pris à l’appel, après l’enregistrement des faits. */
const FIXED = new Date('2026-11-01T12:00:00Z');
const rates: RateTable = {
  base: 'CHF',
  rates: {
    USD: { perUnit: 0.9, at: '2026-10-30T00:00:00Z', source: 'test' },
    BTC: { perUnit: 60000, at: '2026-10-30T00:00:00Z', source: 'test' },
    EUR: { perUnit: 0.95, at: '2026-08-01T00:00:00Z', source: 'test' },
  },
};

const draft = (key: string, kind: FactDraft['kind'], data: Record<string, unknown>): FactDraft => ({
  kind, key, data, status: 'confirmed', origin: 'user', confidence: 1, sourceId: null, excerpt: null, why: null,
});

function snapshotWith(...drafts: FactDraft[]) {
  const l = new Ledger();
  l.confirmNew(draft('household', 'household', { birthYear: 1981, adults: 2, children: 0, owner: false, retirementAge: 65 }));
  for (const d of drafts) l.confirmNew(d);
  return project(l.current(), new Date(), rates);
}

describe('devises', () => {
  it('convertit au cours, le franc vaut 1', () => {
    expect(toBase(100, 'USD', rates)).toEqual({ value: 90, fx: 0.9, missing: false });
    expect(toBase(100, 'CHF', rates).value).toBe(100);
    expect(rateFor(rates, 'usd')?.perUnit).toBe(0.9);
  });

  it('un cours manquant est signalé, jamais silencieux', () => {
    const r = toBase(100, 'JPY', rates);
    expect(r).toEqual({ value: 100, fx: 1, missing: true });
  });

  it('repère les cours périmés', () => {
    expect(staleRates(rates, FIXED)).toEqual(['EUR']);
  });

  it('un actif en dollars est converti et garde sa devise d origine', () => {
    const s = snapshotWith(draft('asset:b', 'asset', { label: 'Courtier US', class: 'securities', value: 10000, currency: 'USD' }));
    const a = s.assets[0];
    expect(a.value).toBeCloseTo(9000, 6);
    expect(a.valueNative).toBe(10000);
    expect(a.currency).toBe('USD');
    expect(a.certainty).toBe('confirmed');
  });

  it('un cours manquant rend la ligne supposée et déclenche une suggestion', () => {
    const s = snapshotWith(draft('asset:j', 'asset', { label: 'Compte Tokyo', class: 'cash', value: 5000, currency: 'JPY' }));
    expect(s.assets[0].rateMissing).toBe(true);
    expect(s.assets[0].certainty).toBe('assumed');
    const gaps = suggestMissing(s, { sourceNames: [], notes: [] });
    expect(gaps[0].id).toBe('rates');
    expect(gaps[0].title).toMatch(/JPY/);
  });

  it('une dette en devise est convertie aussi', () => {
    const s = snapshotWith(draft('liability:u', 'liability', { label: 'Prêt US', balance: 100000, currency: 'USD', rate: 0.05, variable: false }));
    expect(s.liabilities[0].balance).toBeCloseTo(90000, 6);
  });
});

describe('crypto', () => {
  it('valeur = quantité x cours du symbole', () => {
    const s = snapshotWith(draft('asset:btc', 'asset', { label: 'Wallet', class: 'crypto', symbol: 'BTC', quantity: 0.5 }));
    expect(s.assets[0].value).toBeCloseTo(30000, 6);
    expect(s.assets[0].quantity).toBe(0.5);
    expect(s.assets[0].liquidityMonths).toBe(0);
    expect(s.assets[0].haircut).toBeGreaterThan(0);
  });

  it('un symbole sans cours est signalé', () => {
    const s = snapshotWith(draft('asset:x', 'asset', { label: 'Jeton rare', class: 'crypto', symbol: 'ZZZ', quantity: 1000, value: 200 }));
    expect(s.assets[0].rateMissing).toBe(true);
    expect(s.assets[0].value).toBe(200);
  });

  it('refuse un actif coté sans quantité', () => {
    const l = new Ledger();
    expect(() => l.confirmNew(draft('asset:q', 'asset', { label: 'X', class: 'crypto', symbol: 'BTC' }))).toThrow(/quantity/);
  });

  it('le choc crypto ne touche que la crypto', () => {
    const s = snapshotWith(
      draft('asset:btc', 'asset', { label: 'Wallet', class: 'crypto', symbol: 'BTC', quantity: 1 }),
      draft('asset:cash', 'asset', { label: 'Compte', class: 'cash', value: 1000, currency: 'CHF' }),
    );
    const { results } = runScenarios(s);
    const c = results.find((r) => r.scenario.id === 'crypto');
    expect(c).toBeDefined();
    const stressed = c!.scenario.apply(s);
    expect(stressed.assets.find((a) => a.class === 'crypto')!.value).toBeCloseTo(24000, 6);
    expect(stressed.assets.find((a) => a.class === 'cash')!.value).toBe(1000);
  });
});

describe('comptes de prévoyance', () => {
  const ctx = { age: 45, retirementAge: 65 };
  it('401(k): accessible à 59 ans et demi, imposé à la sortie', () => {
    const p = accessProfile('401k', ctx);
    expect(p.liquidityMonths).toBe(174);
    expect(p.haircut).toBe(0.25);
    expect(p.growthLike).toBe('securities');
  });
  it('Roth: décote faible', () => {
    expect(accessProfile('roth', ctx).haircut).toBe(0.05);
  });
  it('3a: cinq ans avant la retraite; LPP: à la retraite', () => {
    expect(accessProfile('3a', ctx).liquidityMonths).toBe(15 * 12);
    expect(accessProfile('lpp', ctx).liquidityMonths).toBe(20 * 12);
  });
  it('déjà passé 59 ans et demi: accessible tout de suite', () => {
    expect(accessProfile('401k', { age: 62, retirementAge: 65 }).liquidityMonths).toBe(0);
  });
  it('un 401(k) n apparaît dans les anneaux qu une fois accessible', () => {
    const s = snapshotWith(
      draft('income:s', 'income', { label: 'Salaire', amount: 5000, frequency: 'monthly', stable: false }),
      draft('expense:e', 'expense', { label: 'Vie', category: 'other', amount: 5000, frequency: 'monthly', essential: true }),
      draft('asset:k', 'asset', { label: '401(k)', class: 'pension', account: '401k', value: 500000, currency: 'USD' }),
    );
    const r = rings(s);
    expect(r[2].segments.some((x) => x.class === 'pension')).toBe(false); // 5 ans: pas encore (59,5 ans = dans 174 mois)
    expect(r[3].segments.some((x) => x.class === 'pension')).toBe(true);  // 20 ans: oui
  });
});

describe('hypothèses et cas', () => {
  const asset = { key: 'a', label: 'a', class: 'securities' as const, value: 1000, currency: 'CHF', valueNative: 1000, fx: 1, region: 'CH', real: true, liquidityMonths: 0, haircut: 0, certainty: 'confirmed' as const };

  it('croissance réelle composée, et rien à l instant présent', () => {
    expect(valueAt(asset, 0)).toBe(1000);
    expect(valueAt(asset, 120, { ...DEFAULT_ASSUMPTIONS, realGrowth: { ...DEFAULT_ASSUMPTIONS.realGrowth, securities: 0.02 } })).toBeCloseTo(1000 * 1.02 ** 10, 6);
  });

  it('la dérive des devises touche l étranger, pas le franc ni la crypto', () => {
    const as = { ...DEFAULT_ASSUMPTIONS, realGrowth: { ...DEFAULT_ASSUMPTIONS.realGrowth, securities: 0, crypto: 0 }, fxDrift: -0.02 };
    expect(valueAt({ ...asset, currency: 'USD' }, 120, as)).toBeCloseTo(1000 * 0.98 ** 10, 6);
    expect(valueAt(asset, 120, as)).toBe(1000);
    expect(valueAt({ ...asset, class: 'crypto', currency: 'USD' }, 120, as)).toBe(1000);
  });

  it('un compte américain suit la croissance des titres, pas celle de la prévoyance', () => {
    const k = { ...asset, class: 'pension' as const, growthLike: 'securities' as const };
    const lpp = { ...asset, class: 'pension' as const };
    expect(valueAt(k, 120)).toBeGreaterThan(valueAt(lpp, 120));
  });

  it('dépenses cumulées avec dérive', () => {
    expect(cumulativeDemand(100, 12, 0)).toBe(1200);
    expect(cumulativeDemand(100, 120, 0.01)).toBeGreaterThan(12000);
    expect(cumulativeDemand(100, 120, -0.01)).toBeLessThan(12000);
    expect(cumulativeDemand(0, 120, 0.01)).toBe(0);
  });

  it('pire cas <= cas de base <= meilleur cas, à chaque horizon et pour la tenue', () => {
    const l = new Ledger();
    loadDemo(l);
    const s = project(l.current(), new Date(), l.rates());
    const r = (c: 'worst' | 'base' | 'best') => rings(s, undefined, CASES[c].assumptions);
    for (let i = 0; i < 4; i++) {
      expect(r('worst')[i].coverage).toBeLessThanOrEqual(r('base')[i].coverage + 1e-9);
      expect(r('base')[i].coverage).toBeLessThanOrEqual(r('best')[i].coverage + 1e-9);
    }
    expect(runwayMonths(s, 600, CASES.worst.assumptions)).toBeLessThanOrEqual(runwayMonths(s, 600, CASES.best.assumptions));
    // l écart doit être réel sur l horizon long, sinon les cas n apportent rien
    expect(r('best')[3].coverage - r('worst')[3].coverage).toBeGreaterThan(0.05);
  });

  it('les chocs respectent le cas choisi', () => {
    const l = new Ledger();
    loadDemo(l);
    const s = project(l.current(), new Date(), l.rates());
    const worst = runScenarios(s, CASES.worst.assumptions);
    const best = runScenarios(s, CASES.best.assumptions);
    expect(worst.base[3].coverage).toBeLessThan(best.base[3].coverage);
  });
});

describe('estimation immobilière', () => {
  it('sans information, pas de chiffre inventé', () => {
    expect(estimateProperty({}, FIXED)).toBeNull();
  });

  it('indexe le prix d achat, fourchette large avec une seule méthode', () => {
    const e = estimateProperty({ purchasePrice: 800000, purchaseYear: 2016 }, FIXED)!;
    expect(e.methods).toHaveLength(1);
    expect(e.central).toBeCloseTo(800000 * 1.02 ** 10, 0);
    expect(e.certainty).toBe('low');
    expect((e.high - e.low) / e.central).toBeGreaterThan(0.2);
  });

  it('plusieurs méthodes: valeur pondérée, fourchette plus serrée, certitude moyenne', () => {
    const e = estimateProperty({ purchasePrice: 800000, indexSincePurchase: 1.2, areaM2: 120, pricePerM2: 8200, fiscalValue: 700000 }, FIXED)!;
    expect(e.methods.map((m) => m.id).sort()).toEqual(['comparables', 'fiscal', 'indexation']);
    expect(e.low).toBeLessThan(e.central);
    expect(e.central).toBeLessThan(e.high);
    expect(e.certainty).toBe('medium');
    const vals = e.methods.map((m) => m.value);
    expect(e.central).toBeGreaterThan(Math.min(...vals));
    expect(e.central).toBeLessThan(Math.max(...vals));
  });

  it('capitalise un loyer', () => {
    const e = estimateProperty({ netRentAnnual: 35000, capRate: 0.035 }, FIXED)!;
    expect(e.central).toBeCloseTo(1_000_000, 0);
  });

  it('projette une valeur future en francs d aujourd hui', () => {
    expect(projectValue(1_000_000, 20, 0.01)).toBeCloseTo(1_000_000 * 1.01 ** 20, 2);
    expect(projectValue(1_000_000, 20, 0)).toBe(1_000_000);
    expect(projectValue(1_000_000, 20, -0.02)).toBeLessThan(1_000_000);
  });
});

describe('cours dans le registre', () => {
  it('le plus récent l emporte, l historique reste', () => {
    const l = new Ledger();
    l.setPrice('usd', 0.88, 'ecb', '2026-10-01T00:00:00Z');
    l.setPrice('USD', 0.91, 'manual', '2026-10-20T00:00:00Z');
    expect(l.rates().rates.USD.perUnit).toBe(0.91);
    expect(l.rates().rates.USD.source).toBe('manual');
    expect(l.priceHistory('USD')).toHaveLength(2);
  });

  it('refuse un cours invalide', () => {
    const l = new Ledger();
    expect(() => l.setPrice('USD', -1)).toThrow();
    expect(() => l.setPrice('USD', NaN)).toThrow();
    expect(() => l.setPrice('$$', 1)).toThrow(/Symbole/);
  });

  it('un changement de cours déplace la valeur du patrimoine', () => {
    const l = new Ledger();
    loadDemo(l);
    const before = project(l.current(), new Date(), l.rates()).assets.find((a) => a.key === 'asset:titres')!.value;
    l.setPrice('USD', 0.8, 'manual');
    const after = project(l.current(), new Date(), l.rates()).assets.find((a) => a.key === 'asset:titres')!.value;
    expect(after).toBeCloseTo(120000 * 0.8, 4);
    expect(after).toBeLessThan(before);
  });
});

describe('estimation immobilière détaillée', () => {
  const base = { areaM2: 100, pricePerM2: 10000 };
  it('les annexes comptent pour une fraction de la surface habitable', () => {
    const a = estimateProperty({ ...base }, FIXED)!.central;
    const b = estimateProperty({ ...base, terraceM2: 20, gardenM2: 100, cellarM2: 10 }, FIXED)!.central;
    expect(b - a).toBeCloseTo((20 * 0.35 + 100 * 0.1 + 10 * 0.25) * 10000, 0);
  });
  it('les places de parc s ajoutent et sont signalées comme indicatives sans valeur donnée', () => {
    const e = estimateProperty({ ...base, parkingIndoor: 1, parkingOutdoor: 1 }, FIXED)!;
    expect(e.central).toBeCloseTo(1000000 + 35000 + 12000, 0);
    expect(e.methods[0].note).toMatch(/indicative/);
    const e2 = estimateProperty({ ...base, parkingIndoor: 2, parkingIndoorValue: 50000 }, FIXED)!;
    expect(e2.central).toBeCloseTo(1100000, 0);
    expect(e2.methods[0].note).not.toMatch(/indicative/);
  });
  it('état et situation ajustent le prix au m², pas les places de parc', () => {
    const e = estimateProperty({ ...base, condition: 'to_renovate', situation: 'quiet_view', parkingIndoor: 1, parkingIndoorValue: 30000 }, FIXED)!;
    expect(e.central).toBeCloseTo(1000000 * 0.85 * 1.05 + 30000, 0);
  });
  it('les travaux valorisants s ajoutent à la base d achat', () => {
    const e = estimateProperty({ purchasePrice: 800000, worksValue: 100000, indexSincePurchase: 1.1 }, FIXED)!;
    expect(e.central).toBeCloseTo(990000, 0);
  });
});

describe('biens comparables saisis', () => {
  it('médiane et dispersion du prix au m²', () => {
    const st = comparablesStats([{ price: 900000, areaM2: 100 }, { price: 1000000, areaM2: 100 }, { price: 1100000, areaM2: 100 }, { price: 0, areaM2: 50 }])!;
    expect(st.n).toBe(3);
    expect(st.median).toBe(10000);
    expect(st.spread).toBeCloseTo(0.05, 5);
    expect(comparablesStats([])).toBeNull();
  });
  it('une forte dispersion élargit la fourchette', () => {
    const a = estimateProperty({ areaM2: 100, pricePerM2: 10000, netRentAnnual: 36000, capRate: 0.036 }, FIXED)!;
    const b = estimateProperty({ areaM2: 100, pricePerM2: 10000, netRentAnnual: 36000, capRate: 0.036, comparablesSpread: 0.2 }, FIXED)!;
    expect(b.high - b.low).toBeGreaterThan(a.high - a.low);
  });
});

describe('ancrage sur la dernière estimation connue', () => {
  it('relève une estimation par indexation trop basse et le dit', () => {
    const lowOnly = estimateProperty({ purchasePrice: 573000, purchaseYear: 2007 }, FIXED)!;
    const anchored = estimateProperty({ purchasePrice: 573000, purchaseYear: 2007, ownerValue: 1255000, ownerValueYear: 2023 }, FIXED)!;
    expect(anchored.central).toBeGreaterThan(lowOnly.central);
    expect(anchored.methods.some((m) => m.id === 'estimation' && /Estimation de 2023/.test(m.note))).toBe(true);
  });
});

describe('méthodes génériques et ancrées', () => {
  it('une estimation connue et un prix au m² resserrent la fourchette autour du marché', () => {
    const e = estimateProperty({ ownerValue: 1255000, ownerValueYear: 2023, purchasePrice: 573000, purchaseYear: 2007, netRentAnnual: 31557, areaM2: 109, pricePerM2: 13000 }, FIXED)!;
    expect(e.low).toBeGreaterThan(1000000);
    expect(e.central).toBeGreaterThan(1250000);
    expect(e.methods.find((m) => m.id === 'rendement')!.weight).toBeLessThan(0.3);
  });
});

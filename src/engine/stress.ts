import type { Snapshot } from './types';
import { rings, runwayMonths, type Ring } from './horizons';
import { DEFAULT_ASSUMPTIONS, type Assumptions } from './assumptions';

export interface Scenario {
  id: string;
  label: string;
  summary: string;
  apply: (s: Snapshot) => Snapshot;
}

const clone = (s: Snapshot): Snapshot => structuredClone(s);

export const SCENARIOS: Scenario[] = [
  {
    id: 'krach',
    label: 'Krach boursier',
    summary: 'Les titres perdent 30 %, les entreprises détenues 40 %.',
    apply: (s) => {
      const o = clone(s);
      for (const a of o.assets) {
        if (a.class === 'securities') a.value *= 0.7;
        if (a.class === 'business') a.value *= 0.6;
      }
      return o;
    },
  },
  {
    id: 'crypto',
    label: 'Crypto en chute',
    summary: 'Les cryptomonnaies perdent 60 %.',
    apply: (s) => {
      const o = clone(s);
      for (const a of o.assets) if (a.class === 'crypto') a.value *= 0.4;
      return o;
    },
  },
  {
    id: 'immobilier',
    label: 'Immobilier en baisse',
    summary: 'Les biens immobiliers perdent 20 %, la dette reste identique.',
    apply: (s) => {
      const o = clone(s);
      for (const a of o.assets) if (a.class === 'real_estate') a.value *= 0.8;
      return o;
    },
  },
  {
    id: 'taux',
    label: 'Hausse des taux',
    summary: 'Les dettes à taux variable coûtent 2 points de plus.',
    apply: (s) => {
      const o = clone(s);
      const extra = o.liabilities.filter((l) => l.variable).reduce((a, l) => a + (l.balance * 0.02) / 12, 0);
      if (extra > 0) {
        o.expenses.push({
          key: 'stress:interets',
          label: 'Intérêts supplémentaires',
          category: 'housing',
          monthly: extra,
          essential: true,
          certainty: 'assumed',
        });
      }
      return o;
    },
  },
  {
    id: 'inflation',
    label: 'Inflation forte',
    summary: 'Les dépenses augmentent de 20 % sur 5 ans, les liquidités perdent autant en pouvoir d’achat.',
    apply: (s) => {
      const o = clone(s);
      for (const e of o.expenses) e.monthly *= 1.2;
      for (const a of o.assets) if (!a.real) a.value /= 1.2;
      for (const l of o.liabilities) if (!l.variable) l.balance /= 1.2;
      return o;
    },
  },
  {
    id: 'franc-fort',
    label: 'Franc fort',
    summary: 'Les actifs et dettes hors CHF perdent 10 % de valeur en francs.',
    apply: (s) => {
      const o = clone(s);
      for (const a of o.assets) if (a.currency !== 'CHF') a.value *= 0.9;
      for (const l of o.liabilities) if (l.currency !== 'CHF') l.balance *= 0.9;
      return o;
    },
  },
];

export interface ScenarioResult {
  scenario: Scenario;
  rings: Ring[];
  runwayMonths: number;
  /** Variation de couverture par anneau, en points de pourcentage (négatif = perte). */
  coverageDelta: number[];
}

export function runScenarios(s: Snapshot, as: Assumptions = DEFAULT_ASSUMPTIONS): { base: Ring[]; baseRunway: number; results: ScenarioResult[] } {
  const base = rings(s, undefined, as);
  const baseRunway = runwayMonths(s, 600, as);
  const results = SCENARIOS.map((scenario) => {
    const st = scenario.apply(s);
    const r = rings(st, undefined, as);
    return {
      scenario,
      rings: r,
      runwayMonths: runwayMonths(st, 600, as),
      coverageDelta: r.map((ring, i) => ring.coverage - base[i].coverage),
    };
  });
  return { base, baseRunway, results };
}

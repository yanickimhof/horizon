import type { Snapshot } from './types';
import type { Assumptions } from './assumptions';

/**
 * Impôt sur les retraits en capital de la prévoyance (2e pilier et 3e pilier a), Vaud, année fiscale 2026.
 * Taux moyens total fédéral + cantonal + communal pour UN capital perçu dans l'année, tirés du calculateur de
 * l'Administration fédérale des contributions (module « prestations en capital »), relevés par ibani.com le 15.10.2026
 * pour Lausanne. La commune d'Echallens a d'autres coefficients: ces taux sont un repère, pas la taxation.
 * Entre les points, interpolation linéaire; au-delà de 1 million, le dernier taux est conservé (le fédéral plafonne à 2,3 %).
 * Toutes les prestations en capital de prévoyance perçues la même année s'additionnent: c'est ce qui rend l'échelonnement utile.
 */
export const CAPITAL_TAX_MARRIED: [number, number][] = [[0, 0], [100_000, 0.0364], [250_000, 0.0601], [500_000, 0.0758], [1_000_000, 0.0868]];
export const CAPITAL_TAX_SINGLE: [number, number][] = [[0, 0], [100_000, 0.0459], [250_000, 0.0694], [500_000, 0.0839], [1_000_000, 0.0906]];

function rateAt(points: [number, number][], x: number): number {
  if (x <= 0) return 0;
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

/** Impôt sur un capital de prévoyance perçu une année donnée. */
export const capitalTax = (amount: number, table: [number, number][] = CAPITAL_TAX_MARRIED): number => amount * rateAt(table, amount);

export interface PensionItem {
  key: string;
  label: string;
  account: 'lpp' | '3a';
  /** Valeur d'aujourd'hui en francs. */
  now: number;
  /** Cotisation mensuelle jusqu'à la retraite. */
  contribution: number;
}

export interface Plan {
  id: 'once' | 'sep3a' | 'split';
  label: string;
  rule: string;
  /** Impôt par année (âge) -> capital et impôt. */
  years: { age: number; capital: number; tax: number; items: string[] }[];
  tax: number;
  /** Même plan avec le barème d'une personne seule (borne haute). */
  taxHigh: number;
  rate: number;
  saving: number;
}

export interface Withdrawals {
  retireAge: number;
  firstAge: number;
  items: (PensionItem & { atRetirement: number })[];
  total: number;
  plans: Plan[];
  /** Décote moyenne retenue aujourd'hui par le moteur de retraite sur ces capitaux, pour comparaison. */
  engineRate: number;
  /** Ce qui n'est pas calculé ici. */
  excluded: string[];
}

/** Capitaux de prévoyance suisses du bilan: LPP et 3e pilier a. Les autres (401(k), assurances-vie) sont exclus. */
export function pensionItems(s: Snapshot): PensionItem[] {
  return s.assets
    .filter((a) => a.class === 'pension' && (a.account === 'lpp' || a.account === '3a') && a.value > 0)
    .map((a) => ({ key: a.key, label: a.label, account: a.account as 'lpp' | '3a', now: a.value, contribution: a.contribution ?? 0 }));
}

/** Valeur à `years` ans: capital qui croît au taux réel, plus les cotisations mensuelles versées jusqu'à la retraite. */
export function projectItem(it: PensionItem, years: number, contributionYears: number, g: number): number {
  const grow = (y: number) => Math.pow(1 + g, y);
  let v = it.now * grow(years);
  const months = Math.round(Math.min(years, contributionYears) * 12);
  for (let m = 1; m <= months; m++) v += it.contribution * grow(years - m / 12);
  return v;
}

const AGES_FIRST = 60;

/**
 * Compare trois façons de sortir les capitaux, sur les années de 60 à l'âge de la retraite.
 * 1. Tout la même année (retraite). 2. Chaque 3e pilier a dans une année distincte, le 2e pilier à la retraite.
 * 3. Comme 2, avec le 2e pilier retiré en deux temps, des années différentes (retraite partielle selon le règlement de la caisse).
 * La meilleure répartition par année est trouvée par énumération (peu d'éléments, donc exact).
 */
export function withdrawals(s: Snapshot, as: Assumptions, retireAge: number): Withdrawals | null {
  const base = pensionItems(s);
  if (base.length === 0) return null;
  const age0 = new Date(s.asOf).getFullYear() - s.household.birthYear;
  const yearsToR = Math.max(0, retireAge - age0);
  const g = as.realGrowth.pension ?? 0;
  const first = Math.min(AGES_FIRST, retireAge);
  const ages = Array.from({ length: retireAge - first + 1 }, (_, i) => first + i);
  const value = (it: PensionItem, age: number) => projectItem(it, Math.max(0, age - age0), yearsToR, g);
  const items = base.map((it) => ({ ...it, atRetirement: value(it, retireAge) }));
  const total = items.reduce((a, x) => a + x.atRetirement, 0);

  type Piece = { label: string; item: PensionItem; share: number; fixedAge?: number };
  const solve = (pieces: Piece[], table: [number, number][]): { tax: number; assign: number[] } => {
    let best = { tax: Infinity, assign: [] as number[] };
    const n = pieces.length;
    const assign = new Array<number>(n).fill(0);
    const rec = (i: number) => {
      if (i === n) {
        const sums = new Map<number, number>();
        pieces.forEach((p, k) => sums.set(ages[assign[k]], (sums.get(ages[assign[k]]) ?? 0) + value(p.item, ages[assign[k]]) * p.share));
        let tax = 0;
        for (const v of sums.values()) tax += capitalTax(v, table);
        if (tax < best.tax) best = { tax, assign: [...assign] };
        return;
      }
      const p = pieces[i];
      const opts = p.fixedAge !== undefined ? [ages.indexOf(p.fixedAge)] : ages.map((_, k) => k);
      for (const k of opts) {
        assign[i] = k;
        rec(i + 1);
      }
    };
    rec(0);
    return best;
  };

  const describe = (pieces: Piece[], assign: number[]): Plan['years'] => {
    const by = new Map<number, { capital: number; items: string[] }>();
    pieces.forEach((p, k) => {
      const age = ages[assign[k]];
      const cur = by.get(age) ?? { capital: 0, items: [] };
      cur.capital += value(p.item, age) * p.share;
      cur.items.push(p.share < 1 ? `${p.label} (moitié)` : p.label);
      by.set(age, cur);
    });
    return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([age, v]) => ({ age, capital: v.capital, tax: capitalTax(v.capital), items: v.items }));
  };

  const mk = (id: Plan['id'], label: string, rule: string, pieces: Piece[], once: number): Plan => {
    const low = solve(pieces, CAPITAL_TAX_MARRIED);
    const high = solve(pieces, CAPITAL_TAX_SINGLE);
    const years = describe(pieces, low.assign);
    return { id, label, rule, years, tax: low.tax, taxHigh: high.tax, rate: total > 0 ? low.tax / total : 0, saving: once - low.tax };
  };

  const lpp = base.filter((i) => i.account === 'lpp');
  const a3 = base.filter((i) => i.account === '3a');
  const wholeAt = (list: PensionItem[], fixed?: number): Piece[] => list.map((it) => ({ label: it.label, item: it, share: 1, fixedAge: fixed }));
  const oncePieces = [...wholeAt(lpp, retireAge), ...wholeAt(a3, retireAge)];
  const onceTax = solve(oncePieces, CAPITAL_TAX_MARRIED).tax;
  const sep = [...wholeAt(lpp, retireAge), ...wholeAt(a3)];
  const split: Piece[] = [
    ...lpp.flatMap((it) => [{ label: it.label, item: it, share: 0.5 }, { label: it.label, item: it, share: 0.5 }]),
    ...wholeAt(a3),
  ];

  const plans: Plan[] = [
    mk('once', 'Tout la même année', `Tous les capitaux sortent à ${retireAge} ans.`, oncePieces, onceTax),
    mk('sep3a', 'Le 3e pilier a avant la retraite', `Chaque 3e pilier a sort dans une année distincte entre ${first} et ${retireAge} ans; le 2e pilier sort à ${retireAge} ans.`, sep, onceTax),
    mk('split', 'Le 2e pilier en deux temps', `Comme ci-dessus, avec le 2e pilier retiré en deux temps, des années différentes dès ${first} ans (retraite partielle).`, split, onceTax),
  ];

  const engineRate = total > 0 ? items.reduce((a, x) => a + x.atRetirement * (x.account === '3a' ? 0.08 : 0.1), 0) / total : 0;
  return {
    retireAge,
    firstAge: first,
    items,
    total,
    plans,
    engineRate,
    excluded: [
      '401(k): l’imposition à la sortie dépend de la convention fiscale Suisse-États-Unis et de la forme du retrait; le moteur garde une estimation de 25 %, non sourcée.',
      'Assurances-vie 3b (AXA, Zurich): régime fiscal propre, non calculé ici.',
      'Revenu ordinaire de l’année du retrait: l’impôt sur les capitaux est séparé et ne dépend pas de lui dans ce calcul.',
    ],
  };
}

import type { AssetClass, Snapshot } from './types';
import { DEFAULT_ASSUMPTIONS, valueAt, type Assumptions } from './assumptions';
import { activeNow, isActive } from './timing';

/** Les quatre anneaux : 3 mois, 1 an, 5 ans, 20 ans. */
export const HORIZONS = [3, 12, 60, 240] as const;

/** Ordre d'empilement des sources dans un anneau : du plus liquide au plus immobilisé. */
export const SOURCE_ORDER: AssetClass[] = ['cash', 'securities', 'crypto', 'other', 'business', 'real_estate', 'pension'];

export interface Segment {
  class: AssetClass;
  /** Part du niveau de vie à financer sur cet horizon, 0 à 1. */
  share: number;
}

export interface Ring {
  months: number;
  /** Part du niveau de vie couverte, 0 à 1. */
  coverage: number;
  segments: Segment[];
  /** Part non couverte, 0 à 1. */
  gap: number;
}

/** Dépenses récurrentes actives aujourd'hui (les études qui commencent dans 3 ans n'y sont pas). */
export function monthlyExpenses(s: Snapshot): number {
  return s.expenses.filter(activeNow).reduce((a, e) => a + e.monthly, 0);
}

/** Revenus qui continuent si le salaire s'arrête, actifs aujourd'hui. */
export function stableIncomeNow(s: Snapshot): number {
  return s.incomes.filter((i) => i.stable && activeNow(i)).reduce((a, i) => a + i.monthly, 0);
}

/** Dépenses nettes des revenus qui continuent, aujourd'hui. */
export function monthlyBurn(s: Snapshot): number {
  return Math.max(0, monthlyExpenses(s) - stableIncomeNow(s));
}

/**
 * Besoin cumulé de financement, mois après mois, en francs d'aujourd'hui, si le salaire s'arrête.
 * cum[m] = ce qu'il faut avoir payé au bout de m mois. Tient compte, mois par mois:
 * - des dépenses qui commencent ou s'arrêtent (études, fin d'un crédit),
 * - des revenus stables qui démarrent plus tard (rente AVS ou LPP à la retraite),
 * - des dépenses ponctuelles à leur date (travaux, mariage),
 * - de la dérive du niveau de vie de l'hypothèse choisie.
 */
export function demandCurve(s: Snapshot, as: Assumptions, maxMonths: number): Float64Array {
  const cum = new Float64Array(maxMonths + 1);
  const g = Math.pow(1 + as.expenseGrowth, 1 / 12);
  let drift = 1;
  for (let t = 0; t < maxMonths; t++) {
    let rec = 0;
    let lump = 0;
    for (const e of s.expenses) {
      if (e.lump) {
        if (e.lump.month === t) lump += e.lump.amount;
      } else if (isActive(e, t)) rec += e.monthly;
    }
    let inc = 0;
    for (const i of s.incomes) if (i.stable && isActive(i, t)) inc += i.monthly;
    cum[t + 1] = cum[t] + (Math.max(0, rec - inc) + lump) * drift;
    drift *= g;
  }
  return cum;
}

/** Valeur nette mobilisable d'un actif : décote appliquée, dette garantie déduite. */
export function netAvailable(s: Snapshot, assetKey: string, months = 0, as: Assumptions = DEFAULT_ASSUMPTIONS): number {
  const a = s.assets.find((x) => x.key === assetKey);
  if (!a) return 0;
  const debt = s.liabilities.filter((l) => l.securedBy === a.key).reduce((t, l) => t + l.balance, 0);
  return Math.max(0, valueAt(a, months, as) * (1 - a.haircut) - debt);
}

/** Capital mobilisable au bout de `months` mois, par classe d'actifs. */
export function availableByClass(s: Snapshot, months: number, as: Assumptions = DEFAULT_ASSUMPTIONS): Map<AssetClass, number> {
  const out = new Map<AssetClass, number>();
  for (const a of s.assets) {
    if (a.liquidityMonths > months) continue;
    out.set(a.class, (out.get(a.class) ?? 0) + netAvailable(s, a.key, months, as));
  }
  return out;
}

export function rings(s: Snapshot, horizons: readonly number[] = HORIZONS, as: Assumptions = DEFAULT_ASSUMPTIONS): Ring[] {
  const cum = demandCurve(s, as, Math.max(...horizons));
  return horizons.map((months) => {
    const demand = cum[months];
    if (demand <= 0) return { months, coverage: 1, segments: [], gap: 0 };
    const avail = availableByClass(s, months, as);
    let used = 0;
    const segments: Segment[] = [];
    for (const cls of SOURCE_ORDER) {
      const share = Math.min((avail.get(cls) ?? 0) / demand, 1 - used);
      if (share <= 0) continue;
      segments.push({ class: cls, share });
      used += share;
    }
    return { months, coverage: used, segments, gap: 1 - used };
  });
}

/** Nombre de mois tenus sans salaire. Infinity si les revenus stables et le temps couvrent tout. */
export function runwayMonths(s: Snapshot, maxMonths = 600, as: Assumptions = DEFAULT_ASSUMPTIONS): number {
  const cum = demandCurve(s, as, maxMonths);
  if (cum[maxMonths] <= 0) return Infinity;
  for (let m = 1; m <= maxMonths; m++) {
    const avail = [...availableByClass(s, m, as).values()].reduce((a, b) => a + b, 0);
    if (cum[m] > avail) return m - 1;
  }
  return Infinity;
}

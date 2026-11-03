import { COUNTRY } from './country';

/** Interpolation linéaire entre points triés; au-delà du dernier point, on reste sur sa valeur. */
function interpolate(points: [number, number][], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

/**
 * Impôt annuel sur la fortune (canton et commune), pour une fortune imposable donnée. Barème de base officiel
 * (administration cantonale des impôts, 2025), multiplié par les coefficients cantonal et communal.
 */
export function wealthTax(taxableFortune: number): number {
  const t = COUNTRY.tax;
  if (taxableFortune <= 0) return 0;
  const last = t.wealthScale[t.wealthScale.length - 1];
  const base = taxableFortune > last[0] ? last[1] + (taxableFortune - last[0]) * t.wealthTopMarginal : interpolate(t.wealthScale, taxableFortune);
  return base * t.wealthCoefficient;
}

/** Impôt annuel sur le revenu (canton, commune et Confédération), au taux moyen observé pour ce revenu imposable. */
export function incomeTax(taxableIncome: number): number {
  if (taxableIncome <= 0) return 0;
  return taxableIncome * interpolate(COUNTRY.tax.incomeRates, taxableIncome);
}

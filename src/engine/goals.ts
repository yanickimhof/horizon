import type { Snapshot } from './types';
import { HORIZONS, monthlyExpenses } from './horizons';

export interface GoalMarker {
  key: string;
  label: string;
  monthsAway: number;
  /** Anneau le plus proche de l'échéance (index dans HORIZONS). */
  ringIndex: number;
  /** Coût exprimé en mois de niveau de vie, sans montant. */
  costInMonthsOfLife: number;
  /** Part déjà épargnée, 0 à 1. */
  funded: number;
}

export function goalMarkers(s: Snapshot, now: Date = new Date()): GoalMarker[] {
  const e = monthlyExpenses(s);
  const nowMonths = now.getFullYear() * 12 + now.getMonth();
  return s.goals.map((g) => {
    const monthsAway = Math.max(0, g.targetYear * 12 + 11 - nowMonths);
    let ringIndex = 0;
    let best = Infinity;
    HORIZONS.forEach((h, i) => {
      const d = Math.abs(Math.log((monthsAway || 1) / h));
      if (d < best) {
        best = d;
        ringIndex = i;
      }
    });
    return {
      key: g.key,
      label: g.label,
      monthsAway,
      ringIndex,
      costInMonthsOfLife: e > 0 ? g.targetAmount / e : Infinity,
      funded: g.targetAmount > 0 ? Math.min(1, g.saved / g.targetAmount) : 0,
    };
  });
}

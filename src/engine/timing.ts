/**
 * Fenêtres de temps. Un flux (dépense, revenu) peut commencer plus tard (études dans 3 ans,
 * rente à la retraite) ou s'arrêter (fin des études). Les mois sont comptés depuis la date de l'instantané.
 */
export interface Windowed {
  /** Mois depuis maintenant où le flux commence. Absent: déjà actif. */
  startMonth?: number;
  /** Mois depuis maintenant où le flux s'arrête (exclu). Absent: sans fin. */
  endMonth?: number;
}

export const isActive = (x: Windowed, month: number): boolean =>
  (x.startMonth === undefined || month >= x.startMonth) && (x.endMonth === undefined || month < x.endMonth);

export const activeNow = (x: Windowed): boolean => isActive(x, 0);

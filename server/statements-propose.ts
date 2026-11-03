import type { Ledger } from './ledger';
import { project } from '../src/core/project';
import { HORIZON_GROUPS } from './statements';

/**
 * Transforme un écart entre les relevés et Horizon en proposition à valider.
 * Quand les relevés montrent plus de dépenses que ce qu'Horizon connaît, on propose de relever la plus grosse ligne du
 * groupe de l'écart; s'il n'y a aucune ligne dans ce groupe, on en propose une nouvelle. Rien n'est modifié avant validation.
 */
export interface GapIn {
  key: string;
  /** Dépenses du groupe selon les relevés, par mois. */
  statements: number;
  /** Dépenses du groupe selon Horizon, par mois. */
  horizon: number;
}

const CATEGORY: Record<string, string> = { assurances: 'insurance', impots: 'tax', logement: 'housing', vehicule: 'transport', vie: 'lifestyle' };

export function proposeGap(l: Ledger, g: GapIn): { proposed: number; note: string } {
  const group = HORIZON_GROUPS.find((x) => x.key === g.key);
  if (!group) throw new Error('Catégorie inconnue.');
  const gap = g.statements - g.horizon;
  if (!(gap > 1)) return { proposed: 0, note: 'Aucun écart à corriger.' };
  const why = `Écart avec les relevés bancaires: ${Math.round(g.statements)} par mois contre ${Math.round(g.horizon)} dans Horizon`;
  const snap = project(l.current(), new Date(), l.rates());
  const biggest = snap.expenses.filter((e) => !e.lump && group.horizon(e.category)).sort((a, b) => b.monthly - a.monthly)[0];
  const fact = biggest ? l.current().find((f) => f.key === biggest.key) : undefined;
  if (biggest && fact) {
    const annual = fact.data.frequency === 'annual';
    const monthly = biggest.monthly + gap;
    const data = { ...fact.data, amount: Math.round((annual ? monthly * 12 : monthly) * 100) / 100, frequency: annual ? 'annual' : 'monthly' };
    l.propose({ kind: 'expense', key: fact.key, data, status: 'proposed', origin: 'inferred', confidence: 0.5, sourceId: null, excerpt: null, why });
    return { proposed: 1, note: `Proposition: relever « ${biggest.label} » de ${Math.round(gap)} par mois.` };
  }
  l.propose({
    kind: 'expense',
    key: `expense:releves-${g.key}`,
    data: { label: `${group.label} (selon les relevés)`, category: CATEGORY[g.key] ?? 'other', amount: Math.round(gap * 100) / 100, frequency: 'monthly', essential: false, currency: 'CHF' },
    status: 'proposed',
    origin: 'inferred',
    confidence: 0.5,
    sourceId: null,
    excerpt: null,
    why,
  });
  return { proposed: 1, note: `Proposition: nouvelle ligne de ${Math.round(gap)} par mois.` };
}

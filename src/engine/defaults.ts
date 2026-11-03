import type { FactDraft } from '../core/types';
import type { Frequency } from './frequency';

/**
 * Valeurs standard INDICATIVES (CHF, ordre de grandeur suisse), non sourcées.
 * Elles ne servent qu'à ne jamais laisser un trou : chaque ligne est créée
 * avec le statut "assumed" et sera remplacée dès que la vraie valeur est connue.
 * À valider avec des sources officielles avant toute diffusion.
 */
interface Template {
  id: string;
  label: string;
  category: string;
  amount: number;
  frequency: Frequency;
  essential: boolean;
  scale: 'household' | 'adult' | 'child';
  only?: 'owner' | 'tenant';
  /** Part du revenu mensuel net du foyer, si connu. */
  incomeShare?: number;
  min?: number;
  max?: number;
  why: string;
}

const TEMPLATES: Template[] = [
  { id: 'rent', label: 'Loyer', category: 'housing', amount: 1900, frequency: 'monthly', essential: true, scale: 'household', only: 'tenant', incomeShare: 0.24, min: 1200, max: 3800, why: 'Environ un quart du revenu net' },
  { id: 'mortgage', label: 'Hypothèque (intérêts et amortissement)', category: 'housing', amount: 2300, frequency: 'monthly', essential: true, scale: 'household', only: 'owner', incomeShare: 0.22, min: 1200, max: 5500, why: 'Environ 22 % du revenu net' },
  { id: 'ownership', label: 'Entretien et charges de propriété', category: 'housing', amount: 5000, frequency: 'annual', essential: true, scale: 'household', only: 'owner', why: 'Environ 1 % de la valeur du bien, à affiner' },
  { id: 'utilities', label: 'Électricité, eau, chauffage', category: 'housing', amount: 200, frequency: 'monthly', essential: true, scale: 'household', why: 'Moyenne indicative' },
  { id: 'telecom', label: 'Internet et mobile', category: 'lifestyle', amount: 130, frequency: 'monthly', essential: true, scale: 'household', why: 'Moyenne indicative' },
  { id: 'health-adult', label: 'Assurance maladie (LAMal)', category: 'insurance', amount: 430, frequency: 'monthly', essential: true, scale: 'adult', why: 'Prime moyenne indicative par adulte' },
  { id: 'health-child', label: 'Assurance maladie enfant', category: 'insurance', amount: 115, frequency: 'monthly', essential: true, scale: 'child', why: 'Prime moyenne indicative par enfant' },
  { id: 'health-out', label: 'Frais de santé non remboursés', category: 'insurance', amount: 90, frequency: 'monthly', essential: true, scale: 'household', why: 'Franchise et quote-part, moyenne indicative' },
  { id: 'home-ins', label: 'Assurances ménage et RC', category: 'insurance', amount: 500, frequency: 'annual', essential: true, scale: 'household', why: 'Moyenne indicative' },
  { id: 'car', label: 'Voiture (assurance, taxes, entretien, carburant)', category: 'mobility', amount: 650, frequency: 'monthly', essential: true, scale: 'household', why: 'Un véhicule, usage courant' },
  { id: 'transit', label: 'Transports publics', category: 'mobility', amount: 90, frequency: 'monthly', essential: false, scale: 'adult', why: 'Abonnement partiel' },
  { id: 'food', label: 'Alimentation', category: 'food', amount: 450, frequency: 'monthly', essential: true, scale: 'adult', why: 'Moyenne indicative par adulte' },
  { id: 'food-child', label: 'Alimentation enfant', category: 'food', amount: 250, frequency: 'monthly', essential: true, scale: 'child', why: 'Moyenne indicative par enfant' },
  { id: 'childcare', label: 'Garde et activités des enfants', category: 'family', amount: 350, frequency: 'monthly', essential: true, scale: 'child', why: 'Moyenne indicative par enfant' },
  { id: 'leisure', label: 'Loisirs et sorties', category: 'lifestyle', amount: 400, frequency: 'monthly', essential: false, scale: 'household', why: 'Moyenne indicative' },
  { id: 'holidays', label: 'Vacances', category: 'lifestyle', amount: 4500, frequency: 'annual', essential: false, scale: 'household', why: 'Moyenne indicative' },
  { id: 'subs', label: 'Abonnements', category: 'lifestyle', amount: 60, frequency: 'monthly', essential: false, scale: 'household', why: 'Moyenne indicative' },
  { id: 'clothes', label: 'Vêtements et divers', category: 'lifestyle', amount: 150, frequency: 'monthly', essential: false, scale: 'adult', why: 'Moyenne indicative par adulte' },
  { id: 'tax', label: 'Impôts', category: 'tax', amount: 1000, frequency: 'monthly', essential: true, scale: 'household', incomeShare: 0.15, min: 300, max: 6000, why: 'Environ 15 % du revenu net, très variable selon le canton' },
];

export interface StandardInput {
  adults: number;
  children: number;
  owner: boolean;
  /** Revenu mensuel net du foyer, si connu. */
  monthlyIncome?: number;
}

/** Dépenses standard, à insérer avec ledger.assume(). La clé permet de les remplacer plus tard. */
export function standardExpenses(h: StandardInput): FactDraft[] {
  const out: FactDraft[] = [];
  for (const t of TEMPLATES) {
    if (t.only === 'owner' && !h.owner) continue;
    if (t.only === 'tenant' && h.owner) continue;
    const count = t.scale === 'adult' ? h.adults : t.scale === 'child' ? h.children : 1;
    if (count <= 0) continue;
    let amount = t.amount;
    if (t.incomeShare && h.monthlyIncome && h.monthlyIncome > 0) {
      amount = Math.min(t.max ?? Infinity, Math.max(t.min ?? 0, Math.round(h.monthlyIncome * t.incomeShare)));
    }
    out.push({
      kind: 'expense',
      key: `expense:${t.id}`,
      data: {
        label: t.label,
        category: t.category,
        amount: Math.round(amount * count),
        frequency: t.frequency,
        essential: t.essential,
        templateId: t.id,
      },
      status: 'assumed',
      origin: 'default',
      confidence: 0.3,
      sourceId: null,
      excerpt: null,
      why: `Valeur standard: ${t.why}`,
    });
  }
  return out;
}

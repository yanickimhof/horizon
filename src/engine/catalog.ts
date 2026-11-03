import type { AssetClass } from './types';

/**
 * Catalogue des types d'actifs. C'est ce qui évite le piège des applications trop génériques:
 * tout actif obéit à un CONTRAT MINIMAL COMMUN, et le type ne fait que préremplir ses propriétés.
 *
 * Contrat minimal (valable pour n'importe quel actif, même exotique):
 *   1. valeur (ou quantité x cours) et devise
 *   2. part détenue (copropriété, indivision)
 *   3. quand c'est mobilisable (mois)
 *   4. ce qu'on perd à la sortie (impôts, frais, décote)
 *   5. croissance réelle supposée (via une classe de référence)
 *
 * Un actif absent du catalogue se décrit en saisissant directement ces propriétés ("Autre, sur mesure").
 * Ajouter un type = ajouter une ligne ici, sans toucher au moteur.
 *
 * ATTENTION: profils INDICATIFS, NON sourcés. Chaque champ reste modifiable ligne par ligne.
 */
export interface CatalogEntry {
  id: string;
  label: string;
  group: 'Liquidités et placements' | 'Immobilier' | 'Entreprise et titres non cotés' | 'Prévoyance' | 'Autres actifs';
  class: AssetClass;
  /** Valeurs de départ, remplacées par toute valeur saisie sur la ligne. */
  profile?: { liquidityMonths?: number; haircut?: number; real?: boolean; growthLike?: AssetClass; occupied?: boolean };
  /** Question à poser pour compléter le type, affichée à l'utilisateur. */
  hint?: string;
}

export const ASSET_CATALOG: CatalogEntry[] = [
  { id: 'current', label: 'Compte courant ou épargne', group: 'Liquidités et placements', class: 'cash' },
  { id: 'term-deposit', label: 'Dépôt à terme', group: 'Liquidités et placements', class: 'cash', profile: { liquidityMonths: 6, haircut: 0.02 }, hint: 'À quelle échéance le dépôt est-il libéré ?' },
  { id: 'funds', label: 'Titres et fonds', group: 'Liquidités et placements', class: 'securities' },
  { id: 'crypto', label: 'Cryptomonnaies', group: 'Liquidités et placements', class: 'crypto', hint: 'Symbole et quantité: la valeur se calcule avec le cours.' },
  { id: 'gold', label: 'Or et métaux précieux', group: 'Liquidités et placements', class: 'other', profile: { liquidityMonths: 1, haircut: 0.08, real: true } },

  { id: 'home', label: 'Résidence principale', group: 'Immobilier', class: 'real_estate', profile: { occupied: true }, hint: 'La dette garantie se déduit du bien. Part détenue si copropriété.' },
  { id: 'rental', label: 'Bien locatif', group: 'Immobilier', class: 'real_estate', hint: 'Le loyer net sert à l’estimer et peut compter comme revenu stable.' },
  { id: 'second-home', label: 'Résidence secondaire', group: 'Immobilier', class: 'real_estate' },
  { id: 'land', label: 'Terrain', group: 'Immobilier', class: 'real_estate', profile: { liquidityMonths: 12, haircut: 0.15 } },

  { id: 'business', label: 'Parts d’entreprise', group: 'Entreprise et titres non cotés', class: 'business', hint: 'Valeur retenue prudente, vente rarement immédiate.' },
  { id: 'rsu', label: 'Actions ou options non acquises', group: 'Entreprise et titres non cotés', class: 'securities', profile: { liquidityMonths: 12, haircut: 0.35 }, hint: 'Indique dans combien de mois elles sont acquises.' },
  { id: 'private-fund', label: 'Fonds ou prêt non coté', group: 'Entreprise et titres non cotés', class: 'business', profile: { liquidityMonths: 60, haircut: 0.3 } },

  { id: 'lpp', label: 'LPP (2e pilier suisse)', group: 'Prévoyance', class: 'pension' },
  { id: '3a', label: '3e pilier a (Suisse)', group: 'Prévoyance', class: 'pension' },
  { id: '401k', label: '401(k) États-Unis', group: 'Prévoyance', class: 'pension' },
  { id: 'ira', label: 'IRA traditionnel (États-Unis)', group: 'Prévoyance', class: 'pension' },
  { id: 'roth', label: 'Roth 401(k) ou IRA (États-Unis)', group: 'Prévoyance', class: 'pension' },
  { id: 'life-insurance', label: 'Assurance-vie (valeur de rachat)', group: 'Prévoyance', class: 'other', profile: { liquidityMonths: 2, haircut: 0.1 } },

  { id: 'art', label: 'Art, bijoux, objets de valeur', group: 'Autres actifs', class: 'other', profile: { liquidityMonths: 6, haircut: 0.25, real: true } },
  { id: 'vehicle', label: 'Véhicule', group: 'Autres actifs', class: 'other', profile: { liquidityMonths: 1, haircut: 0.15, real: false } },
  { id: 'loan-given', label: 'Prêt accordé à un tiers', group: 'Autres actifs', class: 'other', profile: { liquidityMonths: 12, haircut: 0.2 }, hint: 'Échéance de remboursement et solvabilité.' },
  { id: 'custom', label: 'Autre, sur mesure', group: 'Autres actifs', class: 'other', hint: 'Saisis toi-même quand c’est mobilisable et ce qu’on perd à la sortie.' },
];

export const catalogEntry = (id: string | undefined): CatalogEntry | undefined => ASSET_CATALOG.find((e) => e.id === id);

export const CATALOG_GROUPS = [...new Set(ASSET_CATALOG.map((e) => e.group))];

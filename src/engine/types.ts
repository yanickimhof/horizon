export type Certainty = 'confirmed' | 'assumed';
import type { RateTable } from './fx';
import type { Windowed } from './timing';

export type AssetClass = 'cash' | 'securities' | 'crypto' | 'real_estate' | 'pension' | 'business' | 'other';

export interface Household {
  name: string;
  birthYear: number;
  adults: number;
  children: number;
  owner: boolean;
  retirementAge: number;
}

export interface Asset {
  key: string;
  label: string;
  class: AssetClass;
  /** Valeur en francs suisses (devise de référence), au cours de la table. */
  value: number;
  /** Devise d'origine. */
  currency: string;
  /** Montant dans la devise d'origine (ou quantité x prix pour un actif coté). */
  valueNative: number;
  /** Cours utilisé: CHF pour une unité de la devise ou du symbole. */
  fx: number;
  /** Le cours manquait: la valeur est un repli à 1:1, donc non fiable. */
  rateMissing?: boolean;
  /** Actif coté (crypto): symbole et quantité détenue. */
  symbol?: string;
  quantity?: number;
  /** Type de compte de prévoyance: lpp, 3a, 401k, ira, roth. */
  account?: string;
  /** Explication de l'hypothèse d'accès, affichée à l'utilisateur. */
  accessNote?: string;
  /** Croissance réelle annuelle propre à cet actif (surcharge les hypothèses). */
  realGrowth?: number;
  /** Classe dont cet actif suit la croissance dans les hypothèses. */
  growthLike?: AssetClass;
  /** Type du catalogue (résidence, bien locatif, 401k...). */
  subtype?: string;
  /** Part détenue, 0 à 1. La valeur ci-dessus en tient déjà compte. */
  share?: number;
  region: string;
  /** Protège du pouvoir d'achat (actif réel). */
  real: boolean;
  /** Nombre de mois avant que l'actif soit mobilisable. */
  liquidityMonths: number;
  /** Perte à la mobilisation (frais, décote), 0 à 1. */
  haircut: number;
  /** Cotisations mensuelles versées jusqu'à la retraite (2e pilier), en francs. */
  contribution?: number;
  certainty: Certainty;
}

export interface Liability {
  key: string;
  label: string;
  /** Solde en francs suisses. */
  balance: number;
  currency: string;
  balanceNative: number;
  fx: number;
  rateMissing?: boolean;
  rate: number;
  variable: boolean;
  /** Part supportée, 0 à 1. Le solde ci-dessus en tient déjà compte. */
  share?: number;
  /** Clé de l'actif garanti (hypothèque -> bien). */
  securedBy?: string;
  /** Amortissement annuel en francs. Absent: la dette reste stable (cas courant en Suisse). */
  amortization?: number;
  certainty: Certainty;
}

export interface Income extends Windowed {
  key: string;
  label: string;
  monthly: number;
  /** Continue si le salaire s'arrête (loyers, rentes). */
  stable: boolean;
  certainty: Certainty;
}

/** Ce que devient une dépense à la retraite. */
export type RetirementMode = 'gone' | 'lower' | 'same' | 'higher';

export interface Expense extends Windowed {
  key: string;
  label: string;
  category: string;
  monthly: number;
  essential: boolean;
  /** Choix de l'utilisateur pour la retraite. Absent: valeur déduite de la catégorie. */
  retirement?: RetirementMode;
  /** Dépense ponctuelle: montant dû au mois indiqué (depuis maintenant), puis plus rien. */
  lump?: { month: number; amount: number };
  certainty: Certainty;
}

export interface Goal {
  key: string;
  label: string;
  targetAmount: number;
  targetYear: number;
  saved: number;
  certainty: Certainty;
}

export interface Snapshot {
  asOf: string;
  /** Devise de référence de tous les montants. */
  base: 'CHF';
  /** Table de cours utilisée pour la conversion. */
  rates: RateTable;
  household: Household;
  assets: Asset[];
  liabilities: Liability[];
  incomes: Income[];
  expenses: Expense[];
  goals: Goal[];
}

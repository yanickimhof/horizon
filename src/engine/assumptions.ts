import type { Asset, AssetClass } from './types';

/**
 * Hypothèses explicites du calcul. Rien n'est caché dans le code: tout ce qui
 * change selon l'avenir envisagé vit ici. Une simulation est une variante de ces
 * hypothèses (et/ou de l'instantané), jamais une modification du moteur.
 *
 * Le moteur raisonne en francs d'AUJOURD'HUI (pouvoir d'achat constant): les
 * croissances ci-dessous sont des croissances RÉELLES, après inflation.
 */
/** Période difficile bornée par des âges: pendant ces années, ces valeurs remplacent celles du cas. */
export interface Phase {
  fromAge: number;
  toAge: number;
  realGrowth: Record<AssetClass, number>;
  fxDrift: number;
  expenseGrowth: number;
  /** Années depuis aujourd'hui, renseignées par resolvePhase. */
  fromYear?: number;
  toYear?: number;
}

export interface Assumptions {
  /** Période difficile optionnelle. Hors de cette période, les valeurs du cas s'appliquent. */
  phase?: Phase;
  /** Croissance réelle annuelle par classe d'actifs, par exemple 0.02 pour 2 %. */
  realGrowth: Record<AssetClass, number>;
  /** Dérive annuelle réelle des devises étrangères face au franc (négative = le franc s'apprécie). */
  fxDrift: number;
  /** Croissance réelle annuelle des dépenses (dérive du niveau de vie). */
  expenseGrowth: number;
}

/** Convertit les âges de la période difficile en années depuis aujourd'hui. */
export function resolvePhase(as: Assumptions, nowAge: number): Assumptions {
  if (!as.phase) return as;
  return { ...as, phase: { ...as.phase, fromYear: Math.max(0, as.phase.fromAge - nowAge), toYear: Math.max(0, as.phase.toAge - nowAge) } };
}

/** Années passées dans la période difficile pendant les `years` premières années. */
function overlapYears(years: number, ph?: Phase): number {
  if (!ph || ph.fromYear === undefined || ph.toYear === undefined) return 0;
  return Math.max(0, Math.min(years, ph.toYear) - ph.fromYear);
}

/** Facteur de croissance cumulé sur `months` mois: taux `g` hors période difficile, `gPhase` pendant. */
export function compound(g: number, gPhase: number, months: number, ph?: Phase): number {
  const years = months / 12;
  const o = overlapYears(years, ph);
  return Math.pow(Math.max(0, 1 + g), years - o) * Math.pow(Math.max(0, 1 + gPhase), o);
}

export type CaseId = 'worst' | 'base' | 'best';

/**
 * Trois jeux d'hypothèses pour encadrer l'incertitude: tendances et surprises existent.
 *
 * ATTENTION: valeurs INDICATIVES, NON sourcées, choisies pour être plausibles sur
 * un horizon long. Elles sont à discuter et à rendre modifiables par l'utilisateur.
 * Une fourchette honnête vaut mieux qu'un chiffre unique: l'écart entre pire cas et
 * meilleur cas est lui-même une information.
 */
export const CASES: Record<CaseId, { label: string; summary: string; assumptions: Assumptions }> = {
  worst: {
    label: 'Pire cas',
    summary: 'Une décennie difficile autour de la retraite (de 60 à 70 ans): marchés et immobilier en recul, franc fort, dépenses qui dérivent. Avant et après, les hypothèses du cas de base.',
    assumptions: {
      realGrowth: { cash: 0, securities: 0.025, crypto: 0, real_estate: 0.005, pension: 0.005, business: 0.025, other: 0 },
      fxDrift: 0,
      expenseGrowth: 0.005,
      phase: {
        fromAge: 60,
        toAge: 70,
        realGrowth: { cash: -0.01, securities: -0.03, crypto: -0.15, real_estate: -0.025, pension: 0, business: -0.03, other: -0.01 },
        fxDrift: -0.015,
        expenseGrowth: 0.01,
      },
    },
  },
  base: {
    label: 'Cas de base',
    summary: 'Évolution modérée, proche de l’historique long.',
    assumptions: {
      realGrowth: { cash: 0, securities: 0.025, crypto: 0, real_estate: 0.005, pension: 0.005, business: 0.025, other: 0 },
      fxDrift: 0,
      // Les primes d'assurance maladie et les soins montent plus vite que les prix: environ 0,5 % de plus par an sur l'ensemble des dépenses.
      expenseGrowth: 0.005,
    },
  },
  best: {
    label: 'Meilleur cas',
    summary: 'Marchés porteurs, immobilier en hausse, franc stable.',
    assumptions: {
      realGrowth: { cash: 0.005, securities: 0.05, crypto: 0.1, real_estate: 0.02, pension: 0.01, business: 0.05, other: 0.005 },
      fxDrift: 0.005,
      expenseGrowth: 0,
    },
  },
};

export const DEFAULT_ASSUMPTIONS: Assumptions = CASES.base.assumptions;

/** Valeur d'un actif dans `months` mois, en francs d'aujourd'hui. */
export function valueAt(a: Asset, months: number, as: Assumptions = DEFAULT_ASSUMPTIONS): number {
  if (months <= 0) return a.value;
  const years = months / 12;
  const g = a.realGrowth ?? as.realGrowth[a.growthLike ?? a.class] ?? 0;
  const cls = a.growthLike ?? a.class;
  const gPhase = a.realGrowth ?? as.phase?.realGrowth[cls] ?? g;
  let v = a.value * compound(g, gPhase, months, as.phase);
  // Les cryptos sont déjà cotées en CHF et portent leur propre hypothèse: pas de double compte.
  if (a.currency !== 'CHF' && a.class !== 'crypto') v *= compound(as.fxDrift, as.phase?.fxDrift ?? as.fxDrift, months, as.phase);
  return v;
}

/**
 * Dépenses cumulées sur `months` mois, en francs d'aujourd'hui, si elles dérivent de
 * `growth` par an. Sans dérive: burn x mois.
 */
export function cumulativeDemand(burn: number, months: number, growth: number): number {
  if (burn <= 0 || months <= 0) return 0;
  if (Math.abs(growth) < 1e-9) return burn * months;
  const g = Math.log(1 + growth);
  return burn * 12 * ((Math.exp((g * months) / 12) - 1) / g);
}

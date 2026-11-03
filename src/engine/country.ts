/**
 * Règles propres à un pays. Horizon est écrit pour la Suisse (canton de Vaud pour les impôts); pour un autre pays
 * ou canton, c'est ici (et dans src/engine/accounts.ts pour les comptes de prévoyance) qu'on adapte les hypothèses.
 * Les montants sont ceux de 2025 et 2026, à mettre à jour chaque année. Sources: SECO, OFAS, administration cantonale des impôts.
 */
export interface CountryConfig {
  code: string;
  currency: string;
  /** Assurance chômage. */
  unemployment: {
    /** Gain assuré maximal par mois. */
    gainMaxMonthly: number;
    /** Part du gain assuré versée (0,8 avec un enfant de moins de 25 ans à charge, 0,7 sinon). */
    rate: number;
    /** Part conservée après cotisations sociales. */
    netFactor: number;
    /** Durée maximale d'indemnisation, en mois. */
    months: number;
  };
  retirement: {
    defaultAge: number;
    /** Âge jusqu'auquel on teste que l'argent tient. */
    endAge: number;
    /** Impôt simplifié sur les revenus de retraite, utilisé seulement si le modèle détaillé est désactivé. */
    taxRate: number;
  };
  /** Taux de long terme des hypothèques. */
  rates: {
    /** Taux au moins appliqué aux dettes variables (SARON). La BNS est à 0 % et le SARON prévu autour de 0,3 % fin 2027 (UBS), mais sur 30 ans il remonte. Repère: SARON de 0,7 % + marge de 0,8 %, soit le taux d'un fixe à 5 ans (environ 1,5 % en 2026). Un fixe à 10 ans est à 1,7 à 2,1 %. */
    normalVariableRate: number;
  };
  /** Repères AVS 2026, pour contrôler une estimation de rente. */
  avs: { maxPensionMonthly: number; coupleCapMonthly: number };
  tax: {
    /** Impôt sur la fortune: barème de base vaudois 2025 au coefficient 100 %, points (fortune imposable, impôt de base par an). */
    wealthScale: [number, number][];
    /** Taux marginal de l'impôt de base au-delà du dernier point du barème. */
    wealthTopMarginal: number;
    /** Coefficients cantonal et communal cumulés, appliqués à l'impôt de base (155 % + 72,5 % pour une commune en 2025). */
    wealthCoefficient: number;
    /** Déduction sur la fortune pour un couple. Valeur estimée, à confirmer sur la taxation. */
    wealthAllowance: number;
    /** Valeur fiscale d'un bien en part de sa valeur de marché. Calibré sur la taxation 2025, ou les valeurs fiscales anciennes sont basses. */
    realEstateFiscalRatio: number;
    /** Taux moyen d'impôt sur le revenu (canton, commune et Confédération) selon le revenu imposable, points (revenu, taux). */
    incomeRates: [number, number][];
    /** Déductions forfaitaires sur le revenu de retraite (primes d'assurance maladie, frais divers). */
    retirementDeduction: number;
    /** Part des loyers perdue en vacance locative. */
    vacancyRate: number;
    /** Loyer annuel de remplacement après la vente de la résidence, en part de sa valeur. */
    replacementRentRate: number;
  };
}

export const COUNTRY: CountryConfig = {
  code: 'CH',
  currency: 'CHF',
  unemployment: { gainMaxMonthly: 12_350, rate: 0.8, netFactor: 0.94, months: 18 },
  retirement: { defaultAge: 65, endAge: 95, taxRate: 0.12 },
  rates: { normalVariableRate: 0.015 },
  avs: { maxPensionMonthly: 2_520, coupleCapMonthly: 3_780 },
  tax: {
    wealthScale: [
      [0, 0], [50_000, 22.95], [100_000, 75.05], [150_000, 159.55], [200_000, 260.85], [250_000, 381.85], [300_000, 502.85],
      [350_000, 623.85], [400_000, 777.7], [450_000, 935.2], [500_000, 1_092.7], [600_000, 1_407.7], [800_000, 2_059.3],
      [1_000_000, 2_737.3], [1_500_000, 4_432.3], [2_000_000, 6_127.3],
    ],
    wealthTopMarginal: 0.00339,
    wealthCoefficient: 1.55 + 0.725,
    wealthAllowance: 112_000,
    realEstateFiscalRatio: 0.53,
    // Calibré sur les taxations: 2025, revenu imposable 164 900 pour 35 460 d'impôt (21,5 %); 2022, 87 600 pour 16 600 (19 %).
    incomeRates: [[0, 0], [30_000, 0.07], [60_000, 0.13], [90_000, 0.175], [130_000, 0.2], [165_000, 0.215], [250_000, 0.245], [500_000, 0.3]],
    retirementDeduction: 15_000,
    vacancyRate: 0,
    replacementRentRate: 0.03,
  },
};

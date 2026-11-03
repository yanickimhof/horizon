/**
 * Règles d'accès et de fiscalité par type de compte de prévoyance, en hypothèses de départ.
 *
 * ATTENTION: ordres de grandeur indicatifs, NON sourcés, à faire valider par un
 * professionnel. Ils servent à ne pas traiter un compte bloqué comme du cash.
 * Chaque valeur peut être surchargée ligne par ligne (liquidityMonths, haircut).
 */
export interface AccessProfile {
  /** Mois avant que le capital soit accessible sans pénalité. */
  liquidityMonths: number;
  /** Part perdue en impôts et frais à la sortie, 0 à 1. */
  haircut: number;
  /** Texte expliquant l'hypothèse, affiché à l'utilisateur. */
  why: string;
  /** Plutôt investi en actifs réels (actions) qu'en nominal. */
  real: boolean;
  /** Classe dont le compte suit la croissance dans les hypothèses (un 401(k) suit les titres). */
  growthLike?: 'securities';
}

export const ACCOUNT_TYPES = [
  { id: 'lpp', label: 'LPP (2e pilier suisse)' },
  { id: '3a', label: '3e pilier a (Suisse)' },
  { id: '401k', label: '401(k) États-Unis' },
  { id: 'ira', label: 'IRA traditionnel (États-Unis)' },
  { id: 'roth', label: 'Roth 401(k) ou IRA (États-Unis)' },
] as const;

const US_ACCESS_AGE = 59.5;

export function accessProfile(account: string | undefined, ctx: { age: number; retirementAge: number }): AccessProfile {
  const monthsTo = (age: number) => Math.max(0, Math.round((age - ctx.age) * 12));
  switch ((account ?? 'lpp').toLowerCase()) {
    case '401k':
    case 'ira':
    case 'traditional-ira':
      return {
        liquidityMonths: monthsTo(US_ACCESS_AGE),
        haircut: 0.25,
        real: true,
        growthLike: 'securities',
        why: 'Accessible sans pénalité dès 59 ans et demi, imposé comme un revenu à la sortie (estimation 25 %).',
      };
    case 'roth':
    case 'roth-401k':
    case 'roth-ira':
      return {
        liquidityMonths: monthsTo(US_ACCESS_AGE),
        haircut: 0.05,
        real: true,
        growthLike: 'securities',
        why: 'Accessible dès 59 ans et demi, retraits en principe non imposés (estimation 5 % de frais).',
      };
    case '3a':
      return {
        liquidityMonths: monthsTo(ctx.retirementAge - 5),
        haircut: 0.08,
        real: false,
        why: 'Retrait possible jusqu’à 5 ans avant la retraite, impôt séparé sur le capital (estimation 8 %).',
      };
    default:
      return {
        liquidityMonths: monthsTo(ctx.retirementAge),
        haircut: 0.1,
        real: false,
        why: 'Capital accessible à la retraite, impôt sur le retrait en capital (estimation 10 %, varie selon le canton).',
      };
  }
}

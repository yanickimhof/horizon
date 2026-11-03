export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'once';

const PER_YEAR: Record<Exclude<Frequency, 'once'>, number> = {
  weekly: 52,
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
};

/** Montant ramené au mois. Un paiement unique n'est pas récurrent : 0. */
export function toMonthly(amount: number, frequency: Frequency): number {
  if (frequency === 'once') return 0;
  return (amount * PER_YEAR[frequency]) / 12;
}

export function isFrequency(x: unknown): x is Frequency {
  return x === 'once' || (typeof x === 'string' && x in PER_YEAR);
}

/**
 * Table de cours. Tout est converti en francs suisses (devise de référence).
 * `perUnit` = nombre de CHF pour UNE unité de la devise ou du symbole (1 USD, 1 BTC).
 * Chaque cours garde sa date et sa source pour qu'on sache ce qui est frais, saisi à la main ou périmé.
 */
export interface Rate {
  perUnit: number;
  /** Date du cours (ISO). */
  at: string;
  /** manual, exemple, ecb, coingecko... */
  source: string;
}

export interface RateTable {
  base: 'CHF';
  rates: Record<string, Rate>;
}

export const emptyRates = (): RateTable => ({ base: 'CHF', rates: {} });

export const STALE_DAYS = 30;

export function rateFor(t: RateTable | undefined, symbol: string): Rate | undefined {
  const s = symbol.toUpperCase();
  if (s === 'CHF') return { perUnit: 1, at: '', source: 'base' };
  return t?.rates[s];
}

/** Convertit un montant. Si le cours manque, replie à 1:1 et le signale: jamais de résultat silencieux. */
export function toBase(amount: number, symbol: string, t: RateTable | undefined): { value: number; fx: number; missing: boolean } {
  const r = rateFor(t, symbol);
  if (!r) return { value: amount, fx: 1, missing: true };
  return { value: amount * r.perUnit, fx: r.perUnit, missing: false };
}

/** Symboles dont le cours date de plus de `days` jours. */
export function staleRates(t: RateTable | undefined, now: Date = new Date(), days = STALE_DAYS): string[] {
  if (!t) return [];
  const limit = now.getTime() - days * 86_400_000;
  return Object.entries(t.rates)
    .filter(([, r]) => r.at && new Date(r.at).getTime() < limit)
    .map(([k]) => k);
}

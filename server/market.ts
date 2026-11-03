import type { Ledger } from './ledger';
import { EgressBlocked, guardedFetch } from './egress';

/**
 * Cours publics. CONFIDENTIALITÉ: on demande TOUJOURS la liste complète (toutes les
 * devises de la BCE, les 100 premières cryptos), jamais seulement ce que détient
 * l'utilisateur: la requête ne révèle donc rien de son patrimoine. Elle passe par le
 * point de sortie unique, soumise au mode et à l'accord "market".
 *
 * Les sources et les formats sont à vérifier avant usage: aucun appel réel n'a pu être
 * testé depuis l'environnement de développement, les analyseurs sont testés sur des exemples.
 */
export const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
export const CRYPTO_URL = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=chf&order=market_cap_desc&per_page=100&page=1';

/** 1 EUR = x devise, et la date publiée. */
export function parseEcb(xml: string): { at: string; perEur: Record<string, number> } {
  const at = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  if (!at) throw new Error('Format BCE inattendu: date introuvable');
  const perEur: Record<string, number> = {};
  for (const m of xml.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) perEur[m[1]] = Number(m[2]);
  if (!perEur.CHF) throw new Error('Format BCE inattendu: cours du franc absent');
  return { at: `${at}T00:00:00.000Z`, perEur };
}

/** CHF pour une unité de chaque devise. */
export function ecbToChf(perEur: Record<string, number>): Record<string, number> {
  const chfPerEur = perEur.CHF;
  const out: Record<string, number> = { EUR: chfPerEur };
  for (const [ccy, r] of Object.entries(perEur)) if (ccy !== 'CHF' && r > 0) out[ccy] = chfPerEur / r;
  return out;
}

/** Prix en CHF par symbole. En cas de doublon de symbole, la plus grosse capitalisation (la première) l'emporte. */
export function parseCrypto(rows: unknown): Record<string, number> {
  if (!Array.isArray(rows)) throw new Error('Format inattendu pour les cryptos');
  const out: Record<string, number> = {};
  for (const r of rows as { symbol?: string; current_price?: number }[]) {
    const sym = r.symbol?.toUpperCase();
    if (sym && typeof r.current_price === 'number' && r.current_price > 0 && !(sym in out)) out[sym] = r.current_price;
  }
  return out;
}

export interface MarketResult {
  updated: string[];
  failed: { source: string; reason: string }[];
}

export async function updateMarket(l: Ledger, doFetch: typeof fetch = fetch): Promise<MarketResult> {
  const result: MarketResult = { updated: [], failed: [] };

  const run = async (source: string, url: string, handle: (r: Response) => Promise<void>) => {
    try {
      const r = await guardedFetch(l, { purpose: 'market', url, init: { method: 'GET', headers: { accept: '*/*' } }, summary: `Cours publics (${source}), liste complète` }, doFetch);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await handle(r);
    } catch (e) {
      if (e instanceof EgressBlocked) throw e; // le blocage est une décision de politique, pas une panne
      result.failed.push({ source, reason: e instanceof Error ? e.message : String(e) });
    }
  };

  await run('BCE', ECB_URL, async (r) => {
    const { at, perEur } = parseEcb(await r.text());
    for (const [ccy, v] of Object.entries(ecbToChf(perEur))) {
      l.setPrice(ccy, v, 'ecb', at);
      result.updated.push(ccy);
    }
  });
  await run('CoinGecko', CRYPTO_URL, async (r) => {
    const now = new Date().toISOString();
    for (const [sym, v] of Object.entries(parseCrypto(await r.json()))) {
      l.setPrice(sym, v, 'coingecko', now);
      result.updated.push(sym);
    }
  });
  return result;
}

import { describe, expect, it, vi } from 'vitest';
import { Ledger } from './ledger';
import { CRYPTO_URL, ECB_URL, ecbToChf, parseCrypto, parseEcb, updateMarket } from './market';
import { EgressBlocked } from './egress';

const ECB_XML = `<?xml version="1.0"?><gesmes:Envelope><Cube><Cube time='2026-10-30'>
<Cube currency='USD' rate='1.0800'/><Cube currency='CHF' rate='0.9300'/><Cube currency='GBP' rate='0.8500'/></Cube></Cube></gesmes:Envelope>`;
const CRYPTO_JSON = [
  { symbol: 'btc', current_price: 62000 },
  { symbol: 'eth', current_price: 2300 },
  { symbol: 'btc', current_price: 1 }, // doublon: le premier (plus grosse capitalisation) l'emporte
  { symbol: 'bad', current_price: 0 },
];

const assisted = (market = true) => {
  const l = new Ledger();
  l.setSetting('privacy.mode', 'assisted');
  if (market) l.setSetting('consent.market', new Date().toISOString());
  return l;
};
const mockFetch = (ok = { ecb: true, crypto: true }) =>
  vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u === ECB_URL) return ok.ecb ? new Response(ECB_XML, { status: 200 }) : new Response('', { status: 500 });
    if (u === CRYPTO_URL) return ok.crypto ? new Response(JSON.stringify(CRYPTO_JSON), { status: 200 }) : new Response('', { status: 429 });
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;

describe('analyse des cours', () => {
  it('lit la BCE et convertit en CHF pour une unité', () => {
    const { at, perEur } = parseEcb(ECB_XML);
    expect(at).toBe('2026-10-30T00:00:00.000Z');
    const chf = ecbToChf(perEur);
    expect(chf.EUR).toBeCloseTo(0.93, 6);
    expect(chf.USD).toBeCloseTo(0.93 / 1.08, 6);
    expect(chf.GBP).toBeCloseTo(0.93 / 0.85, 6);
    expect(chf.CHF).toBeUndefined();
  });

  it('refuse un format BCE inattendu plutôt que d inventer des cours', () => {
    expect(() => parseEcb('<html>erreur</html>')).toThrow(/inattendu/);
  });

  it('lit les cryptos: symboles en majuscules, doublon et prix nul ignorés', () => {
    expect(parseCrypto(CRYPTO_JSON)).toEqual({ BTC: 62000, ETH: 2300 });
    expect(() => parseCrypto({ error: 'rate limit' })).toThrow();
  });
});

describe('mise à jour des cours', () => {
  it('fonctionne en mode strict local avec son propre accord, mais pas si l environnement verrouille', async () => {
    const l = new Ledger();
    l.setSetting('consent.market', new Date().toISOString());
    const r = await updateMarket(l, mockFetch());
    expect(r.updated).toContain('BTC');
    process.env.HORIZON_PRIVACY = 'local';
    try {
      await expect(updateMarket(l, mockFetch())).rejects.toBeInstanceOf(EgressBlocked);
    } finally {
      delete process.env.HORIZON_PRIVACY;
    }
  });

  it('bloquée par défaut, et le blocage est journalisé', async () => {
    const l = new Ledger();
    const f = mockFetch();
    await expect(updateMarket(l, f)).rejects.toBeInstanceOf(EgressBlocked);
    expect(f).not.toHaveBeenCalled();
    expect(l.egressLog()[0]).toMatchObject({ allowed: false, purpose: 'market' });
  });

  it('l accord du coach ne suffit pas: il faut l accord "market"', async () => {
    const l = new Ledger();
    l.setSetting('privacy.mode', 'assisted');
    l.setSetting('consent.coach', new Date().toISOString());
    await expect(updateMarket(l, mockFetch())).rejects.toThrow(/Accord manquant/);
  });

  it('enregistre devises et cryptos avec leur source et leur date', async () => {
    const l = assisted();
    const r = await updateMarket(l, mockFetch());
    expect(r.failed).toEqual([]);
    const rates = l.rates().rates;
    expect(rates.USD.perUnit).toBeCloseTo(0.93 / 1.08, 6);
    expect(rates.USD.source).toBe('ecb');
    expect(rates.USD.at).toBe('2026-10-30T00:00:00.000Z');
    expect(rates.BTC).toMatchObject({ perUnit: 62000, source: 'coingecko' });
  });

  it('CONFIDENTIALITÉ: demande toujours la liste complète, jamais les avoirs de l utilisateur', async () => {
    const l = assisted();
    l.confirmNew({ kind: 'asset', key: 'asset:secret', data: { label: 'Jeton secret', class: 'crypto', symbol: 'SECRETCOIN', quantity: 1 }, status: 'confirmed', origin: 'user', confidence: 1, sourceId: null, excerpt: null, why: null });
    const f = mockFetch();
    await updateMarket(l, f);
    const urls = (f as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(urls.sort()).toEqual([CRYPTO_URL, ECB_URL].sort());
    expect(urls.join(' ')).not.toMatch(/SECRET/i);
    expect(JSON.stringify(l.egressLog())).not.toMatch(/SECRET/i);
  });

  it('une requête GET part sans corps et est journalisée', async () => {
    const l = assisted();
    const f = mockFetch();
    await updateMarket(l, f);
    for (const c of (f as any).mock.calls) expect(c[1].body).toBeUndefined();
    const log = l.egressLog();
    expect(log).toHaveLength(2);
    expect(log.every((e) => e.allowed && e.purpose === 'market')).toBe(true);
  });

  it('une source en panne n empêche pas l autre, et la panne est rapportée', async () => {
    const l = assisted();
    const r = await updateMarket(l, mockFetch({ ecb: true, crypto: false }));
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]).toMatchObject({ source: 'CoinGecko', reason: 'HTTP 429' });
    expect(l.rates().rates.USD).toBeDefined();
    expect(l.rates().rates.BTC).toBeUndefined();
  });

  it('un cours saisi à la main plus récent que la source publique est conservé', async () => {
    const l = assisted();
    l.setPrice('USD', 0.5, 'manual', '2026-11-01T10:00:00.000Z');
    await updateMarket(l, mockFetch());
    expect(l.rates().rates.USD).toMatchObject({ perUnit: 0.5, source: 'manual' });
  });
});

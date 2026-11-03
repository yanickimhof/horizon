import { describe, expect, it } from 'vitest';
import { Ledger } from './ledger';
import { CapReached, capChf, claude, costUsd, usageSummary } from './usage';

const okFetch = (input = 1000, output = 100): typeof fetch =>
  (async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: input, output_tokens: output } }), { status: 200 })) as typeof fetch;

function setup(): Ledger {
  const l = new Ledger(':memory:');
  l.setSetting('privacy.mode', 'assisted');
  l.setSetting('consent.analysis', new Date().toISOString());
  l.setSetting('consent.coach', new Date().toISOString());
  return l;
}

describe('coût et plafond des appels à Claude', () => {
  it('calcule le coût selon le tarif officiel', () => {
    expect(costUsd('claude-sonnet-5-5', 1_000_000, 1_000_000)).toBeCloseTo(12, 5);
    expect(costUsd('claude-haiku-5-5', 100_000, 0)).toBeCloseTo(0.01, 5); // jusqu'à 100 000 jetons: 0,10 $ le million
    expect(costUsd('claude-haiku-5-5', 200_000, 0)).toBeCloseTo(0.1, 5); // au-delà: 0,50 $ le million
  });

  it('consigne les jetons et le coût de chaque appel', async () => {
    process.env.ANTHROPIC_API_KEY = 'valeur-de-test';
    const l = setup();
    const r = await claude(l, { purpose: 'analysis', model: 'claude-haiku-5-5', messages: [{ role: 'user', content: 'x' }], maxTokens: 10, summary: 'test' }, okFetch(2000, 200));
    expect(r.text).toBe('ok');
    const u = usageSummary(l);
    expect(u.calls).toBe(1);
    expect(u.inputTokens).toBe(2000);
    expect(u.monthChf).toBeGreaterThan(0);
  });

  it('refuse au-delà du plafond mensuel', async () => {
    process.env.ANTHROPIC_API_KEY = 'valeur-de-test';
    const l = setup();
    l.setSetting('llm.capChf', '0.0001');
    l.setSetting('privacy.mode', 'assisted');
    await claude(l, { purpose: 'analysis', model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: 'x' }], maxTokens: 10, summary: 'test' }, okFetch(100_000, 10_000));
    expect(capChf(l)).toBeCloseTo(0.0001);
    await expect(claude(l, { purpose: 'analysis', model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: 'x' }], maxTokens: 10, summary: 'test' }, okFetch())).rejects.toBeInstanceOf(CapReached);
  });

  it('ne part pas sans accord', async () => {
    process.env.ANTHROPIC_API_KEY = 'valeur-de-test';
    const l = new Ledger(':memory:');
    l.setSetting('privacy.mode', 'assisted');
    await expect(claude(l, { purpose: 'analysis', model: 'claude-haiku-5-5', messages: [{ role: 'user', content: 'x' }], maxTokens: 10, summary: 'test' }, okFetch())).rejects.toThrow(/Accord manquant/);
  });
});

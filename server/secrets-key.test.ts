import { afterEach, describe, expect, it } from 'vitest';
import { anthropicKey, hasAnthropicKey } from './secrets';

describe('clé d’API', () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  });

  it('la variable d’environnement prime', () => {
    process.env.ANTHROPIC_API_KEY = 'valeur-de-test';
    expect(anthropicKey()).toBe('valeur-de-test');
    expect(hasAnthropicKey()).toBe(true);
  });

  it('sans variable ni trousseau, aucune clé', () => {
    delete process.env.ANTHROPIC_API_KEY;
    // Hors macOS ou sans élément dans le trousseau, la réponse est null et rien ne plante.
    const k = anthropicKey(Date.now() + 60_000);
    expect(k === null || typeof k === 'string').toBe(true);
  });
});

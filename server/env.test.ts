import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDotEnv } from './env';

describe('fichier .env', () => {
  afterEach(() => {
    delete process.env.HORIZON_TEST_NOUVELLE;
    delete process.env.HORIZON_TEST_EXISTANTE;
  });

  it('charge les variables absentes et garde celles déjà définies', () => {
    const dir = mkdtempSync(join(tmpdir(), 'horizon-env-'));
    const f = join(dir, '.env');
    writeFileSync(f, 'HORIZON_TEST_NOUVELLE=oui\nHORIZON_TEST_EXISTANTE=fichier\n');
    process.env.HORIZON_TEST_EXISTANTE = 'environnement';
    expect(loadDotEnv(f)).toBe(true);
    expect(process.env.HORIZON_TEST_NOUVELLE).toBe('oui');
    expect(process.env.HORIZON_TEST_EXISTANTE).toBe('environnement');
    rmSync(dir, { recursive: true });
  });

  it('ignore un fichier absent', () => {
    expect(loadDotEnv(join(tmpdir(), 'inexistant-horizon', '.env'))).toBe(false);
  });
});

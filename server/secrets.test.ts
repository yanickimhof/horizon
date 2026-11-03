import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Garde-fous avant tout envoi vers un dépôt distant: aucun secret dans le code, et les
 * dossiers de données personnelles sont exclus de git. Ce test échoue avant que ça ne parte.
 */
const ROOT = join(new URL('.', import.meta.url).pathname, '..');
const SKIP = new Set(['node_modules', 'dist', 'data', 'inbox', '.git']);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|json|md|css|html|cjs|mjs|yml|yaml|env)$/.test(e) || e === '.gitignore') out.push(p);
  }
  return out;
}

// Les motifs sont assemblés en morceaux pour que ce fichier ne se déclenche pas lui-même.
const PATTERNS: [string, RegExp][] = [
  ['clé Anthropic', new RegExp('sk-' + 'ant-[A-Za-z0-9_-]{20,}')],
  ['clé AWS', new RegExp('AK' + 'IA[0-9A-Z]{16}')],
  ['jeton GitHub', new RegExp('gh' + 'p_[A-Za-z0-9]{30,}')],
  ['clé privée', new RegExp('-----BEGIN (RSA |EC |OPENSSH )?PRIVATE ' + 'KEY-----')],
  ['clé d\'API en dur', new RegExp('api[_-]?key[\'"]?\\s*[:=]\\s*[\'"][A-Za-z0-9_-]{24,}[\'"]', 'i')],
];

describe('secrets et données personnelles', () => {
  it('aucun secret dans les fichiers du dépôt', () => {
    const hits: string[] = [];
    for (const f of walk(ROOT)) {
      if (f.endsWith('secrets.test.ts')) continue;
      const src = readFileSync(f, 'utf8');
      for (const [name, re] of PATTERNS) if (re.test(src)) hits.push(`${relative(ROOT, f)}: ${name}`);
    }
    expect(hits).toEqual([]);
  });

  it('aucun fichier .env dans le dépôt', () => {
    expect(existsSync(join(ROOT, '.env'))).toBe(false);
    expect(walk(ROOT).filter((f) => /(^|\/)\.env(\.|$)/.test(f))).toEqual([]);
  });

  it('le .gitignore protège les données, les documents extraits et les secrets', () => {
    const ig = readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
    for (const must of ['data/', 'inbox/', '.env', '*.db', 'node_modules']) expect(ig).toContain(must);
  });

  it('la clé d API est lue depuis l environnement ou le trousseau macOS, jamais stockée', () => {
    const api = readFileSync(join(ROOT, 'server', 'api.ts'), 'utf8');
    const secrets = readFileSync(join(ROOT, 'server', 'secrets.ts'), 'utf8');
    expect(secrets).toMatch(/process\.env\.ANTHROPIC_API_KEY/);
    expect(secrets).toMatch(/find-generic-password/);
    const usage = readFileSync(join(ROOT, 'server', 'usage.ts'), 'utf8');
    expect(usage).toMatch(/anthropicKey\(\)/);
    expect(api).toMatch(/claude\(l,/);
    expect(api).not.toMatch(/process\.env\.ANTHROPIC_API_KEY/);
    expect(api).not.toMatch(/setSetting\([^)]*API_KEY/i);
    const ledger = readFileSync(join(ROOT, 'server', 'ledger.ts'), 'utf8');
    expect(ledger).not.toMatch(/api[_-]?key/i);
    // Le trousseau est lu, jamais écrit par le serveur: l'écriture se fait par scripts/set-key.sh.
    expect(secrets).not.toMatch(/add-generic-password/);
  });
});

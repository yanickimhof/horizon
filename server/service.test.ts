import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(new URL('.', import.meta.url).pathname, '..');
const script = readFileSync(join(ROOT, 'scripts', 'service.sh'), 'utf8');
const code = script.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

describe('service en arrière-plan', () => {
  const plist = execFileSync('bash', [join(ROOT, 'scripts', 'service.sh'), 'plist', 'a&b@exemple.ch'], { encoding: 'utf8' });

  it('génère un fichier launchd cohérent qui redémarre le service', () => {
    expect(plist).toContain('<key>Label</key><string>ch.horizon.app</string>');
    expect(plist).toMatch(/<key>KeepAlive<\/key><true\/>/);
    expect(plist).toMatch(/<key>RunAtLoad<\/key><true\/>/);
    expect(plist).toContain('node_modules/vite/bin/vite.js');
  });

  it('n écoute que sur cet ordinateur', () => {
    expect(plist).toContain('<string>127.0.0.1</string>');
    expect(plist).not.toContain('0.0.0.0');
  });

  it('échappe le compte autorisé pour que le fichier reste valide', () => {
    expect(plist).toContain('a&amp;b@exemple.ch');
    expect(plist).not.toContain('a&b@');
  });

  it('transmet le compte autorisé au serveur (fermé par défaut sans lui)', () => {
    expect(plist).toMatch(/<key>HORIZON_ALLOWED_LOGIN<\/key><string>a&amp;b@exemple\.ch<\/string>/);
  });

  it('ne publie jamais sur Internet et ne touche pas aux autres services Tailscale', () => {
    expect(code).not.toMatch(/tailscale[^\n]*funnel|"\$ts" funnel|funnel --|\bfunnel\b/);
    expect(code).not.toMatch(/serve reset/);
    expect(code).not.toMatch(/--https=443\b/);
    expect(code).toMatch(/TS_PORT="\$\{HORIZON_TS_PORT:-8443\}"/);
    expect(code).toMatch(/serve --https="\$TS_PORT" off/);
  });

  it('refuse d installer sans compte autorisé plutôt que d ouvrir l accès', () => {
    expect(code).toMatch(/die "Compte Tailscale introuvable/);
  });

  it('exige une version de Node compatible avant d installer', () => {
    expect(code).toMatch(/Node 22\.5 ou plus est requis/);
  });
});

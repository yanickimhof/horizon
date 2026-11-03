import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allowedLogins, decide } from './access';

const req = (over: { addr?: string; headers?: Record<string, string>; method?: string } = {}) =>
  ({
    socket: { remoteAddress: over.addr ?? '127.0.0.1' },
    method: over.method ?? 'GET',
    headers: { host: 'localhost:5173', ...(over.headers ?? {}) },
  }) as Parameters<typeof decide>[0];

const ENV = { HORIZON_ALLOWED_LOGIN: 'Moi@Example.com' } as NodeJS.ProcessEnv;
const TS = { 'tailscale-user-login': 'moi@example.com', host: 'mac.tail1234.ts.net' };

describe('garde d accès', () => {
  it('accepte l ordinateur lui-même, sans identité', () => {
    expect(decide(req(), {})).toMatchObject({ ok: true, remote: false });
    expect(decide(req({ addr: '::1' }), {}).ok).toBe(true);
    expect(decide(req({ addr: '::ffff:127.0.0.1' }), {}).ok).toBe(true);
  });

  it('refuse toute connexion qui ne vient pas de cet ordinateur', () => {
    expect(decide(req({ addr: '192.168.1.20' }), ENV).status).toBe(403);
    expect(decide(req({ addr: '100.64.0.7' }), ENV).ok).toBe(false);
  });

  it('une identité Tailscale falsifiée par une connexion directe ne passe pas', () => {
    expect(decide(req({ addr: '192.168.1.20', headers: TS }), ENV).ok).toBe(false);
  });

  it('refuse un nom d hôte étranger (anti DNS rebinding)', () => {
    expect(decide(req({ headers: { host: 'evil.com' } }), {}).status).toBe(403);
    expect(decide(req({ headers: { host: 'evil.com:5173' } }), {}).ok).toBe(false);
    expect(decide(req({ headers: { host: 'localhost.evil.com' } }), {}).ok).toBe(false);
    expect(decide(req({ headers: { host: 'machine.ts.net.evil.com' } }), {}).ok).toBe(false);
    expect(decide(req({ headers: { host: '' } }), {}).ok).toBe(false);
    expect(decide(req({ headers: { host: '127.0.0.1:5173' } }), {}).ok).toBe(true);
    expect(decide(req({ headers: { host: 'mac.tail1234.ts.net:8443' } }), {}).ok).toBe(true);
  });

  it('autorise le compte Tailscale configuré, sans tenir compte de la casse', () => {
    expect(decide(req({ headers: TS }), ENV)).toMatchObject({ ok: true, remote: true, login: 'moi@example.com' });
  });

  it('refuse un autre compte du même réseau', () => {
    const d = decide(req({ headers: { ...TS, 'tailscale-user-login': 'autre@example.com' } }), ENV);
    expect(d).toMatchObject({ ok: false, status: 403, remote: true });
    expect(d.reason).toMatch(/autre@example.com/);
  });

  it('fermé par défaut: sans compte configuré, tout accès distant est refusé', () => {
    const d = decide(req({ headers: TS }), {});
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/HORIZON_ALLOWED_LOGIN/);
  });

  it('accepte plusieurs comptes séparés par des virgules', () => {
    const env = { HORIZON_ALLOWED_LOGIN: 'a@x.ch, b@x.ch' } as NodeJS.ProcessEnv;
    expect(allowedLogins(env)).toEqual(['a@x.ch', 'b@x.ch']);
    expect(decide(req({ headers: { ...TS, 'tailscale-user-login': 'b@x.ch' } }), env).ok).toBe(true);
  });

  it('exige du JSON pour écrire: un formulaire ou du texte brut venant d une page web est refusé', () => {
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', '']) {
      expect(decide(req({ method: 'POST', headers: { 'content-type': ct } }), {}).status).toBe(415);
    }
    expect(decide(req({ method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' } }), {}).ok).toBe(true);
  });

  it('refuse une écriture dont l origine n est pas celle de l hôte', () => {
    const json = { 'content-type': 'application/json' };
    expect(decide(req({ method: 'POST', headers: { ...json, origin: 'https://evil.com' } }), {}).status).toBe(403);
    expect(decide(req({ method: 'POST', headers: { ...json, origin: 'null' } }), {}).status).toBe(403);
    expect(decide(req({ method: 'POST', headers: { ...json, origin: 'http://localhost:5173' } }), {}).ok).toBe(true);
    expect(decide(req({ method: 'POST', headers: { ...json, origin: 'http://localhost:9999' } }), {}).ok).toBe(true);
    const viaTs = { ...TS, ...json, origin: 'https://mac.tail1234.ts.net:8443' };
    expect(decide(req({ method: 'POST', headers: viaTs }), ENV).ok).toBe(true);
  });

  it('une lecture n exige ni JSON ni origine', () => {
    expect(decide(req({ method: 'GET', headers: { origin: 'https://evil.com' } }), {}).ok).toBe(true);
  });
});

describe('configuration du serveur', () => {
  const cfg = readFileSync(join(new URL('.', import.meta.url).pathname, '..', 'vite.config.ts'), 'utf8');

  it('la garde passe avant l API, en développement comme en production', () => {
    const blocks = cfg.split(/configure(?:Preview)?Server\(/).slice(1);
    expect(blocks.length).toBe(2);
    for (const b of blocks) expect(b.indexOf('use(guard)')).toBeLessThan(b.indexOf('use(apiMiddleware)'));
  });

  it('le serveur n écoute que sur cet ordinateur', () => {
    expect(cfg).toMatch(/server: \{ host: '127\.0\.0\.1'/);
    expect(cfg).toMatch(/preview: \{ host: '127\.0\.0\.1'/);
    expect(cfg).not.toMatch(/0\.0\.0\.0/);
  });
});

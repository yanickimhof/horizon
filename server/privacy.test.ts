import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from './ledger';
import { EgressBlocked, consentGranted, guardedFetch, privacyMode, setTerms } from './egress';
import { scanDirectory } from './intake';
import { addTerm, pseudonymize, restore, restoreDeep, type Term } from '../src/core/pseudonym';

const okFetch = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
const req = (body = '{"secret":"contenu"}') => ({
  purpose: 'coach' as const,
  url: 'https://api.anthropic.com/v1/messages',
  init: { method: 'POST', body },
  summary: 'test',
});

beforeEach(() => {
  delete process.env.HORIZON_PRIVACY;
  (okFetch as any).mockClear();
});

describe('point de sortie unique', () => {
  it('bloque tout par défaut et le journalise', async () => {
    const l = new Ledger();
    expect(privacyMode(l)).toBe('local');
    await expect(guardedFetch(l, req(), okFetch)).rejects.toBeInstanceOf(EgressBlocked);
    expect(okFetch).not.toHaveBeenCalled();
    expect(l.egressLog()[0]).toMatchObject({ allowed: false, reason: 'Mode local', destination: 'api.anthropic.com' });
  });

  it('exige un accord explicite même en mode assisté', async () => {
    const l = new Ledger();
    l.setSetting('privacy.mode', 'assisted');
    await expect(guardedFetch(l, req(), okFetch)).rejects.toThrow(/Accord manquant/);
    expect(okFetch).not.toHaveBeenCalled();
    l.setSetting('consent.coach', new Date().toISOString());
    await guardedFetch(l, req(), okFetch);
    expect(okFetch).toHaveBeenCalledTimes(1);
    expect(l.egressLog()[0].allowed).toBe(true);
  });

  it('révoquer l accord bloque de nouveau', async () => {
    const l = new Ledger();
    l.setSetting('privacy.mode', 'assisted');
    l.setSetting('consent.coach', new Date().toISOString());
    await guardedFetch(l, req(), okFetch);
    l.setSetting('consent.coach', '');
    expect(consentGranted(l, 'coach')).toBeUndefined();
    await expect(guardedFetch(l, req(), okFetch)).rejects.toBeInstanceOf(EgressBlocked);
  });

  it('l environnement impose le mode local quoi que dise l interface', async () => {
    const l = new Ledger();
    l.setSetting('privacy.mode', 'assisted');
    l.setSetting('consent.coach', new Date().toISOString());
    process.env.HORIZON_PRIVACY = 'local';
    expect(privacyMode(l)).toBe('local');
    await expect(guardedFetch(l, req(), okFetch)).rejects.toBeInstanceOf(EgressBlocked);
    expect(l.egressLog()[0].reason).toMatch(/environnement/);
  });

  it('le journal ne contient jamais le contenu envoyé, seulement taille et empreinte', async () => {
    const l = new Ledger();
    l.setSetting('privacy.mode', 'assisted');
    l.setSetting('consent.coach', new Date().toISOString());
    await guardedFetch(l, req('{"nom":"Dupont","solde":123456}'), okFetch);
    const dump = JSON.stringify(l.egressLog());
    expect(dump).not.toMatch(/Dupont|123456/);
    expect(l.egressLog()[0].sha256).toHaveLength(64);
    expect(l.egressLog()[0].bytes).toBeGreaterThan(10);
  });

  it('une destination sur cet ordinateur n est pas bloquée ni comptée comme un envoi', async () => {
    const l = new Ledger();
    await guardedFetch(l, { ...req(), url: 'http://127.0.0.1:11434/api/chat' }, okFetch);
    expect(okFetch).toHaveBeenCalledTimes(1);
    expect(l.egressLog()).toHaveLength(0);
  });

  it('architecture: aucun appel réseau en dehors de egress.ts dans le serveur', () => {
    const dir = new URL('.', import.meta.url).pathname;
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'egress.ts')
      .filter((f) => {
        const src = readFileSync(join(dir, f), 'utf8');
        return (
          /(?<![A-Za-z])fetch\s*\(/.test(src) ||
          /from\s+['"]node:(https|net|dgram|tls|http2)['"]/.test(src) ||
          /import\s+(?!type)[^;]*from\s+['"]node:http['"]/.test(src) || // node:http n'est permis que pour des types
          /\b(XMLHttpRequest|WebSocket)\b/.test(src) ||
          /from\s+['"](axios|undici|node-fetch|got)['"]/.test(src)
        );
      });
    expect(offenders).toEqual([]);
  });
});

describe('pseudonymisation', () => {
  let terms: Term[] = [];
  beforeEach(() => {
    terms = addTerm(addTerm(addTerm([], 'Marie Dupont', 'personne'), 'Jean', 'personne'), 'Acme SA', 'employeur');
  });

  it('remplace par des jetons stables et restaure à l identique', () => {
    const src = 'Salaire de Marie Dupont chez Acme SA, et de Jean. Marie Dupont a signé.';
    const { text, count } = pseudonymize(src, terms);
    expect(text).not.toMatch(/Marie|Jean|Acme/);
    expect(text).toContain('[PERSONNE_1]');
    expect(text).toContain('[EMPLOYEUR_1]');
    expect(count).toBe(4);
    expect(restore(text, terms)).toBe(src);
  });

  it('ne touche pas l intérieur d un mot et ignore la casse', () => {
    const { text } = pseudonymize('Jeanne et JEAN, Jean-Luc', terms);
    expect(text).toBe('Jeanne et [PERSONNE_2], [PERSONNE_2]-Luc');
  });

  it('un jeton n est jamais re-remplacé, même si un terme ressemble à un jeton', () => {
    const t = addTerm(terms, 'personne', 'autre');
    const { text } = pseudonymize('Marie Dupont', t);
    expect(text).toBe('[PERSONNE_1]');
  });

  it('les numéros restent stables quand on supprime un terme', () => {
    const before = pseudonymize('Jean', terms).text;
    const without = terms.filter((t) => t.term !== 'Marie Dupont');
    expect(pseudonymize('Jean', without).text).toBe(before);
  });

  it('restaure en profondeur une proposition de fait reçue avec des jetons', () => {
    const fact = { label: 'Salaire de [PERSONNE_1]', nested: ['chez [EMPLOYEUR_1]'], n: 5 };
    expect(restoreDeep(fact, terms)).toEqual({ label: 'Salaire de Marie Dupont', nested: ['chez Acme SA'], n: 5 });
  });

  it('ignore les doublons et les termes trop courts', () => {
    expect(addTerm(terms, 'marie dupont', 'personne')).toHaveLength(3);
    expect(addTerm(terms, 'A', 'autre')).toHaveLength(3);
  });
});

describe('import avec pseudonymisation', () => {
  let root: string;
  let out: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'horizon-p-'));
    out = mkdtempSync(join(tmpdir(), 'horizon-po-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  it('le texte écrit pour analyse ne contient ni identifiants ni noms', () => {
    writeFileSync(join(root, 'taxation.txt'), 'Contribuable: Marie Dupont, employeur Acme SA\nAVS 756.1234.5678.97\nRevenu imposable 98000');
    const l = new Ledger();
    const terms = addTerm(addTerm([], 'Marie Dupont', 'personne'), 'Acme SA', 'employeur');
    setTerms(l, terms);
    const m = scanDirectory(root, l, out, terms);
    const written = readFileSync(m[0].extractedPath!, 'utf8');
    expect(written).not.toMatch(/Marie|Dupont|Acme|756\./);
    expect(written).toContain('98000');
    expect(m[0].pseudonymized).toBe(2);
  });
});

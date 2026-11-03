import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from './ledger';
import { scanDirectory, readWithRetry, unreadableNote } from './intake';
import { loadDemo } from './demo';
import { project } from '../src/core/project';
import { suggestMissing } from '../src/engine/gaps';

let root: string;
let out: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'horizon-in-'));
  out = mkdtempSync(join(tmpdir(), 'horizon-out-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
});

describe('import de dossier', () => {
  it('extrait le texte, masque les identifiants et n écrit jamais le brut', () => {
    mkdirSync(join(root, 'banque'));
    writeFileSync(join(root, 'banque', 'releve.csv'), 'date,libelle,montant\n2025-01-03,Loyer,-1900\nIBAN CH93 0076 2011 6238 5295 7\n');
    const l = new Ledger();
    const m = scanDirectory(root, l, out);
    expect(m).toHaveLength(1);
    expect(m[0].status).toBe('extracted');
    expect(m[0].redactions?.iban).toBe(1);
    const written = readFileSync(m[0].extractedPath!, 'utf8');
    expect(written).toContain('[IBAN]');
    expect(written).not.toContain('CH93');
    expect(written).toContain('-1900');
  });

  it('est idempotent: un fichier déjà vu est un doublon, même renommé', () => {
    writeFileSync(join(root, 'a.txt'), 'contenu identique');
    const l = new Ledger();
    expect(scanDirectory(root, l, out)[0].status).toBe('extracted');
    writeFileSync(join(root, 'copie.txt'), 'contenu identique');
    const second = scanDirectory(root, l, out);
    expect(second.every((e) => e.status === 'duplicate')).toBe(true);
    expect(l.sources()).toHaveLength(1);
  });

  it('signale ce qui demande une lecture visuelle et ignore les fichiers cachés', () => {
    writeFileSync(join(root, 'budget.xlsx'), 'pas vraiment un xlsx');
    writeFileSync(join(root, '.secret.txt'), 'caché');
    const m = scanDirectory(root, new Ledger(), out);
    expect(m).toHaveLength(1);
    expect(m[0].status).toBe('needs_reading');
  });
});

describe('informations manquantes', () => {
  const ctx = (l: Ledger) => ({ sourceNames: l.sources().map((s) => s.name), notes: l.notes().map((n) => n.text) });

  it('classe les manques par gain et propose les impôts et la prévoyance en premier', () => {
    const l = new Ledger();
    loadDemo(l);
    const gaps = suggestMissing(project(l.current(), new Date(), l.rates()), ctx(l));
    const ids = gaps.map((g) => g.id);
    expect(ids).toContain('tax');
    expect(ids).toContain('avs');
    expect(ids).not.toContain('pension'); // déjà confirmée dans l'exemple
    expect(gaps[0].impact).toBeGreaterThanOrEqual(gaps[gaps.length - 1].impact);
  });

  it('demande la prévoyance quand elle manque ou n est que supposée', () => {
    const l = new Ledger();
    loadDemo(l);
    const s = project(l.current(), new Date(), l.rates());
    s.assets = s.assets.filter((a) => a.class !== 'pension');
    expect(suggestMissing(s, ctx(l)).map((g) => g.id)).toContain('pension');
  });

  it('ne redemande pas ce qui est déjà importé', () => {
    const l = new Ledger();
    loadDemo(l);
    l.addSource({ kind: 'pdf', name: 'impots/taxation-2024.pdf', sha256: 'x', summary: null });
    l.correct('expense:tax', { amount: 2100 }, 'Lu sur la taxation');
    const ids = suggestMissing(project(l.current(), new Date(), l.rates()), ctx(l)).map((g) => g.id);
    expect(ids).not.toContain('tax');
  });

  it('ne propose pas de succession quand une note en parle', () => {
    const l = new Ledger();
    loadDemo(l);
    l.addNote('Régime matrimonial: participation aux acquêts, pas de testament.');
    expect(suggestMissing(project(l.current(), new Date(), l.rates()), ctx(l)).map((g) => g.id)).not.toContain('succession');
  });
});

describe('apprentissage par règles', () => {
  it('une règle apprise est réutilisée et fait monter l autonomie', () => {
    const l = new Ledger();
    const a = l.addSource({ kind: 'pdf', name: 'relevé 1', sha256: 'a', summary: null });
    const b = l.addSource({ kind: 'pdf', name: 'relevé 2', sha256: 'b', summary: null });
    l.markHandled(a.id, 'user');
    expect(l.autonomy().share).toBe(0);

    l.learn('merchant', 'migros|coop', { category: 'food', essential: true });
    expect(l.matchRule('merchant', 'COOP Filiale 12')).toEqual({ category: 'food', essential: true });
    expect(l.matchRule('merchant', 'Apple Store')).toBeUndefined();

    l.markHandled(b.id, 'rule');
    expect(l.autonomy()).toMatchObject({ handled: 2, byRule: 1, byUser: 1, share: 0.5 });
    expect(l.rulesCount()).toBe(1);
  });

  it('refuse un motif invalide', () => {
    expect(() => new Ledger().learn('merchant', '(', {})).toThrow();
  });
});

describe('fichiers illisibles (iCloud, permissions)', () => {
  const eagain = () => Object.assign(new Error('Unknown system error -11: Unknown system error -11, read'), { code: 'Unknown system error -11' });

  it('retente une erreur transitoire puis réussit', () => {
    let n = 0;
    const v = readWithRetry(() => { if (++n < 3) throw eagain(); return 'ok'; }, 4, 1);
    expect(v).toBe('ok');
    expect(n).toBe(3);
  });

  it('abandonne après les tentatives et ne retente pas une erreur définitive', () => {
    let n = 0;
    expect(() => readWithRetry(() => { n++; throw eagain(); }, 3, 1)).toThrow();
    expect(n).toBe(3);
    let m = 0;
    expect(() => readWithRetry(() => { m++; throw Object.assign(new Error('x'), { code: 'ENOENT' }); }, 3, 1)).toThrow();
    expect(m).toBe(1);
  });

  it('explique le cas iCloud et le cas permissions', () => {
    expect(unreadableNote(eagain())).toMatch(/iCloud.*Télécharger/);
    expect(unreadableNote(Object.assign(new Error('x'), { code: 'EPERM' }))).toMatch(/Fichiers et dossiers/);
  });

  it('un fichier illisible ne bloque pas le reste du dossier', () => {
    writeFileSync(join(root, 'ok.txt'), 'Salaire 2025: 120000 CHF, déclaration d impôt.\n'.repeat(3));
    mkdirSync(join(root, 'ferme'));
    writeFileSync(join(root, 'ferme', 'secret.txt'), 'contenu');
    chmodSync(join(root, 'ferme'), 0o000);
    try {
      const m = scanDirectory(root, new Ledger(':memory:'), out);
      expect(m.some((e) => e.path === 'ok.txt' && e.status === 'extracted')).toBe(true);
      if (process.getuid?.() !== 0) expect(m.some((e) => e.status === 'skipped' && /accès refusé/.test(e.note ?? ''))).toBe(true);
    } finally {
      chmodSync(join(root, 'ferme'), 0o755);
    }
  });
});

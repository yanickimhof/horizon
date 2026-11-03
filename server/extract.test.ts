import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Ledger } from './ledger';
import { extractFacts, parseProposals } from './extract';
import { getWatch, runWatch, setWatch } from './watch';
import type { ManifestEntry } from './intake';

const db = () => new Ledger(':memory:');

describe('lecture des propositions du modèle', () => {
  it('garde les faits valides et ignore les autres', () => {
    const text = 'Voici:\n```json\n[{"kind":"asset","key":"asset:lpp","data":{"label":"LPP","class":"pension","value":173693.75}},{"kind":"asset","key":"asset:x","data":{"label":"sans valeur"}},{"kind":"foo","key":"x:y","data":{}},{"kind":"note","key":"note","data":{"text":"2025: revenu imposable 164900"}}]\n```';
    const out = parseProposals(text);
    expect(out.map((p) => p.kind)).toEqual(['asset', 'note']);
    expect(out[0].key).toBe('asset:lpp');
  });

  it('renvoie une liste vide si la réponse n’est pas du JSON', () => {
    expect(parseProposals('Je ne peux pas.')).toEqual([]);
    expect(parseProposals('[pas du json]')).toEqual([]);
  });
});

describe('extraction de faits', () => {
  it('dépose des faits proposés, jamais confirmés, et restaure les noms', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hz-'));
    const file = join(dir, 'doc.txt');
    writeFileSync(file, 'Avoir de vieillesse 173694 pour [PERSONNE_1]');
    const l = db();
    const entry: ManifestEntry = { path: 'doc.txt', sha256: 'x', sizeBytes: 10, kind: 'manual', status: 'extracted', extractedPath: file, meta: { type: 'pension', country: 'CH', year: 2026 } };
    const llm = async () => ({ text: '[{"kind":"asset","key":"asset:lpp","data":{"label":"LPP","class":"pension","value":173694},"excerpt":"Avoir de vieillesse 173694"}]', costChf: 0.01 });
    const r = await extractFacts(l, entry, llm);
    expect(r.proposed).toBe(1);
    const inbox = l.inbox();
    expect(inbox).toHaveLength(1);
    expect(inbox[0].status).toBe('proposed');
    expect(l.current().some((f) => f.key === 'asset:lpp')).toBe(false);
  });

  it('enregistre une note pour une déclaration d’impôts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hz-'));
    const file = join(dir, 'tax.txt');
    writeFileSync(file, 'Revenu imposable 164900');
    const l = db();
    const entry: ManifestEntry = { path: 'tax.txt', sha256: 'y', sizeBytes: 10, kind: 'manual', status: 'extracted', extractedPath: file, meta: { type: 'tax-return', country: 'CH', year: 2025 } };
    const llm = async () => ({ text: '[{"kind":"note","key":"note","data":{"text":"revenu imposable 164900, fortune imposable 180000"}}]', costChf: 0.01 });
    const r = await extractFacts(l, entry, llm);
    expect(r.notes).toBe(1);
    expect(l.notes()[0].text).toContain('164900');
  });
});

describe('dossier surveillé', () => {
  it('lit les nouveaux fichiers une seule fois et apprend les noms', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hz-'));
    mkdirSync(join(dir, 'sous'));
    writeFileSync(join(dir, 'sous', 'lettre.txt'), 'Monsieur Dupont\nRue du Lac 12\nSolde 1250.30');
    const l = db();
    setWatch(l, { dirs: [dir], auto: true });
    expect(getWatch(l)).toEqual({ dirs: [dir], auto: true });
    const first = await runWatch(l, { extract: false });
    expect(first.status.read).toBe(1);
    expect(first.status.learned).toBeGreaterThan(0);
    const second = await runWatch(l, { extract: false });
    expect(second.status.read).toBe(0);
    expect(second.status.duplicates).toBe(1);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from './ledger';
import { scanDirectories } from './intake';
import { chunkText, formatPassages, retrieve, toMatch } from './rag';
import { inferMeta } from '../src/core/docmeta';
import { loadDemo } from './demo';
import { project } from '../src/core/project';
import { suggestMissing } from '../src/engine/gaps';
import { summarize } from '../src/engine/summary';

describe('reconnaissance des documents', () => {
  it('lit pays, année et type depuis le chemin', () => {
    expect(inferMeta('US/2023/Form-1040-return.pdf')).toEqual({ year: 2023, country: 'US', type: 'tax-return' });
  });

  it('complète avec le texte quand le nom ne dit rien', () => {
    const m = inferMeta('scan-0042.pdf', 'Canton de Vaud. Avis de taxation. Période fiscale 2021. Impôts cantonaux');
    expect(m).toMatchObject({ year: 2021, country: 'CH', type: 'tax-return' });
  });

  it('reconnaît un relevé bancaire sans inventer de pays', () => {
    const m = inferMeta('releve-2024-03.pdf', 'Extrait de compte. IBAN [IBAN]. Solde.');
    expect(m.type).toBe('bank');
    expect(m.year).toBe(2024);
    expect(m.country).toBeUndefined();
  });

  it('ignore les années hors plage et ne devine pas sans indice', () => {
    expect(inferMeta('notes-1234-2999.txt').year).toBeUndefined();
    expect(inferMeta('divers.txt')).toEqual({});
  });
});

describe('recherche plein texte', () => {
  it('découpe en passages sans dépasser la taille, même pour un long paragraphe', () => {
    const text = ['A '.repeat(300), 'B '.repeat(300), 'court'].join('\n\n');
    const c = chunkText(text, 400);
    expect(c.every((x) => x.length <= 400)).toBe(true);
    expect(c.join(' ')).toContain('court');
    const long = chunkText('x'.repeat(2500), 900);
    expect(long.length).toBe(3);
  });

  it('transforme une question en requête sûre, sans syntaxe injectée', () => {
    const q = toMatch('Quel impôt ai-je payé en 2023 ? OR NEAR("a" b) -x * AND');
    expect(q).toMatch(/^("[a-z0-9]+"\*)( OR "[a-z0-9]+"\*)*$/);
    expect(q).toContain('"impot"*');
    expect(q).toContain('"2023"*');
    expect(q).not.toMatch(/NEAR\(|"a" b|AND|\*\s*$\s*\*/); // aucun opérateur FTS non protégé
    expect(q).toContain('"near"*'); // le mot lui-même n'est qu'un terme entre guillemets
    expect(toMatch('le la les ?')).toBe('');
  });
});

describe('import de plusieurs dossiers et recherche', () => {
  let root: string;
  let out: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'horizon-d-'));
    out = mkdtempSync(join(tmpdir(), 'horizon-do-'));
    mkdirSync(join(root, 'CH', '2023'), { recursive: true });
    mkdirSync(join(root, 'CH', '2022'), { recursive: true });
    mkdirSync(join(root, 'US'), { recursive: true });
    writeFileSync(join(root, 'CH', '2023', 'taxation.txt'), 'Avis de taxation 2023. Canton de Vaud.\n\nRevenu imposable: 98000. Fortune imposable: 410000.\n\nIBAN CH93 0076 2011 6238 5295 7');
    writeFileSync(join(root, 'CH', '2022', 'taxation.txt'), 'Avis de taxation 2022. Canton de Vaud.\n\nRevenu imposable: 91000. Fortune imposable: 380000.');
    writeFileSync(join(root, 'US', '1040-2023.txt'), 'Form 1040 tax year 2023. IRS.\n\nWages: 52000. Total tax: 6100.');
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  const scan = (l: Ledger) => scanDirectories([join(root, 'CH'), join(root, 'US')], l, out);

  it('importe plusieurs dossiers et reconnaît pays, année et type', () => {
    const l = new Ledger();
    const m = scan(l);
    expect(m).toHaveLength(3);
    const byName = Object.fromEntries(l.sources().map((s) => [s.name, s.meta]));
    expect(byName['CH/2023/taxation.txt']).toMatchObject({ year: 2023, country: 'CH', type: 'tax-return' });
    expect(byName['CH/2022/taxation.txt']).toMatchObject({ year: 2022, country: 'CH' });
    expect(byName['US/1040-2023.txt']).toMatchObject({ year: 2023, country: 'US', type: 'tax-return' });
  });

  it('retrouve les passages pertinents avec leur source, et cite plusieurs années', () => {
    const l = new Ledger();
    scan(l);
    const ps = retrieve(l, 'Quel était mon revenu imposable ces dernières années ?', 6);
    expect(ps.length).toBeGreaterThanOrEqual(2);
    const years = new Set(ps.map((p) => p.year));
    expect(years.has(2023) && years.has(2022)).toBe(true);
    expect(ps.every((p) => p.source.length > 0)).toBe(true);
    expect(formatPassages(ps)).toContain('CH/2023/taxation.txt');
  });

  it('un même document ne monopolise pas les résultats', () => {
    const l = new Ledger();
    scan(l);
    const ps = retrieve(l, 'taxation revenu fortune impôt', 6, 1);
    const per = new Map<string, number>();
    ps.forEach((p) => per.set(p.sourceId, (per.get(p.sourceId) ?? 0) + 1));
    expect(Math.max(...per.values())).toBe(1);
  });

  it('CONFIDENTIALITÉ: l index ne contient jamais le brut', () => {
    const l = new Ledger();
    scan(l);
    expect(retrieve(l, 'CH93 0076 2011 6238 5295', 6)).toEqual([]);
    expect(retrieve(l, 'IBAN', 6).map((p) => p.text).join(' ')).not.toMatch(/CH93/);
  });

  it('ne retraite pas un fichier déjà vu et ne réindexe pas', () => {
    const l = new Ledger();
    scan(l);
    const n = l.chunkCount();
    expect(scan(l).every((e) => e.status === 'duplicate')).toBe(true);
    expect(l.chunkCount()).toBe(n);
  });

  it('une question sans mot utile ne renvoie rien plutôt que n importe quoi', () => {
    const l = new Ledger();
    scan(l);
    expect(retrieve(l, 'et le la ?', 6)).toEqual([]);
    expect(retrieve(l, 'zzzzqqqq', 6)).toEqual([]);
  });
});

describe('manques liés aux documents', () => {
  const ctxOf = (l: Ledger) => ({ sourceNames: l.sources().map((s) => s.name), notes: l.notes().map((n) => n.text), sources: l.sources().map((s) => ({ name: s.name, meta: s.meta })) });

  it('demande plus d années quand une seule déclaration est fournie, plus quand il y en a trois', () => {
    const l = new Ledger();
    loadDemo(l);
    l.addSource({ kind: 'pdf', name: 'CH/taxation-2023.pdf', sha256: 'a', summary: null, meta: { year: 2023, country: 'CH', type: 'tax-return' } });
    let gaps = suggestMissing(project(l.current(), new Date(), l.rates()), ctxOf(l));
    expect(gaps.map((g) => g.id)).toContain('tax-history');
    l.addSource({ kind: 'pdf', name: 'CH/taxation-2022.pdf', sha256: 'b', summary: null, meta: { year: 2022, country: 'CH', type: 'tax-return' } });
    l.addSource({ kind: 'pdf', name: 'CH/taxation-2021.pdf', sha256: 'c', summary: null, meta: { year: 2021, country: 'CH', type: 'tax-return' } });
    gaps = suggestMissing(project(l.current(), new Date(), l.rates()), ctxOf(l));
    expect(gaps.map((g) => g.id)).not.toContain('tax-history');
  });

  it('demande la déclaration américaine quand des actifs américains existent', () => {
    const l = new Ledger();
    loadDemo(l);
    const gaps = suggestMissing(project(l.current(), new Date(), l.rates()), ctxOf(l));
    expect(gaps.map((g) => g.id)).toContain('tax-us');
    l.addSource({ kind: 'pdf', name: 'US/1040-2023.pdf', sha256: 'd', summary: null, meta: { year: 2023, country: 'US', type: 'tax-return' } });
    expect(suggestMissing(project(l.current(), new Date(), l.rates()), ctxOf(l)).map((g) => g.id)).not.toContain('tax-us');
  });
});

describe('synthèse chiffrée', () => {
  it('patrimoine net = actifs - dettes, et les parts font 100 %', () => {
    const l = new Ledger();
    loadDemo(l);
    const sn = project(l.current(), new Date(), l.rates());
    const s = summarize(sn);
    expect(s.netWorth).toBeCloseTo(s.grossAssets - s.debts, 6);
    for (const group of [s.byClass, s.byCurrency, s.byRegion]) {
      expect(group.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 6);
    }
    expect(s.byClass[0].key).toBe('real_estate');
    expect(s.byCurrency.map((x) => x.key)).toEqual(expect.arrayContaining(['CHF', 'USD', 'CRYPTO']));
    expect(s.savingsRate).not.toBeNull();
    expect(s.surplus).toBeCloseTo(s.income - s.expenses, 6);
  });
});

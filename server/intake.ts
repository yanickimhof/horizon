import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { redact, type RedactionCounts } from '../src/core/redact';
import { addTerm, pseudonymize, type Term } from '../src/core/pseudonym';
import { detectTerms } from '../src/core/autoterms';
import { ocrFile } from './ocr';
import { pdfTextLayer } from './pdftext';
import { inferMeta, type DocMeta } from '../src/core/docmeta';
import { chunkText } from './rag';
import type { Source } from '../src/core/types';
import type { Ledger } from './ledger';

export interface ManifestEntry {
  path: string;
  sha256: string;
  sizeBytes: number;
  kind: Source['kind'];
  /**
   * extracted     : texte extrait et masqué, prêt à être lu
   * needs_reading : pas de texte exploitable (scan, image, tableur): à lire visuellement
   * duplicate     : déjà importé
   * skipped       : ignoré (trop gros, caché)
   */
  status: 'extracted' | 'needs_reading' | 'duplicate' | 'skipped';
  extractedPath?: string;
  redactions?: RedactionCounts;
  chars?: number;
  /** Nombre de termes sensibles (noms, employeur, adresses) remplacés par des jetons. */
  pseudonymized?: number;
  /** Chemin absolu du fichier, pour les lecteurs de relevés. */
  abs?: string;
  /** Source enregistrée dans le registre, pour relier les faits proposés à leur document. */
  sourceId?: string;
  /** Nouveaux noms ou adresses détectés dans ce document et ajoutés à la liste des termes masqués. */
  learned?: number;
  /** Pays, année et type reconnus. */
  meta?: DocMeta;
  /** Nombre de passages indexés pour la recherche. */
  chunks?: number;
  note?: string;
}

const TEXT_EXT = new Set(['.txt', '.md', '.csv', '.tsv', '.json', '.xml', '.html', '.htm', '.ofx', '.qif']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.heic', '.tif', '.tiff']);
const MAX_BYTES = 50 * 1024 * 1024;

const sha = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

function run(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/** Erreurs transitoires typiques d'un fichier iCloud non téléchargé ou d'un volume lent. */
const TRANSIENT = new Set(['EDEADLK', 'EAGAIN', 'EBUSY', 'EINTR', 'ETIMEDOUT', 'EIO']);

function errCode(e: unknown): string {
  const err = e as NodeJS.ErrnoException;
  // Sur macOS, lire un fichier iCloud pas encore téléchargé échoue avec l'erreur 11 (EDEADLK), que Node
  // n'a pas de nom pour: il affiche « Unknown system error -11 », parfois dans le champ code lui-même.
  if (/(^|\s)-?11\b/.test(`${err?.code ?? ''} ${err?.message ?? ''}`) && /Unknown system error/.test(`${err?.code ?? ''} ${err?.message ?? ''}`)) return 'EDEADLK';
  if (err?.code) return err.code;
  return 'UNKNOWN';
}

const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Exécute une lecture en la retentant quand l'erreur est transitoire. Sur macOS, lire un
 * fichier iCloud « en ligne seulement » déclenche son téléchargement et échoue d'abord.
 */
export function readWithRetry<T>(fn: () => T, attempts = 3, delayMs = 400): T {
  for (let i = 1; ; i++) {
    try {
      return fn();
    } catch (e) {
      if (i >= attempts || !TRANSIENT.has(errCode(e))) throw e;
      pause(delayMs * i);
    }
  }
}

export function unreadableNote(e: unknown): string {
  const code = errCode(e);
  if (code === 'EDEADLK' || code === 'EAGAIN' || code === 'EBUSY' || code === 'ETIMEDOUT' || code === 'EIO') {
    return 'illisible pour l\'instant (fichier iCloud pas encore téléchargé ?): faire « Télécharger maintenant » dans le Finder puis relancer';
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return 'accès refusé par macOS: autoriser le Terminal (ou Node) dans Réglages > Confidentialité > Fichiers et dossiers, puis relancer';
  }
  return `illisible (${code})`;
}

function walk(dir: string, out: string[] = [], issues: ManifestEntry[] = [], root = dir): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    issues.push({ path: relative(root, dir) || '.', sha256: '', sizeBytes: 0, kind: 'manual', status: 'skipped', note: unreadableNote(e) });
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out, issues, root);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function extractText(file: string, ext: string): { text: string | null; note?: string } {
  if (TEXT_EXT.has(ext)) return { text: readWithRetry(() => readFileSync(file, 'utf8')) };
  if (ext === '.pdf') {
    const t = run('pdftotext', ['-layout', file, '-']);
    if (t === null || t.replace(/\s/g, '').length < 50) {
      // Pas de pdftotext: la couche texte du PDF, lue par PDFKit, est exacte. La reconnaissance optique ne sert qu'aux scans.
      const layer = pdfTextLayer(file);
      if (layer) return { text: layer };
      // Scan: reconnaissance de texte locale quand elle est disponible.
      const o = ocrFile(file);
      if (o) return { text: o, note: 'texte reconnu par OCR (scan), à vérifier' };
      return { text: null, note: t === null ? 'pdftotext indisponible: à lire visuellement' : 'PDF sans texte (scan probable): à lire visuellement' };
    }
    return { text: t };
  }
  if (IMAGE_EXT.has(ext)) {
    const t = run('tesseract', [file, 'stdout']);
    if (t && t.replace(/\s/g, '').length >= 30) return { text: t, note: 'texte reconnu par OCR, à vérifier' };
    const o = ocrFile(file);
    if (o) return { text: o, note: 'texte reconnu par OCR, à vérifier' };
    return { text: null, note: 'image: à lire visuellement' };
  }
  return { text: null, note: `format ${ext || 'inconnu'}: à lire visuellement ou à convertir` };
}

/** Texte masqué d'un fichier (reconnaissance de texte comprise), sans toucher au registre. Sert à relire un fichier déjà connu. */
export function maskedTextOf(file: string, terms: Term[], learn = false): { text: string | null; terms: Term[]; note?: string } {
  let ex: { text: string | null; note?: string };
  try {
    ex = extractText(file, extname(file).toLowerCase());
  } catch (e) {
    return { text: null, terms, note: unreadableNote(e) };
  }
  if (ex.text === null) return { text: null, terms, note: ex.note };
  const redacted = redact(ex.text);
  let t = terms;
  if (learn) for (const f of detectTerms(redacted.text)) t = addTerm(t, f.term, f.kind);
  return { text: pseudonymize(redacted.text, t).text, terms: t, note: ex.note };
}

/**
 * Parcourt un dossier, extrait le texte, masque les identifiants sensibles et
 * écrit le résultat dans outDir. Idempotent: un fichier déjà vu (même contenu) est
 * ignoré, même renommé ou déplacé. Le texte brut n'est jamais écrit sur disque.
 */
export interface ScanOptions {
  /** Détecter les noms et adresses du document et les ajouter aux termes masqués. */
  learn?: boolean;
  /** En sortie: la liste complète des termes, anciens et nouveaux, à enregistrer. */
  terms?: Term[];
}

export function scanDirectory(dir: string, ledger: Ledger, outDir = 'inbox/extracted', terms: Term[] = [], label?: string, opts: ScanOptions = {}): ManifestEntry[] {
  const root = resolve(dir);
  let isDir = false;
  try {
    isDir = readWithRetry(() => statSync(root).isDirectory());
  } catch (e) {
    throw new Error(`Dossier illisible: ${dir}: ${unreadableNote(e)}`);
  }
  if (!isDir) throw new Error(`Pas un dossier: ${dir}`);
  mkdirSync(outDir, { recursive: true });
  const manifest: ManifestEntry[] = [];
  const seen = new Set<string>();
  let transient = 0;
  const issues: ManifestEntry[] = [];
  const files = walk(root, [], issues);
  for (const i of issues) manifest.push({ ...i, path: label ? `${label}/${i.path}` : i.path });

  for (const file of files) {
    const rel0 = relative(root, file);
    const rel = label ? `${label}/${rel0}` : rel0;
    let size = 0;
    let buf: Buffer;
    try {
      // Après quelques fichiers iCloud illisibles, on arrête d'attendre: le dossier n'est pas téléchargé.
      const tries = transient >= 5 ? 1 : 3;
      size = readWithRetry(() => statSync(file).size, tries);
      if (size <= MAX_BYTES) buf = readWithRetry(() => readFileSync(file), tries);
    } catch (e) {
      if (TRANSIENT.has(errCode(e))) transient++;
      manifest.push({ path: rel, sha256: '', sizeBytes: size, kind: 'manual', status: 'skipped', note: unreadableNote(e) });
      continue;
    }
    if (size > MAX_BYTES) {
      manifest.push({ path: rel, sha256: '', sizeBytes: size, kind: 'manual', status: 'skipped', note: 'fichier trop gros' });
      continue;
    }
    const hash = sha(buf!);
    const ext = extname(file).toLowerCase();
    const kind: Source['kind'] = ext === '.pdf' ? 'pdf' : IMAGE_EXT.has(ext) ? 'screenshot' : 'manual';

    if (ledger.hasSource(hash) || seen.has(hash)) {
      manifest.push({ path: rel, sha256: hash, sizeBytes: size, kind, status: 'duplicate', abs: file });
      continue;
    }
    seen.add(hash);

    let extracted: { text: string | null; note?: string };
    try {
      extracted = extractText(file, ext);
    } catch (e) {
      manifest.push({ path: rel, sha256: hash, sizeBytes: size, kind, status: 'skipped', note: unreadableNote(e) });
      seen.delete(hash);
      continue;
    }
    const { text, note } = extracted;
    if (text === null) {
      const meta = inferMeta(rel);
      ledger.addSource({ kind, name: rel, sha256: hash, summary: note ?? null, meta });
      manifest.push({ path: rel, sha256: hash, sizeBytes: size, kind, status: 'needs_reading', meta, note, abs: file });
      continue;
    }
    const redacted = redact(text);
    let learned = 0;
    if (opts.learn) {
      for (const f of detectTerms(redacted.text)) {
        const before = terms.length;
        terms = addTerm(terms, f.term, f.kind);
        if (terms.length > before) learned++;
      }
    }
    const pseudo = pseudonymize(redacted.text, terms);
    const clean = pseudo.text;
    const counts = redacted.counts;
    const safe = basename(file).replace(/[^\w.-]+/g, '_');
    const extractedPath = join(outDir, `${hash.slice(0, 8)}-${safe}.txt`);
    writeFileSync(extractedPath, clean);
    // La reconnaissance se fait sur le texte masqué: elle n'a besoin ni des identifiants ni des noms.
    const meta = inferMeta(rel, clean);
    const src = ledger.addSource({ kind, name: rel, sha256: hash, summary: note ?? null, meta });
    const chunks = chunkText(clean);
    ledger.indexChunks(src.id, chunks);
    manifest.push({ path: rel, sha256: hash, sizeBytes: size, kind, status: 'extracted', abs: file, extractedPath, redactions: counts, pseudonymized: pseudo.count, sourceId: src.id, learned, meta, chunks: chunks.length, chars: clean.length, note });
  }
  opts.terms = terms;
  return manifest;
}

/**
 * Plusieurs dossiers d'un coup (par exemple Suisse, États-Unis, banque). Le nom du dossier
 * racine est conservé dans le chemin: il aide à reconnaître le pays et l'année.
 * Un fichier présent dans deux dossiers n'est traité qu'une fois.
 */
export function scanDirectories(dirs: string[], ledger: Ledger, outDir = 'inbox/extracted', terms: Term[] = [], opts: ScanOptions = {}): ManifestEntry[] {
  const all: ManifestEntry[] = [];
  let current = terms;
  for (const d of dirs.map((x) => x.trim()).filter(Boolean)) {
    const root = resolve(d);
    const label = basename(root);
    const local: ScanOptions = { learn: opts.learn };
    all.push(...scanDirectory(root, ledger, outDir, current, label, local));
    current = local.terms ?? current;
  }
  opts.terms = current;
  return all;
}

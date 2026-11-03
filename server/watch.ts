import type { Ledger } from './ledger';
import { getTerms, setTerms } from './egress';
import { maskedTextOf, scanDirectories, type ManifestEntry } from './intake';
import { extractFacts } from './extract';
import { extractTransactions, looksLikeStatement } from './tx-extract';
import { isVisecaBill, parseVisecaBill } from './viseca';
import { parseStatement } from './statements';
import { storeStatements } from './budget';
import { classifyStored } from './budget-ai';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { inferMeta } from '../src/core/docmeta';
import { basename, extname } from 'node:path';

/**
 * Dossier surveillé: l'utilisateur dépose ses documents dans un ou plusieurs dossiers. Horizon les contrôle à la demande
 * ou automatiquement, lit les nouveaux fichiers, masque les identifiants, apprend les noms et adresses, puis dépose des
 * faits à valider. Un fichier déjà lu (même contenu) n'est jamais relu. Tout reste sur l'ordinateur, sauf le texte masqué
 * envoyé au modèle quand l'accord « analyse » est donné.
 */
export interface WatchConfig {
  dirs: string[];
  auto: boolean;
}

export interface WatchStatus {
  at: string;
  /** Documents lus et masqués cette fois-ci. */
  read: number;
  duplicates: number;
  /** Documents sans texte exploitable, à lire visuellement. */
  unreadable: number;
  /** Faits proposés dans « À valider ». */
  proposed: number;
  /** Lignes de relevés ajoutées au budget, et nombre de relevés lus. */
  transactions: number;
  statements: number;
  /** Nouveaux noms ou adresses ajoutés aux termes masqués. */
  learned: number;
  costChf: number;
  notes: string[];
}

/**
 * Un fichier déjà vu mais dont la lecture n'a pas abouti (lecture interrompue, accord d'analyse manquant) est repris
 * à la lecture suivante: seul un fichier « traité » est ignoré.
 */
const isProcessed = (l: Ledger, sha: string): boolean => l.getSetting(`processed.${sha}`) === '1';
const markProcessed = (l: Ledger, sha: string): void => l.setSetting(`processed.${sha}`, '1');

/** Retrouve le texte masqué déjà extrait d'un fichier connu, d'après l'empreinte de son contenu. */
function findExtracted(sha: string, outDir = 'inbox/extracted'): string | undefined {
  try {
    if (!existsSync(outDir)) return undefined;
    const f = readdirSync(outDir).find((n) => n.startsWith(`${sha.slice(0, 8)}-`));
    return f ? `${outDir}/${f}` : undefined;
  } catch {
    return undefined;
  }
}

export function getWatch(l: Ledger): WatchConfig {
  let dirs: string[] = [];
  try {
    const v = JSON.parse(l.getSetting('watch.dirs') ?? '[]');
    if (Array.isArray(v)) dirs = v.map(String).filter(Boolean);
  } catch {
    /* configuration illisible: aucun dossier */
  }
  return { dirs, auto: l.getSetting('watch.auto') === '1' };
}

export function setWatch(l: Ledger, patch: Partial<WatchConfig>): WatchConfig {
  if (patch.dirs) l.setSetting('watch.dirs', JSON.stringify(patch.dirs.map((d) => d.trim()).filter(Boolean)));
  if (patch.auto !== undefined) l.setSetting('watch.auto', patch.auto ? '1' : '0');
  return getWatch(l);
}

export function lastWatch(l: Ledger): WatchStatus | null {
  try {
    const v = l.getSetting('watch.last');
    return v ? (JSON.parse(v) as WatchStatus) : null;
  } catch {
    return null;
  }
}

/** Contrôle les dossiers, lit ce qui est nouveau et propose des faits. */
export async function runWatch(l: Ledger, opts: { extract?: boolean } = {}): Promise<{ status: WatchStatus; manifest: ManifestEntry[] }> {
  const cfg = getWatch(l);
  // Migration unique: les sources déjà enregistrées avant ce suivi sont considérées comme traitées.
  if (l.getSetting('processed.migrated') !== '1') {
    for (const s of l.sources()) if (s.sha256) markProcessed(l, s.sha256);
    l.setSetting('processed.migrated', '1');
  }
  const status: WatchStatus = { at: new Date().toISOString(), read: 0, duplicates: 0, unreadable: 0, proposed: 0, transactions: 0, statements: 0, learned: 0, costChf: 0, notes: [] };
  if (cfg.dirs.length === 0) {
    status.notes.push('Aucun dossier indiqué.');
    return { status, manifest: [] };
  }
  step(l, 'Lecture et masquage des fichiers');
  const scan = { learn: true, terms: getTerms(l) };
  const manifest = scanDirectories(cfg.dirs, l, 'inbox/extracted', getTerms(l), scan);
  setTerms(l, scan.terms);
  // Reprise: un fichier connu mais pas encore traité redevient « à lire ».
  let reTerms = getTerms(l);
  for (const m of manifest) {
    if (m.status !== 'duplicate' || isProcessed(l, m.sha256)) continue;
    const ext = extname(m.abs ?? '').toLowerCase();
    if (['.csv', '.xml', '.txt'].includes(ext) && m.abs) {
      m.status = 'extracted';
      continue;
    }
    // Le texte est relu avec la reconnaissance actuelle (mise en page par lignes), pas avec une extraction ancienne.
    if (m.abs) {
      const stored = findExtracted(m.sha256);
      let fresh = false;
      try {
        fresh = stored !== undefined && statSync(stored).mtimeMs > Math.max(statSync('scripts/ocr.swift').mtimeMs, statSync('scripts/pdftext.swift').mtimeMs);
      } catch {
        fresh = stored !== undefined;
      }
      if (stored && fresh) {
        m.status = 'extracted';
        m.extractedPath = stored;
        m.meta = inferMeta(m.path, readFileSync(stored, 'utf8'));
        continue;
      }
      const mt = maskedTextOf(m.abs, reTerms, true);
      reTerms = mt.terms;
      if (mt.text) {
        const path = findExtracted(m.sha256) ?? `inbox/extracted/${m.sha256.slice(0, 8)}-${basename(m.abs).replace(/[^\w.-]+/g, '_')}.txt`;
        writeFileSync(path, mt.text);
        m.status = 'extracted';
        m.extractedPath = path;
        m.meta = inferMeta(m.path, mt.text);
      }
    }
  }
  setTerms(l, reTerms);
  for (const m of manifest) {
    if (m.status === 'extracted') {
      status.read++;
      status.learned += m.learned ?? 0;
    } else if (m.status === 'duplicate') status.duplicates++;
    else if (m.status === 'needs_reading' || m.status === 'skipped') {
      status.unreadable++;
      if (m.note) status.notes.push(`${m.path}: ${m.note}`);
    }
  }
  // Les relevés (CSV, camt.053, PDF, copies d'écran) alimentent le budget; ils ne donnent pas de faits.
  const statementPaths = new Set<string>();
  let i = 0;
  for (const m of manifest) {
    i++;
    step(l, `Relevés: ${i} sur ${manifest.length}`);
    if ((m.status !== 'extracted' && m.status !== 'needs_reading') || !m.abs) continue;
    const ext = extname(m.abs).toLowerCase();
    try {
      if (['.csv', '.xml', '.txt'].includes(ext)) {
        const buf = readFileSync(m.abs);
        let raw: string;
        try {
          raw = new TextDecoder('utf-8', { fatal: true }).decode(buf);
        } catch {
          raw = new TextDecoder('iso-8859-1').decode(buf);
        }
        const parsed = parseStatement(basename(m.abs), raw);
        if (parsed.txs.length >= 3) {
          const r = storeStatements(l, [parsed], m.path);
          status.transactions += r.added;
          status.statements++;
          statementPaths.add(m.path);
          markProcessed(l, m.sha256);
        }
        continue;
      }
      if (m.status === 'extracted' && m.extractedPath && opts.extract !== false) {
        const text = readFileSync(m.extractedPath, 'utf8');
        if (looksLikeStatement(text, m.meta?.type)) {
          // Un document qui ressemble à un relevé ne donne pas de faits, même si sa lecture échoue: il sera repris à la prochaine lecture.
          statementPaths.add(m.path);
          const statementLike = true;
          void statementLike;
          // Facture de carte Viseca: format régulier, lu sans modèle et contrôlé sur le total imprimé.
          const vb = isVisecaBill(text) ? parseVisecaBill(text) : null;
          if (vb) {
            if (vb.reconciled === false) {
              status.notes.push(`${m.path}: les lignes (${vb.sum}) ne retrouvent pas le total de la facture (${vb.total}), rien n'est enregistré.`);
            } else {
              const r = storeStatements(l, vb.statements, m.path);
              status.transactions += r.added;
              status.statements++;
              markProcessed(l, m.sha256);
            }
            continue;
          }
          const r = await extractTransactions(l, text, m.path);
          status.costChf += r.costChf;
          if (r.stored > 0 || r.skipped > 0) {
            status.transactions += r.stored;
            status.statements++;
            statementPaths.add(m.path);
            markProcessed(l, m.sha256);
          }
          if (r.note) status.notes.push(`${m.path}: ${r.note}`);
        }
      }
    } catch {
      status.notes.push(`${m.path}: relevé illisible`);
    }
  }
  if (opts.extract !== false && status.transactions > 0) {
    step(l, 'Classement des lignes inconnues');
    const ai = await classifyStored(l);
    status.costChf += ai.costChf;
    if (ai.classified > 0) status.notes.push(`${ai.classified} ligne${ai.classified > 1 ? 's' : ''} classée${ai.classified > 1 ? 's' : ''} par Claude.`);
  }
  if (opts.extract !== false) {
    let blocked = '';
    step(l, 'Lecture des autres documents');
    for (const m of manifest.filter((x) => x.status === 'extracted' && !statementPaths.has(x.path))) {
      if (blocked) break;
      const r = await extractFacts(l, m);
      if (r.proposed > 0 || r.notes > 0 || !/autoris|accord|plafond|clé|mode local/i.test(r.note)) markProcessed(l, m.sha256);
      status.proposed += r.proposed;
      status.costChf += r.costChf;
      if (r.proposed === 0 && r.notes === 0 && /autoris|accord|plafond|clé|mode local/i.test(r.note)) blocked = r.note;
    }
    if (blocked) status.notes.push(`Faits non proposés: ${blocked}`);
  }
  // Sans analyse demandée, la lecture et le masquage suffisent: ces fichiers ne sont pas repris.
  if (opts.extract === false) for (const m of manifest) if (m.status === 'extracted') markProcessed(l, m.sha256);
  status.notes = status.notes.slice(0, 20);
  l.setSetting('watch.last', JSON.stringify(status));
  return { status, manifest };
}

let running = false;
let timer: NodeJS.Timeout | undefined;

/** Avancement de la lecture en cours, affiché par l'interface. */
export interface WatchProgress {
  running: boolean;
  step: string;
  startedAt: string | null;
}

const progress = new WeakMap<object, WatchProgress>();
export const watchProgress = (l: Ledger): WatchProgress => progress.get(l) ?? { running: false, step: '', startedAt: null };

/**
 * Lance la lecture sans attendre la fin. Rend false si une lecture est déjà en cours.
 * L'interface interroge l'état régulièrement et affiche le résultat dès qu'il est prêt.
 */
export function startRun(l: Ledger, opts: { extract?: boolean } = {}): boolean {
  if (watchProgress(l).running) return false;
  progress.set(l, { running: true, step: 'Lecture des fichiers', startedAt: new Date().toISOString() });
  setImmediate(() => {
    runWatch(l, opts)
      .catch((e) => {
        const status: WatchStatus = { at: new Date().toISOString(), read: 0, duplicates: 0, unreadable: 0, proposed: 0, transactions: 0, statements: 0, learned: 0, costChf: 0, notes: [`Erreur: ${e instanceof Error ? e.message : String(e)}`] };
        l.setSetting('watch.last', JSON.stringify(status));
      })
      .finally(() => progress.set(l, { running: false, step: '', startedAt: null }));
  });
  return true;
}

/** Met à jour l'étape affichée, si une lecture est en cours. */
function step(l: Ledger, text: string): void {
  const p = progress.get(l);
  if (p?.running) progress.set(l, { ...p, step: text });
}

/** Contrôle automatique toutes les `everyMs` millisecondes quand l'utilisateur l'a activé. */
export function startWatcher(getLedger: () => Ledger, everyMs = 15 * 60_000): void {
  if (timer) return;
  timer = setInterval(async () => {
    if (running) return;
    try {
      const l = getLedger();
      if (!getWatch(l).auto) return;
      running = true;
      await runWatch(l);
    } catch {
      /* une erreur ne doit pas arrêter la surveillance */
    } finally {
      running = false;
    }
  }, everyMs);
  timer.unref?.();
}

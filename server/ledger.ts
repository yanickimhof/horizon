import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { Fact, FactDraft, FactKind, Note, Origin, Source, Status } from '../src/core/types';
import { validateData } from '../src/core/schema';
import type { RateTable } from '../src/engine/fx';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  data TEXT NOT NULL,
  status TEXT NOT NULL,
  origin TEXT NOT NULL,
  confidence REAL NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  recorded_at TEXT NOT NULL,
  source_id TEXT,
  excerpt TEXT,
  why TEXT
);
CREATE INDEX IF NOT EXISTS facts_key ON facts(key);
CREATE INDEX IF NOT EXISTS facts_status ON facts(status);
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  sha256 TEXT,
  added_at TEXT NOT NULL,
  summary TEXT,
  handled_by TEXT,
  meta TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
  text,
  source_id UNINDEXED,
  ord UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TABLE IF NOT EXISTS prices (
  symbol TEXT NOT NULL,
  at TEXT NOT NULL,
  per_unit REAL NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (symbol, at)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS egress (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  destination TEXT NOT NULL,
  purpose TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  summary TEXT NOT NULL,
  allowed INTEGER NOT NULL,
  reason TEXT
);
CREATE TABLE IF NOT EXISTS usage (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  model TEXT NOT NULL,
  purpose TEXT NOT NULL,
  input INTEGER NOT NULL,
  output INTEGER NOT NULL,
  cost_usd REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  pattern TEXT NOT NULL,
  mapping TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  keys TEXT NOT NULL
);
`;

type Row = Record<string, unknown>;

const toFact = (r: Row): Fact => ({
  id: r.id as string,
  kind: r.kind as FactKind,
  key: r.key as string,
  data: JSON.parse(r.data as string),
  status: r.status as Status,
  origin: r.origin as Origin,
  confidence: r.confidence as number,
  validFrom: r.valid_from as string,
  validTo: (r.valid_to as string | null) ?? null,
  recordedAt: r.recorded_at as string,
  sourceId: (r.source_id as string | null) ?? null,
  excerpt: (r.excerpt as string | null) ?? null,
  why: (r.why as string | null) ?? null,
});

/**
 * Registre de faits local (SQLite). Règles :
 * - un fait n'est jamais modifié ni supprimé, il est remplacé (status = superseded) ;
 * - un fait supposé (assumed) ne peut jamais écraser un fait confirmé ;
 * - un fait proposé (proposed) n'entre pas dans les calculs avant confirmation.
 */
export class Ledger {
  private db: DatabaseSync;

  /** Accès direct à la base, pour les modules qui ont leurs propres tables (budget). */
  get raw(): DatabaseSync {
    return this.db;
  }

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
    for (const col of ['handled_by TEXT', 'meta TEXT']) {
      try {
        this.db.exec(`ALTER TABLE sources ADD COLUMN ${col}`);
      } catch {
        /* colonne déjà présente */
      }
    }
  }

  close(): void {
    this.db.close();
  }

  private now(): string {
    return new Date().toISOString();
  }

  private insert(d: FactDraft, status: Status): Fact {
    const fact: Fact = {
      id: randomUUID(),
      kind: d.kind,
      key: d.key,
      data: d.data,
      status,
      origin: d.origin,
      confidence: d.confidence,
      validFrom: d.validFrom ?? this.now(),
      validTo: null,
      recordedAt: this.now(),
      sourceId: d.sourceId,
      excerpt: d.excerpt,
      why: d.why,
    };
    this.db
      .prepare(
        `INSERT INTO facts (id,kind,key,data,status,origin,confidence,valid_from,valid_to,recorded_at,source_id,excerpt,why)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        fact.id, fact.kind, fact.key, JSON.stringify(fact.data), fact.status, fact.origin, fact.confidence,
        fact.validFrom, null, fact.recordedAt, fact.sourceId, fact.excerpt, fact.why,
      );
    return fact;
  }

  private supersede(id: string): void {
    this.db.prepare(`UPDATE facts SET status='superseded', valid_to=? WHERE id=?`).run(this.now(), id);
  }

  private mustValidate(kind: FactKind, data: Record<string, unknown>): void {
    const problems = validateData(kind, data);
    if (problems.length) throw new Error(`Fait invalide (${kind}): ${problems.join(', ')}`);
  }

  /** Fait en vigueur pour une clé : confirmé ou supposé. */
  currentOf(key: string): Fact | undefined {
    const r = this.db
      .prepare(`SELECT * FROM facts WHERE key=? AND status IN ('confirmed','assumed') ORDER BY recorded_at DESC, rowid DESC LIMIT 1`)
      .get(key) as Row | undefined;
    return r ? toFact(r) : undefined;
  }

  /** Valeur supposée. Ne touche jamais à un fait confirmé. Retourne null si ignoré. */
  assume(d: FactDraft): Fact | null {
    this.mustValidate(d.kind, d.data);
    const cur = this.currentOf(d.key);
    if (cur?.status === 'confirmed') return null;
    if (cur) this.supersede(cur.id);
    return this.insert({ ...d, origin: d.origin === 'user' ? 'inferred' : d.origin }, 'assumed');
  }

  /** Proposition extraite d'un message ou d'un document, en attente de validation. */
  propose(d: FactDraft): Fact {
    return this.insert(d, 'proposed');
  }

  /** Valide une proposition (avec correction éventuelle). Remplace le fait en vigueur. */
  confirm(id: string, patch: Record<string, unknown> = {}): Fact {
    const row = this.db.prepare(`SELECT * FROM facts WHERE id=?`).get(id) as Row | undefined;
    if (!row) throw new Error(`Fait introuvable: ${id}`);
    const f = toFact(row);
    if (f.status !== 'proposed') throw new Error(`Seule une proposition peut être confirmée (statut: ${f.status})`);
    const data = { ...f.data, ...patch };
    this.mustValidate(f.kind, data);
    const cur = this.currentOf(f.key);
    if (cur) this.supersede(cur.id);
    this.db
      .prepare(`UPDATE facts SET status='confirmed', data=?, origin=CASE WHEN origin='default' THEN 'user' ELSE origin END, confidence=1 WHERE id=?`)
      .run(JSON.stringify(data), id);
    return toFact(this.db.prepare(`SELECT * FROM facts WHERE id=?`).get(id) as Row);
  }

  reject(id: string): void {
    this.db.prepare(`UPDATE facts SET status='rejected', valid_to=? WHERE id=? AND status='proposed'`).run(this.now(), id);
  }

  /**
   * Retire une ligne en vigueur à la demande de l'utilisateur. Rien n'est supprimé: le fait passe à
   * "rejected" et reste dans l'historique, mais n'entre plus dans aucun calcul.
   */
  retire(key: string, why = 'Retiré par l’utilisateur'): boolean {
    const cur = this.currentOf(key);
    if (!cur) return false;
    this.db.prepare(`UPDATE facts SET status='rejected', valid_to=?, why=? WHERE id=?`).run(this.now(), why, cur.id);
    return true;
  }

  /** Correction directe par l'utilisateur : fusionne dans le fait en vigueur. */
  correct(key: string, patch: Record<string, unknown>, why: string | null = null, sourceId: string | null = null, origin: Origin = 'user'): Fact {
    const cur = this.currentOf(key);
    if (!cur) throw new Error(`Aucun fait en vigueur pour ${key}`);
    const data = { ...cur.data, ...patch };
    this.mustValidate(cur.kind, data);
    this.supersede(cur.id);
    return this.insert(
      { kind: cur.kind, key, data, status: 'confirmed', origin, confidence: origin === 'user' ? 1 : 0.6, sourceId, excerpt: null, why },
      'confirmed',
    );
  }

  /** Ajoute un fait confirmé de toutes pièces (nouvelle clé ou remplacement). */
  confirmNew(d: FactDraft): Fact {
    this.mustValidate(d.kind, d.data);
    const cur = this.currentOf(d.key);
    if (cur) this.supersede(cur.id);
    return this.insert({ ...d, confidence: 1 }, 'confirmed');
  }

  current(): Fact[] {
    const rows = this.db
      .prepare(`SELECT * FROM facts WHERE status IN ('confirmed','assumed') ORDER BY kind, key`)
      .all() as Row[];
    return rows.map(toFact);
  }

  inbox(): Fact[] {
    return (this.db.prepare(`SELECT * FROM facts WHERE status='proposed' ORDER BY recorded_at`).all() as Row[]).map(toFact);
  }

  history(key: string): Fact[] {
    return (this.db.prepare(`SELECT * FROM facts WHERE key=? ORDER BY recorded_at, rowid`).all(key) as Row[]).map(toFact);
  }

  /**
   * Évolution d'un champ au fil des corrections (par exemple le solde d'un compte mis à jour chaque mois).
   * Le registre ne supprime jamais: chaque correction est un point de la série.
   */
  series(key: string, field: string): { at: string; value: number; origin: Origin }[] {
    return this.history(key)
      .filter((f) => f.status !== 'rejected' && f.status !== 'proposed' && typeof f.data[field] === 'number')
      .map((f) => ({ at: f.validFrom, value: f.data[field] as number, origin: f.origin }));
  }

  addSource(s: Omit<Source, 'id' | 'addedAt'>): Source {
    const src: Source = { ...s, id: randomUUID(), addedAt: this.now() };
    this.db
      .prepare(`INSERT INTO sources (id,kind,name,sha256,added_at,summary,meta) VALUES (?,?,?,?,?,?,?)`)
      .run(src.id, src.kind, src.name, src.sha256, src.addedAt, src.summary, src.meta ? JSON.stringify(src.meta) : null);
    return src;
  }

  addNote(text: string, keys: string[] = []): Note {
    const n: Note = { id: randomUUID(), text, createdAt: this.now(), keys };
    this.db.prepare(`INSERT INTO notes (id,text,created_at,keys) VALUES (?,?,?,?)`).run(n.id, n.text, n.createdAt, JSON.stringify(keys));
    return n;
  }

  updateNote(id: string, text: string): void {
    this.db.prepare(`UPDATE notes SET text=? WHERE id=?`).run(text, id);
  }

  deleteNote(id: string): void {
    this.db.prepare(`DELETE FROM notes WHERE id=?`).run(id);
  }

  notes(): Note[] {
    return (this.db.prepare(`SELECT * FROM notes ORDER BY created_at`).all() as Row[]).map((r) => ({
      id: r.id as string,
      text: r.text as string,
      createdAt: r.created_at as string,
      keys: JSON.parse(r.keys as string),
    }));
  }

  hasSource(sha256: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM sources WHERE sha256=? LIMIT 1`).get(sha256));
  }

  sources(): Source[] {
    return (this.db.prepare(`SELECT * FROM sources ORDER BY added_at`).all() as Row[]).map((r) => ({
      id: r.id as string,
      kind: r.kind as Source['kind'],
      name: r.name as string,
      sha256: (r.sha256 as string | null) ?? null,
      addedAt: r.added_at as string,
      summary: (r.summary as string | null) ?? null,
      meta: r.meta ? JSON.parse(r.meta as string) : undefined,
    }));
  }

  /** Indexe le texte (déjà masqué) d'une source pour la recherche. Remplace l'index précédent de cette source. */
  indexChunks(sourceId: string, chunks: string[]): void {
    this.db.prepare(`DELETE FROM chunks WHERE source_id=?`).run(sourceId);
    const ins = this.db.prepare(`INSERT INTO chunks (text, source_id, ord) VALUES (?,?,?)`);
    chunks.forEach((c, i) => ins.run(c, sourceId, i));
  }

  /** Recherche plein texte (FTS5, classement bm25). `match` doit être une requête FTS5 déjà assainie. */
  searchChunks(match: string, limit = 8): { sourceId: string; ord: number; text: string; score: number }[] {
    if (!match.trim()) return [];
    const rows = this.db
      .prepare(`SELECT text, source_id, ord, bm25(chunks) AS score FROM chunks WHERE chunks MATCH ? ORDER BY score LIMIT ?`)
      .all(match, limit) as Row[];
    return rows.map((r) => ({ sourceId: r.source_id as string, ord: Number(r.ord), text: r.text as string, score: r.score as number }));
  }

  chunkCount(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM chunks`).get() as { n: number }).n;
  }

  /** Qui a traité cette source : une règle apprise, l'utilisateur, ou le modèle. */
  markHandled(sourceId: string, by: 'rule' | 'user' | 'llm'): void {
    this.db.prepare(`UPDATE sources SET handled_by=? WHERE id=?`).run(by, sourceId);
  }

  /** Mémorise une règle issue d'une validation ou d'une correction de l'utilisateur. */
  learn(kind: 'merchant' | 'doctype', pattern: string, mapping: Record<string, unknown>): void {
    new RegExp(pattern, 'i'); // lève si le motif est invalide
    const exists = this.db.prepare(`SELECT id FROM rules WHERE kind=? AND pattern=?`).get(kind, pattern) as Row | undefined;
    if (exists) {
      this.db.prepare(`UPDATE rules SET mapping=? WHERE id=?`).run(JSON.stringify(mapping), exists.id as string);
      return;
    }
    this.db
      .prepare(`INSERT INTO rules (id,kind,pattern,mapping,hits,created_at) VALUES (?,?,?,?,0,?)`)
      .run(randomUUID(), kind, pattern, JSON.stringify(mapping), this.now());
  }

  /** Première règle qui correspond. Compte l'usage. */
  matchRule(kind: 'merchant' | 'doctype', text: string): Record<string, unknown> | undefined {
    const rows = this.db.prepare(`SELECT * FROM rules WHERE kind=? ORDER BY hits DESC, created_at`).all(kind) as Row[];
    for (const r of rows) {
      if (new RegExp(r.pattern as string, 'i').test(text)) {
        this.db.prepare(`UPDATE rules SET hits=hits+1 WHERE id=?`).run(r.id as string);
        return JSON.parse(r.mapping as string);
      }
    }
    return undefined;
  }

  rulesCount(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM rules`).get() as { n: number }).n;
  }

  /**
   * Part des sources traitées sans modèle. C'est la mesure de l'indépendance
   * du système : elle monte à mesure que les règles apprises couvrent les cas.
   */
  autonomy(): { handled: number; byRule: number; byUser: number; byLlm: number; share: number } {
    const rows = this.db.prepare(`SELECT handled_by AS b, COUNT(*) AS n FROM sources WHERE handled_by IS NOT NULL GROUP BY handled_by`).all() as { b: string; n: number }[];
    const get = (k: string) => rows.find((r) => r.b === k)?.n ?? 0;
    const byRule = get('rule');
    const byUser = get('user');
    const byLlm = get('llm');
    const handled = byRule + byUser + byLlm;
    return { handled, byRule, byUser, byLlm, share: handled ? byRule / handled : 0 };
  }

  /** Enregistre un cours (CHF pour une unité). L'historique est conservé. */
  setPrice(symbol: string, perUnit: number, source = 'manual', at: string = this.now()): void {
    if (!Number.isFinite(perUnit) || perUnit <= 0) throw new Error('Le cours doit être un nombre positif');
    const sym = symbol.trim().toUpperCase();
    if (!/^[A-Z0-9.\-]{2,12}$/.test(sym)) throw new Error('Symbole invalide');
    this.db.prepare(`INSERT OR REPLACE INTO prices (symbol,at,per_unit,source) VALUES (?,?,?,?)`).run(sym, at, perUnit, source);
  }

  /** Dernier cours connu de chaque symbole. */
  rates(): RateTable {
    const rows = this.db
      .prepare(`SELECT symbol, per_unit, at, source FROM prices p WHERE at = (SELECT MAX(at) FROM prices WHERE symbol = p.symbol) ORDER BY symbol`)
      .all() as Row[];
    return {
      base: 'CHF',
      rates: Object.fromEntries(rows.map((r) => [r.symbol as string, { perUnit: r.per_unit as number, at: r.at as string, source: r.source as string }])),
    };
  }

  priceHistory(symbol: string): { at: string; perUnit: number; source: string }[] {
    return (this.db.prepare(`SELECT at, per_unit, source FROM prices WHERE symbol=? ORDER BY at`).all(symbol.toUpperCase()) as Row[]).map((r) => ({
      at: r.at as string, perUnit: r.per_unit as number, source: r.source as string,
    }));
  }

  getSetting(key: string): string | undefined {
    const r = this.db.prepare(`SELECT value FROM settings WHERE key=?`).get(key) as Row | undefined;
    return r ? (r.value as string) : undefined;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value);
  }

  /** Consommation de l'API: jetons et coût de chaque appel, sans contenu. */
  logUsage(u: { model: string; purpose: string; input: number; output: number; costUsd: number }): void {
    this.db.prepare(`INSERT INTO usage (id,at,model,purpose,input,output,cost_usd) VALUES (?,?,?,?,?,?,?)`).run(randomUUID(), this.now(), u.model, u.purpose, u.input, u.output, u.costUsd);
  }

  usageSince(iso: string): { calls: number; input: number; output: number; costUsd: number } {
    const r = this.db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(input),0) AS i, COALESCE(SUM(output),0) AS o, COALESCE(SUM(cost_usd),0) AS c FROM usage WHERE at >= ?`).get(iso) as Row;
    return { calls: r.n as number, input: r.i as number, output: r.o as number, costUsd: r.c as number };
  }

  /** Journal des envois. Ne contient JAMAIS le contenu envoyé: seulement sa taille et son empreinte. */
  logEgress(e: Omit<EgressEntry, 'id' | 'at'>): void {
    this.db
      .prepare(`INSERT INTO egress (id,at,destination,purpose,bytes,sha256,summary,allowed,reason) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(randomUUID(), this.now(), e.destination, e.purpose, e.bytes, e.sha256, e.summary, e.allowed ? 1 : 0, e.reason ?? null);
  }

  egressLog(limit = 50): EgressEntry[] {
    return (this.db.prepare(`SELECT * FROM egress ORDER BY at DESC, rowid DESC LIMIT ?`).all(limit) as Row[]).map((r) => ({
      id: r.id as string,
      at: r.at as string,
      destination: r.destination as string,
      purpose: r.purpose as string,
      bytes: r.bytes as number,
      sha256: r.sha256 as string,
      summary: r.summary as string,
      allowed: Boolean(r.allowed),
      reason: (r.reason as string | null) ?? undefined,
    }));
  }
}

export interface EgressEntry {
  id: string;
  at: string;
  destination: string;
  purpose: string;
  bytes: number;
  sha256: string;
  summary: string;
  allowed: boolean;
  reason?: string;
}

import type { Ring } from './engine/horizons';
import type { Snapshot } from './engine/types';
import type { GoalMarker } from './engine/goals';
import type { Gap } from './engine/gaps';
import type { Fact, Note, Source } from './core/types';

export type Db = 'demo' | 'real';
export type CaseId = 'worst' | 'base' | 'best';

let activeCase: CaseId = 'base';
export const setActiveCase = (c: CaseId) => { activeCase = c; };

export interface ScenarioView {
  id: string;
  label: string;
  summary: string;
  rings: Ring[];
  /** null = indéfiniment */
  runway: number | null;
}

export interface State {
  db: Db;
  /** Appel depuis un autre appareil via Tailscale: l'import de dossiers est alors indisponible. */
  access: { remote: boolean; login?: string };
  caseId: CaseId;
  cases: Record<CaseId, { label: string; summary: string; rings: Ring[]; runway: number | null }>;
  /** Symboles dont le cours a plus de 30 jours. */
  stale: string[];
  /** Passages indexés pour la recherche dans les documents. */
  watch: { dirs: string[]; auto: boolean; last: WatchStatus | null; running: boolean; step: string };
  budget: BudgetView;
  recurring: RecurringView;
  decomptes: Decompte[];
  fournisseurs: { re: string; name: string; category?: string }[];
  docs: { chunks: number; sources: number };
  empty: boolean;
  snapshot: Snapshot;
  rings: Ring[];
  runway: number | null;
  scenarios: ScenarioView[];
  reliability: { score: number; flows: number; stocks: number; weakest: string[] };
  goals: GoalMarker[];
  gaps: Gap[];
  inbox: Fact[];
  facts: Fact[];
  notes: Note[];
  sources: Source[];
  autonomy: { handled: number; byRule: number; byUser: number; byLlm: number; share: number; rules: number };
  llm: { provider: 'anthropic' | 'ollama' | 'off'; localOnly: boolean };
  privacy: {
    mode: 'local' | 'assisted';
    /** Mode local imposé par l'environnement: non modifiable depuis l'interface. */
    envLocked: boolean;
    consentCoach: string | null;
    consentAnalysis: string | null;
    usage: { monthChf: number; capChf: number; calls: number; inputTokens: number; outputTokens: number };
    consentMarket: string | null;
    consentDocs: string | null;
    hasKey: boolean;
    terms: { term: string; kind: 'personne' | 'employeur' | 'adresse' | 'autre'; n: number }[];
    egress: { id: string; at: string; destination: string; purpose: string; bytes: number; sha256: string; summary: string; allowed: boolean; reason?: string }[];
  };
}

export interface ManifestEntry {
  path: string;
  status: 'extracted' | 'needs_reading' | 'duplicate' | 'skipped';
  kind: string;
  redactions?: Record<string, number>;
  chars?: number;
  note?: string;
  extractedPath?: string;
  meta?: { year?: number; country?: string; type?: string };
  chunks?: number;
}

async function call<T>(method: 'GET' | 'POST', path: string, db: Db, body?: unknown): Promise<T> {
  const r = await fetch(`${path}${path.includes('?') ? '&' : '?'}db=${db}&case=${activeCase}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error ?? `Erreur ${r.status}`);
  return j as T;
}

export interface PrivacyView {
  provider: 'anthropic' | 'ollama' | 'off';
  localOnly: boolean;
  /** Texte exact transmis au modèle à chaque question du coach. */
  payload: string;
  /** Nombre de termes remplacés par des jetons dans ce texte. */
  replaced: number;
}

export interface StatementReport {
  accounts: { name: string; count: number; from: string; to: string }[];
  from: string;
  to: string;
  months: number;
  categories: { key: string; label: string; total: number; monthly: number; count: number }[];
  income: { total: number; monthly: number };
  internal: { count: number; total: number };
  recurring: { key: string; label: string; amount: number; months: number; category: string }[];
  unknown: { count: number; total: number; samples: { key: string; label: string; amount: number; count: number; total: number }[] };
  vsHorizon: { key: string; label: string; statements: number; horizon: number; gap: number }[];
  ai: { used: boolean; labels: number; costChf: number; note?: string };
}

export interface WatchStatus {
  at: string;
  read: number;
  duplicates: number;
  unreadable: number;
  proposed: number;
  transactions: number;
  statements: number;
  learned: number;
  costChf: number;
  notes: string[];
}

export interface BudgetMonth {
  month: string;
  income: number;
  spend: number;
  estimated: number;
  exceptional: number;
  saved: number;
  byCategory: Record<string, number>;
  partial: boolean;
  works: Record<string, number>;
  oneOff: number;
  moved: { year: string; category: string; amount: number }[];
  immo: Record<string, { loyers: number; charges: number }>;
}

export interface BudgetView {
  homes: string[];
  biens: { re: string; bien: string; home?: boolean; from?: string; to?: string }[];
  excluded: { key: string; label: string; date: string; amount: number }[];
  estimates: { id: string; label: string; amount: number; currency: string; per: 'month' | 'year'; category: string }[];
  accounts: { name: string; kind: 'bank' | 'card' | 'twint' | 'cash'; currency: string; count: number; from: string; to: string }[];
  months: BudgetMonth[];
  count: number;
  unknown: { count: number; total: number };
  unknownSamples: { key: string; label: string; amount: number; count: number; total: number; first: string; last: string; accounts: string[]; occurrences: { date: string; account: string; amount: number }[] }[];
  unknownMinor: { groups: number; count: number; total: number };
  currencies: string[];
}

export interface CoachReply {
  text: string;
  docsUsed: boolean;
  docsAvailable: boolean;
  docsAllowed: boolean;
  sources: { n: number; name: string; year?: number; country?: string; type?: string }[];
}

export const api = {
  privacy: (db: Db) => call<PrivacyView>('GET', '/api/privacy', db),
  state: (db: Db) => call<State>('GET', '/api/state', db),
  post: (db: Db, route: string, body: unknown) => call<State>('POST', `/api/${route}`, db, body),
  intake: (db: Db, dirs: string[]) => call<{ manifest: ManifestEntry[]; state: State }>('POST', '/api/intake', db, { dirs }),
  watchSet: (db: Db, patch: { dirs?: string[]; auto?: boolean }) => call<State>('POST', '/api/watch', db, patch),
  watchRun: (db: Db) => call<{ started: boolean; state: State }>('POST', '/api/watch/run', db, {}),
  budgetImport: (db: Db, files: { name: string; text: string }[]) => call<{ result: { added: number; skipped: number; accounts: number }; state: State }>('POST', '/api/budget/import', db, { files }),
  budgetClassify: (db: Db) => call<{ result: { labels: number; classified: number; costChf: number; note: string }; state: State }>('POST', '/api/budget/classify', db, {}),
  recurring: (db: Db, period: string) => call<RecurringView>('GET', `/api/recurring?period=${encodeURIComponent(period)}`, db),
  history: (db: Db, key: string) => call<{ versions: { at: string; status: string; origin: string; why: string | null; data: Record<string, any> }[] }>('GET', `/api/history?key=${encodeURIComponent(key)}`, db),
  analyzeStatements: (db: Db, files: { name: string; text: string }[], useAi: boolean) => call<StatementReport>('POST', '/api/statements/analyze', db, { files, useAi }),
  labelStatement: (db: Db, key: string, category: string) => call<{ ok: boolean }>('POST', '/api/statements/label', db, { key, category }),
  marketUpdate: (db: Db) => call<{ result: { updated: string[]; failed: { source: string; reason: string }[] }; state: State }>('POST', '/api/market/update', db, {}),
  coach: (db: Db, message: string, history: { role: 'user' | 'assistant'; content: string }[]) =>
    call<CoachReply>('POST', '/api/coach', db, { message, history }),
};

export const fmt = {
  pct: (x: number) => `${Math.round(x * 100)} %`,
  months: (m: number | null) => {
    if (m === null) return 'indéfiniment';
    if (m >= 24) return `${(m / 12).toFixed(1).replace('.', ',')} ans`;
    return `${m} mois`;
  },
  money: (n: number, ccy = 'CHF') => `${ccy} ${Math.round(n).toLocaleString('de-CH')}`,
};

export const RING_LABELS = ['3 mois', '1 an', '5 ans', '20 ans'];

export interface RecurringItem { key: string; label: string; category: string; bien: string | null; cadence: 'mensuel' | 'trimestriel' | 'semestriel' | 'annuel' | 'régulier'; perYear: number; perMonth: number; count: number; last: string; trend: number | null; delta: number | null; lever: boolean; lines: Line[] }
export interface Merchant { key: string; label: string; category: string; total: number; count: number; trend: number | null; delta: number | null; lines: Line[] }
export interface Line { date: string; amount: number; account: string; text: string }
export interface OneOff { label: string; date: string; amount: number; category: string; bien: string | null; text: string }
export interface CategoryMove { category: string; perYear: number; trend: number; delta: number }
export interface RecurringView { categories: CategoryMove[]; months: string[]; comparedMonths: number; income: number; recurring: RecurringItem[]; merchants: Merchant[]; oneOffs: OneOff[]; totals: { recurring: number; daily: number; exceptional: number } }

export interface Decompte { bien: string | null; from: string; to: string; total: number; lines: { label: string; amount: number }[]; solde: number | null; paid: number; settled: string | null }

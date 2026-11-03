import type { Ledger } from './ledger';
import { claude } from './usage';
import { EgressBlocked, getTerms } from './egress';
import { restoreDeep } from '../src/core/pseudonym';
import { classify, type ParsedStatement, type Tx } from './statements';
import { storeStatements } from './budget';

/**
 * Lecture d'un relevé qui n'est pas un fichier tabulaire connu (PDF, copie d'écran, photo): le texte déjà masqué est
 * envoyé à un petit modèle qui renvoie les lignes. Le résultat est contrôlé: si le relevé indique un solde d'ouverture et
 * de clôture, la somme des lignes doit coller. Sinon rien n'est enregistré, pour ne pas polluer le budget avec des lignes fausses.
 */
const CHUNK = 5_000;

const SYSTEM = `Tu lis le texte d'un relevé de compte ou de carte, déjà anonymisé (les noms et numéros sont des jetons). Le texte peut provenir d'une reconnaissance de texte et contenir des erreurs.
Réponds uniquement par un objet JSON: {"account": "nom court du compte ou de la carte", "currency": "CHF", "openingBalance": nombre ou null, "closingBalance": nombre ou null, "transactions": [{"date": "AAAA-MM-JJ", "label": "libellé", "amount": nombre, "currency": "CHF"}]}.
Règles: amount est négatif pour un débit et positif pour un crédit, en nombre pur sans apostrophe. Une ligne par opération. Ignore les soldes, totaux, reports, intérêts de période déjà inclus ailleurs et lignes d'en-tête. Si une date n'a pas d'année, déduis-la de la période du relevé. N'invente rien: ignore une ligne illisible. Accepte uniquement un relevé de compte ou de carte qui liste des opérations déjà effectuées. Refuse (réponds {"transactions": []}) un échéancier ou un avis d'acomptes d'impôts, un formulaire, une facture, un devis, un contrat ou toute liste de paiements à venir. Les lignes sont en colonnes: une ligne de relevé réunit la date, le libellé et le montant qui se trouvent sur la même ligne du texte.`;

export interface TxExtraction {
  account: string;
  currency: string;
  openingBalance: number | null;
  closingBalance: number | null;
  txs: Tx[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Une réponse coupée en cours de route (limite de longueur) reste exploitable: on récupère les lignes complètes. */
function salvage(text: string): Record<string, unknown> {
  const item = /\{\s*"date"\s*:\s*"(\d{4}-\d{2}-\d{2})"\s*,\s*"label"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"amount"\s*:\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*"currency"\s*:\s*"([A-Z]{3})")?\s*\}/g;
  const transactions = [...text.matchAll(item)].map((m) => ({ date: m[1], label: m[2].replace(/\\"/g, '"'), amount: Number(m[3]), ...(m[4] ? { currency: m[4] } : {}) }));
  const pick = (k: string): number | null => {
    const m = new RegExp(`"${k}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`).exec(text);
    return m ? Number(m[1]) : null;
  };
  const account = /"account"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text)?.[1];
  const currency = /"currency"\s*:\s*"([A-Z]{3})"/.exec(text)?.[1];
  return { account, currency, openingBalance: pick('openingBalance'), closingBalance: pick('closingBalance'), transactions };
}

export function parseTxResponse(text: string, fallbackAccount = 'Relevé importé'): TxExtraction {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const empty: TxExtraction = { account: fallbackAccount, currency: 'CHF', openingBalance: null, closingBalance: null, txs: [] };
  if (start < 0) return empty;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    raw = salvage(text.slice(start));
  }
  const account = typeof raw.account === 'string' && raw.account.trim() ? raw.account.trim().slice(0, 60) : fallbackAccount;
  const currency = typeof raw.currency === 'string' && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : 'CHF';
  const list = Array.isArray(raw.transactions) ? raw.transactions : [];
  const txs: Tx[] = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const amount = num(o.amount);
    const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null;
    if (amount === null || amount === 0 || !date || typeof o.label !== 'string') continue;
    const ccy = typeof o.currency === 'string' && /^[A-Z]{3}$/.test(o.currency) ? o.currency : currency;
    const c = classify(o.label, amount);
    txs.push({ account, date, label: o.label.trim().slice(0, 200), amount, category: c.category, source: c.source, currency: ccy });
  }
  return { account, currency, openingBalance: num(raw.openingBalance), closingBalance: num(raw.closingBalance), txs };
}

/** Vrai si la somme des lignes colle à la variation de solde, faux sinon, null si les soldes manquent. */
export function reconciles(x: TxExtraction): boolean | null {
  if (x.openingBalance === null || x.closingBalance === null) return null;
  const sum = x.txs.reduce((s, t) => s + t.amount, 0);
  const delta = x.closingBalance - x.openingBalance;
  // Un compte courant et une carte de crédit n'ont pas le même sens de solde: on accepte les deux.
  return Math.abs(sum - delta) <= 0.05 || Math.abs(sum + delta) <= 0.05;
}

/** Texte qui ressemble à un relevé: type reconnu, ou beaucoup de lignes avec une date et un montant. */
export function looksLikeStatement(text: string, type?: string): boolean {
  if (type === 'bank') return true;
  const dated = text.split('\n').filter((l) => /\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/.test(l) && /-?\d[\d'’ ]*[.,]\d{2}\b/.test(l)).length;
  return dated >= 8;
}

export type TxLlm = (system: string, user: string) => Promise<{ text: string; costChf: number }>;

const defaultLlm = (l: Ledger): TxLlm => async (system, user) => {
  const r = await claude(l, {
    purpose: 'analysis',
    model: process.env.HORIZON_ANALYSIS_MODEL ?? 'claude-haiku-5-5',
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 6000,
    summary: 'Lecture d’un relevé masqué pour en tirer les lignes',
  });
  return { text: r.text, costChf: r.costChf };
};

export interface TxResult {
  stored: number;
  skipped: number;
  lines: number;
  reconciled: boolean | null;
  costChf: number;
  note: string;
}

/** Découpe par lignes entières, au plus CHUNK caractères par morceau. */
function chunks(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (cur.length + line.length + 1 > CHUNK && cur) {
      out.push(cur);
      cur = '';
    }
    cur += `${line}\n`;
  }
  if (cur.trim()) out.push(cur);
  return out.slice(0, 8);
}

export async function extractTransactions(l: Ledger, text: string, file = '', llm: TxLlm = defaultLlm(l)): Promise<TxResult> {
  const result: TxResult = { stored: 0, skipped: 0, lines: 0, reconciled: null, costChf: 0, note: '' };
  try {
    const parts: TxExtraction[] = [];
    for (const c of chunks(text)) {
      const r = await llm(SYSTEM, c);
      result.costChf += r.costChf;
      parts.push(parseTxResponse(r.text));
    }
    const first = parts.find((p) => p.txs.length > 0) ?? parts[0];
    if (!first || parts.every((p) => p.txs.length === 0)) return { ...result, note: 'Aucune ligne reconnue.' };
    const merged: TxExtraction = {
      account: first.account,
      currency: first.currency,
      openingBalance: parts.find((p) => p.openingBalance !== null)?.openingBalance ?? null,
      closingBalance: [...parts].reverse().find((p) => p.closingBalance !== null)?.closingBalance ?? null,
      txs: parts.flatMap((p) => p.txs).map((t) => ({ ...t, account: first.account })),
    };
    result.lines = merged.txs.length;
    result.reconciled = reconciles(merged);
    if (result.reconciled === false) return { ...result, note: `Relevé non réconcilié: la somme des ${merged.txs.length} lignes ne colle pas aux soldes. Rien n'est enregistré, à vérifier.` };
    const terms = getTerms(l);
    const parsed: ParsedStatement = restoreDeep({ account: merged.account, txs: merged.txs }, terms);
    const s = storeStatements(l, [parsed], file);
    return { ...result, stored: s.added, skipped: s.skipped, note: `${s.added} ligne${s.added > 1 ? 's' : ''} ajoutée${s.added > 1 ? 's' : ''}${result.reconciled ? ', soldes vérifiés' : ', soldes non vérifiables'}.` };
  } catch (e) {
    if (e instanceof EgressBlocked) return { ...result, note: e.reason };
    return { ...result, note: e instanceof Error ? e.message : String(e) };
  }
}

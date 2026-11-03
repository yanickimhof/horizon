import { createHash } from 'node:crypto';
import type { Ledger } from './ledger';
import { applySignatures, classify, isGenericPayee, normalizeLabel, pairInternalTransfers, payeeKey, signatureKey, type ParsedStatement, type Tx } from './statements';
import { redact } from '../src/core/redact';
import { getTerms } from './egress';
import { rateFor } from '../src/engine/fx';

/**
 * Budget réel: une base de transactions qui s'enrichit à chaque import. Chaque ligne n'est enregistrée qu'une fois,
 * même si deux exports se recouvrent. Les virements entre tes comptes et les doublons (détail d'une carte déjà prélevé
 * sur le compte) ne comptent pas comme dépenses. Tout reste sur l'ordinateur.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS budget_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  currency TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS budget_txs (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  source TEXT NOT NULL,
  file TEXT,
  added_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS budget_txs_date ON budget_txs(date);
CREATE TABLE IF NOT EXISTS budget_estimates (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  per TEXT NOT NULL,
  category TEXT NOT NULL
);
`;

const ready = new WeakSet<object>();
export function ensureBudget(l: Ledger): void {
  init(l);
}

function init(l: Ledger): void {
  if (ready.has(l)) return;
  l.raw.exec(SCHEMA);
  try {
    l.raw.exec('ALTER TABLE budget_txs ADD COLUMN bien TEXT');
  } catch {
    // la colonne existe déjà
  }
  ready.add(l);
}

export type AccountKind = 'bank' | 'card' | 'twint' | 'cash';

export function kindOf(name: string): AccountKind {
  if (/twint/i.test(name)) return 'twint';
  if (/esp[èe]ces|cash|caisse/i.test(name)) return 'cash';
  if (/carte|visa|mastercard|cembra|viseca|amex|credit card|cornèr/i.test(name)) return 'card';
  return 'bank';
}

interface Row {
  bien?: string | null;
  id: string;
  account: string;
  date: string;
  amount: number;
  currency: string;
  label: string;
  category: string;
  source: string;
}

const sha = (s: string) => createHash('sha1').update(s).digest('hex');

export interface StoreResult {
  added: number;
  skipped: number;
  accounts: number;
}

/** Enregistre les lignes d'un ou plusieurs relevés. Une ligne déjà connue (même compte, date, montant, libellé) est ignorée. */
export function storeStatements(l: Ledger, parsed: ParsedStatement[], file = ''): StoreResult {
  init(l);
  const now = new Date().toISOString();
  const insAcc = l.raw.prepare('INSERT OR IGNORE INTO budget_accounts (id, name, kind, currency) VALUES (?,?,?,?)');
  const insTx = l.raw.prepare('INSERT OR IGNORE INTO budget_txs (id, account, date, amount, currency, label, category, source, file, added_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  let added = 0;
  let skipped = 0;
  const accounts = new Set<string>();
  for (const s of parsed) {
    if (s.txs.length === 0) continue;
    accounts.add(s.account);
    const ccy = s.txs[0].currency ?? 'CHF';
    insAcc.run(s.account, s.account, kindOf(s.account), ccy);
    const seen = new Map<string, number>();
    for (const t of s.txs) {
      const label = redact(t.label).text;
      const base = `${t.account}|${t.date}|${t.amount.toFixed(2)}|${label}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const r = insTx.run(sha(`${base}#${n}`), t.account, t.date, t.amount, t.currency ?? ccy, label, t.category, t.source, file, now);
      if (Number(r.changes) > 0) added++;
      else skipped++;
    }
  }
  reclassify(l);
  return { added, skipped, accounts: accounts.size };
}

const signatures = (l: Ledger): Record<string, string> => {
  try {
    return JSON.parse(l.getSetting('statements.signatures') ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
};

const norm = (s: string): string => s.toLowerCase().replace(/[\s'’.-]+/g, '');

/** Prénoms des adultes et des enfants du foyer, d'après la fiche foyer. Sert à reconnaître un virement vers soi ou vers un enfant. */
/** Le prénom doit être un mot entier: « Léa » n'est pas dans « Léane ». */
function hasName(head: string, name: string): boolean {
  let i = head.indexOf(name);
  while (i >= 0) {
    const next = head[i + name.length] ?? '';
    const prev = head[i - 1] ?? '';
    if (!/[a-zà-ÿ]/.test(next) && !/[a-zà-ÿ]/.test(prev)) return true;
    i = head.indexOf(name, i + 1);
  }
  return false;
}

function household(l: Ledger): { adults: string[]; children: string[] } {
  const f = l.current().find((x) => x.key === 'household');
  const members = Array.isArray(f?.data.members) ? (f?.data.members as { name?: unknown; role?: unknown }[]) : [];
  const names = (child: boolean) => members.filter((m) => (m.role === 'child') === child && typeof m.name === 'string' && m.name.trim().length >= 3).map((m) => norm(String(m.name)));
  return { adults: names(false), children: names(true) };
}

const dayNumber = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/**
 * Un même compte lu deux fois (export CSV et PDF du même relevé) donne des lignes en double. Quand la plupart des lignes
 * d'un compte retrouvent une ligne de même montant, à trois jours près, dans un compte plus fourni, ce compte est un doublon.
 * La ligne gardée reçoit le libellé le plus complet des deux (un export dit « Paiement », l'autre nomme le bénéficiaire).
 */
function markDuplicateAccounts(txs: (Tx & { id: string })[]): (Tx & { id: string })[] {
  const upgraded: (Tx & { id: string })[] = [];
  const byAcc = new Map<string, (Tx & { id: string })[]>();
  for (const t of txs) byAcc.set(t.account, [...(byAcc.get(t.account) ?? []), t]);
  const accs = [...byAcc.values()].sort((a, b) => b.length - a.length);
  for (let i = 0; i < accs.length; i++) {
    for (let j = i + 1; j < accs.length; j++) {
      const A = accs[i].filter((t) => t.category !== 'doublon');
      const B = accs[j];
      if (A.length === 0) continue;
      const from = A.reduce((m, t) => (t.date < m ? t.date : m), '9999-99-99');
      const to = A.reduce((m, t) => (t.date > m ? t.date : m), '0000-00-00');
      const inRange = B.filter((t) => t.category !== 'doublon' && t.date >= from && t.date <= to);
      if (inRange.length < 5) continue;
      const pool = new Map<string, { d: number; t: Tx & { id: string } }[]>();
      for (const a of A) pool.set(a.amount.toFixed(2), [...(pool.get(a.amount.toFixed(2)) ?? []), { d: dayNumber(a.date), t: a }]);
      const pairs: [Tx & { id: string }, Tx & { id: string }][] = [];
      for (const b of inRange) {
        const list = pool.get(b.amount.toFixed(2));
        const d = dayNumber(b.date);
        const k = list ? list.findIndex((x) => Math.abs(x.d - d) <= 3) : -1;
        if (list && k >= 0) {
          pairs.push([list[k].t, b]);
          list.splice(k, 1);
        }
      }
      if (pairs.length >= 5 && pairs.length / inRange.length >= 0.6) {
        for (const b of inRange) {
          b.category = 'doublon';
          b.source = 'paire';
        }
        for (const [a, b] of pairs) {
          if (a.label.trim().length < 25 && b.label.trim().length > a.label.trim().length + 10) {
            a.label = b.label;
            upgraded.push(a);
          }
        }
      }
    }
  }
  return upgraded;
}

/** Émetteur d'un crédit: le nom avant la première virgule (employeur, régie, assurance). */
const payerOf = (label: string): string => normalizeLabel(label.split(',')[0]).slice(0, 30);

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Détection automatique des revenus exceptionnels, sans rien demander: un versement très au-dessus de ce que verse
 * d'habitude le même émetteur (trois fois sa médiane, trois versements ou plus), ou un gros versement unique (5 000 et plus)
 * d'un émetteur qui ne verse presque jamais. Un classement de l'utilisateur l'emporte toujours.
 */
function flagExceptionalIncome(txs: (Tx & { id: string })[]): void {
  // Un salaire, un loyer, une rente ou une indemnité de chômage arrive parfois en retard ou en plusieurs fois: ce n'est pas exceptionnel.
  const REGULAR = /salaire|loyer|rente|ch[ôo]mage|indemnit[ée]|disponible/i;
  const credits = txs.filter((t) => t.category === 'revenu' && t.amount > 0);
  const byPayer = new Map<string, (Tx & { id: string })[]>();
  for (const t of credits) byPayer.set(payerOf(t.label), [...(byPayer.get(payerOf(t.label)) ?? []), t]);
  for (const list of byPayer.values()) {
    // Total reçu de cet émetteur, mois par mois: un mois est exceptionnel s'il dépasse trois fois le mois habituel.
    const months = new Map<string, number>();
    for (const t of list) months.set(t.date.slice(0, 7), (months.get(t.date.slice(0, 7)) ?? 0) + t.amount);
    const med = median([...months.values()]);
    const history = months.size >= 3;
    for (const t of list) {
      if (t.source === 'memoire' || t.source === 'ia' || t.source === 'banque') continue;
      const monthSum = months.get(t.date.slice(0, 7)) ?? t.amount;
      // Sans historique (trois mois), seul un très gros versement qui ne ressemble pas à un revenu courant est mis à part.
      const odd = history ? monthSum >= Math.max(3000, 3 * med) && t.amount >= 0.4 * monthSum : t.amount >= 20_000 && !REGULAR.test(t.label);
      if (odd) {
        t.category = 'exceptionnel';
        t.source = 'regle';
      }
    }
  }
}

/** Reprend le classement de toutes les lignes: virements entre comptes, virements vers soi, mémoire de l'utilisateur. */
export function reclassify(l: Ledger): number {
  init(l);
  const rows = l.raw.prepare('SELECT id, account, date, amount, currency, label, category, source FROM budget_txs').all() as unknown as Row[];
  const txs: (Tx & { id: string })[] = rows.map((r) => ({ id: r.id, account: r.account, date: r.date, label: r.label, amount: r.amount, category: r.category, source: r.source as Tx['source'], currency: r.currency }));
  const before = new Map(txs.map((t) => [t.id, `${t.category}|${t.source}|${t.label}`]));
  const home = household(l);
  for (const t of txs) {
    if (t.source === 'memoire' || t.source === 'ia' || t.source === 'banque') continue;
    // Les règles s'améliorent: les lignes classées par règle sont recalculées à chaque import.
    const c = classify(t.label, t.amount);
    t.category = c.category;
    t.source = c.source;
    // Un virement dont le bénéficiaire est un adulte du foyer reste dans la famille: ce n'est pas une dépense.
    // Un virement vers un enfant (loyer, argent de poche) en est une.
    const head = norm(t.label.slice(0, 90));
    if (home.children.some((c) => hasName(t.label.slice(0, 90).toLowerCase(), c) || (c.length > 6 && head.includes(c)))) {
      if (t.amount < 0 && t.category !== 'interne') {
        t.category = 'famille';
        t.source = 'paire';
      }
    } else if (home.adults.some((a) => head.includes(a)) && !/int[ée]r[êe]ts?|hypoth|amortis|leasing|belastung/i.test(t.label)) {
      t.category = 'interne';
      t.source = 'paire';
    }
  }
  for (const t of markDuplicateAccounts(txs)) {
    if (t.source === 'memoire' || t.source === 'ia' || t.source === 'banque') continue;
    const c = classify(t.label, t.amount);
    t.category = c.category;
    t.source = c.source;
  }
  const live = txs.filter((t) => t.category !== 'doublon');
  pairInternalTransfers(live);
  applySignatures(live, signatures(l));
  flagExceptionalIncome(live);
  const upd = l.raw.prepare('UPDATE budget_txs SET category = ?, source = ?, label = ? WHERE id = ?');
  let changed = 0;
  for (const t of txs) {
    if (before.get(t.id) !== `${t.category}|${t.source}|${t.label}`) {
      upd.run(t.category, t.source, t.label, t.id);
      changed++;
    }
  }
  tagBiens(l);
  return changed;
}

/**
 * Le bien (domicile, studio, appartement loué...) d'une dépense d'immobilier, d'après des règles que l'utilisateur a données:
 * réglage « budget.biens », liste de { re, bien, from?, to? } (dates facultatives, pour un même fournisseur qui change de bien).
 * La première règle qui reconnaît le libellé gagne.
 */
export interface BienRule { re: string; bien: string; home?: boolean; from?: string; to?: string }

export function getBiens(l: Ledger): BienRule[] {
  try {
    return JSON.parse(l.getSetting('budget.biens') || '[]');
  } catch {
    return [];
  }
}

/** Enregistre les règles de biens (depuis l'écran), puis rattache de nouveau toutes les lignes. */
export function setBiens(l: Ledger, rules: BienRule[]): void {
  init(l);
  const clean: BienRule[] = [];
  for (const r of rules) {
    const re = String(r.re ?? '').trim();
    const bien = String(r.bien ?? '').trim();
    if (!re || !bien) continue;
    try {
      new RegExp(re, 'i');
    } catch {
      throw new Error(`Motif invalide: ${re}`);
    }
    const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
    clean.push({ re, bien, ...(r.home ? { home: true } : {}), ...(date(r.from) ? { from: date(r.from) } : {}), ...(date(r.to) ? { to: date(r.to) } : {}) });
  }
  l.setSetting('budget.biens', JSON.stringify(clean));
  l.raw.exec('UPDATE budget_txs SET bien = NULL');
  tagBiens(l);
}

function tagBiens(l: Ledger): void {
  let rules: { re: string; bien: string; from?: string; to?: string }[] = [];
  try {
    rules = JSON.parse(l.getSetting('budget.biens') || '[]');
  } catch {
    return;
  }
  if (rules.length === 0) return;
  const rows = l.raw.prepare("SELECT id, date, label, bien FROM budget_txs WHERE category IN ('travaux','logement','revenu')").all() as unknown as { id: string; date: string; label: string; bien: string | null }[];
  const upd = l.raw.prepare('UPDATE budget_txs SET bien = ? WHERE id = ?');
  for (const r of rows) {
    const hit = rules.find((x) => new RegExp(x.re, 'i').test(r.label) && (!x.from || r.date >= x.from) && (!x.to || r.date <= x.to));
    if (hit && r.bien !== hit.bien) upd.run(hit.bien, r.id);
  }
}

/** Mémorise un classement pour toutes les lignes de même libellé et même montant, passées et futures. */
export function labelTransactions(l: Ledger, key: string, category: string, scope: 'exact' | 'payee' = 'exact'): number {
  init(l);
  const rows = l.raw.prepare('SELECT id, label, amount FROM budget_txs').all() as unknown as Pick<Row, 'id' | 'label' | 'amount'>[];
  const upd = l.raw.prepare("UPDATE budget_txs SET category = ?, source = 'memoire' WHERE id = ?");
  const first = rows.find((r) => signatureKey(r.label, r.amount) === key);
  // Par émetteur: tous les montants du même émetteur, passés et futurs (un loyer, un employeur, un commerçant). Pas pour un libellé générique.
  const byPayee = scope === 'payee' && first !== undefined && !isGenericPayee(first.label);
  const memoryKey = byPayee && first ? payeeKey(first.label) : key;
  l.setSetting('statements.signatures', JSON.stringify({ ...signatures(l), [memoryKey]: category }));
  let n = 0;
  for (const r of rows) {
    const hit = byPayee && first ? payeeKey(r.label) === memoryKey : signatureKey(r.label, r.amount) === key;
    if (hit) {
      upd.run(category, r.id);
      n++;
    }
  }
  return n;
}

export interface BudgetMonth {
  month: string;
  income: number;
  spend: number;
  /** Part de la dépense qui vient d'estimations déclarées, hors relevés. */
  estimated: number;
  /** Versements uniques reçus ce mois (indemnité, vente): comptés à part, pas dans le revenu régulier. */
  exceptional: number;
  /** Argent mis de côté ce mois (épargne, 3e pilier, parts sociales): sorti du compte, mais pas dépensé. */
  saved: number;
  byCategory: Record<string, number>;
  /** Mois en cours ou incomplet: à lire avec prudence. */
  partial: boolean;
  /** Travaux du mois par bien. */
  works: Record<string, number>;
  /** Dépenses ponctuelles désignées par l'utilisateur (solde d'impôts, remboursement), hors rythme habituel. */
  oneOff: number;
  /** Dépenses payées ce mois mais qui appartiennent à une autre année (solde d'impôts de l'année précédente). */
  moved: { year: string; category: string; amount: number }[];
  /** Immobilier du mois par bien: loyers reçus et charges payées (intérêts, charges PPE, travaux). */
  immo: Record<string, { loyers: number; charges: number }>;
}

export interface Estimate {
  id: string;
  label: string;
  amount: number;
  currency: string;
  per: 'month' | 'year';
  category: string;
}

export interface BudgetView {
  /** Règles de biens saisies par l'utilisateur. */
  biens: BienRule[];
  /** Biens désignés comme domicile (leurs charges ne sont pas comparées à des loyers). */
  homes: string[];
  /** Versements uniques écartés du revenu mensuel (indemnité, vente...), pour que l'utilisateur voie ce qui n'est pas compté. */
  excluded: { key: string; label: string; date: string; amount: number }[];
  estimates: Estimate[];
  accounts: { name: string; kind: AccountKind; currency: string; count: number; from: string; to: string }[];
  months: BudgetMonth[];
  count: number;
  unknown: { count: number; total: number };
  /** Les lignes inconnues les plus lourdes, regroupées par libellé et montant, pour que l'utilisateur les classe. */
  unknownSamples: { key: string; label: string; amount: number; count: number; total: number; first: string; last: string; accounts: string[]; occurrences: { date: string; account: string; amount: number }[] }[];
  /** Petites lignes inconnues (moins de 30 francs au total par libellé): elles n'ont pas besoin d'être identifiées une à une. */
  unknownMinor: { groups: number; count: number; total: number };
  currencies: string[];
}

/** Catégories qui ne sont pas des dépenses du ménage. */
const NOT_SPEND = new Set(['interne', 'epargne', 'revenu', 'exceptionnel', 'doublon']);

export function budgetView(l: Ledger, now: Date = new Date(), monthsBack = 13): BudgetView {
  init(l);
  const rows = l.raw.prepare('SELECT account, date, amount, currency, label, category, bien FROM budget_txs').all() as unknown as Row[];
  const kinds = new Map((l.raw.prepare('SELECT name, kind, currency FROM budget_accounts').all() as { name: string; kind: AccountKind; currency: string }[]).map((a) => [a.name, a]));
  const rates = l.rates();
  type Rule = { re?: string; date?: string; from?: string; to?: string; min?: number; annee?: string };
  const readRules = (key: string): Rule[] => {
    try {
      return JSON.parse(l.getSetting(key) || '[]') as Rule[];
    } catch {
      return [];
    }
  };
  const homes = (() => {
    try {
      return (JSON.parse(l.getSetting('budget.biens') || '[]') as { bien: string; home?: boolean }[]).filter((x) => x.home).map((x) => x.bien);
    } catch {
      return [];
    }
  })();
  const uniques = readRules('budget.uniques');
  const imputations = readRules('budget.imputation');
  const hits = (x: Rule, r: Row): boolean => (!x.re || new RegExp(x.re, 'i').test(r.label)) && (!x.date || r.date === x.date) && (!x.from || r.date >= x.from) && (!x.to || r.date <= x.to) && (x.min === undefined || Math.abs(r.amount) >= x.min);
  const toChf = (n: number, ccy: string) => (ccy === 'CHF' ? n : n * (rateFor(rates, ccy)?.perUnit ?? 1));

  const accounts = [...kinds.values()].map((a) => {
    const mine = rows.filter((r) => r.account === a.name);
    return { name: a.name, kind: a.kind, currency: a.currency, count: mine.length, from: mine.reduce((m, r) => (r.date < m ? r.date : m), '9999-99-99'), to: mine.reduce((m, r) => (r.date > m ? r.date : m), '0000-00-00') };
  });

  // Un mois où le détail d'une carte est présent: son prélèvement sur le compte ne compte pas deux fois.
  const cardMonths = new Set(rows.filter((r) => kinds.get(r.account)?.kind === 'card').map((r) => r.date.slice(0, 7)));

  // Un même émetteur (régie) verse parfois bien par bien, parfois en bloc: la répartition connue du dernier mois détaillé sert à répartir les versements en bloc.
  const rentShares = (() => {
    const perPayer = new Map<string, Map<string, Record<string, number>>>();
    for (const r of rows) {
      if (r.category !== 'revenu' || r.amount <= 0 || !r.bien) continue;
      const pk = payeeKey(r.label);
      const months = perPayer.get(pk) ?? new Map<string, Record<string, number>>();
      const m = months.get(r.date.slice(0, 7)) ?? {};
      m[r.bien] = (m[r.bien] ?? 0) + toChf(r.amount, r.currency);
      months.set(r.date.slice(0, 7), m);
      perPayer.set(pk, months);
    }
    const out = new Map<string, { ratios: Record<string, number>; amounts: Record<string, number> }>();
    for (const [pk, months] of perPayer) {
      const detailed = [...months.entries()].filter(([, v]) => Object.keys(v).length >= 2).sort((a, b) => b[0].localeCompare(a[0]))[0];
      if (!detailed) continue;
      const total = Object.values(detailed[1]).reduce((t, v) => t + v, 0);
      out.set(pk, { ratios: Object.fromEntries(Object.entries(detailed[1]).map(([k, v]) => [k, v / total])), amounts: detailed[1] });
    }
    return out;
  })();
  const currentMonth = now.toISOString().slice(0, 7);
  const byMonth = new Map<string, BudgetMonth>();
  let unknownCount = 0;
  let unknownTotal = 0;
  type Unk = { key: string; label: string; amount: number; count: number; total: number; first: string; last: string; accounts: Set<string>; occurrences: { date: string; account: string; amount: number }[] };
  const unk = new Map<string, Unk>();
  // Les petites lignes inconnues (moins de 30 francs par libellé) comptent comme « Autre »: inutile de les demander.
  const unkTotals = new Map<string, number>();
  for (const r of rows) {
    if (r.category === 'inconnu' && r.amount < 0) unkTotals.set(signatureKey(r.label, r.amount), (unkTotals.get(signatureKey(r.label, r.amount)) ?? 0) - toChf(r.amount, r.currency));
  }
  for (const r of rows) {
    const m = r.date.slice(0, 7);
    const e = byMonth.get(m) ?? { month: m, income: 0, spend: 0, estimated: 0, exceptional: 0, saved: 0, byCategory: {}, partial: m >= currentMonth, works: {}, oneOff: 0, moved: [], immo: {} };
    const chf = toChf(r.amount, r.currency);
    if (r.bien) {
      const b = (e.immo[r.bien] = e.immo[r.bien] ?? { loyers: 0, charges: 0 });
      if ((r.category === 'logement' || r.category === 'travaux') && chf < 0) b.charges += -chf;
      if (r.category === 'revenu' && chf > 0) b.loyers += chf;
    } else if (r.category === 'revenu' && chf > 0 && /loyer|g[ée]rance|r[ée]gie|immobili|versement disponible|mietzins|verwaltung/i.test(r.label)) {
      // Un loyer reçu d'une régie: réparti selon ses versements détaillés, sinon compté à part tant qu'aucun bien n'est désigné.
      const shares = rentShares.get(payeeKey(r.label));
      // On ne répartit qu'un versement qui vaut un ou plusieurs mois de loyers complets; un solde ou une régularisation reste à rattacher.
      const monthly = shares ? Object.values(shares.amounts).reduce((t, v) => t + v, 0) : 0;
      const multiple = monthly > 0 && Math.abs(chf / monthly - Math.round(chf / monthly)) < 0.02;
      if (shares && multiple) {
        for (const [bien, part] of Object.entries(shares.ratios)) {
          const b = (e.immo[bien] = e.immo[bien] ?? { loyers: 0, charges: 0 });
          b.loyers += chf * part;
        }
      } else {
        const b = (e.immo['Non réparti'] = e.immo['Non réparti'] ?? { loyers: 0, charges: 0 });
        b.loyers += chf;
      }
    }
    const minorUnknown = r.category === 'inconnu' && r.amount < 0 && (unkTotals.get(signatureKey(r.label, r.amount)) ?? 0) < 30;
    if (minorUnknown) {
      e.spend += -chf;
      e.byCategory.autre = (e.byCategory.autre ?? 0) - chf;
    } else if (r.category === 'revenu' && chf > 0) e.income += chf;
    else if (r.category === 'exceptionnel' && chf > 0) e.exceptional += chf;
    else if (r.category === 'epargne' && chf < 0) e.saved += -chf;
    else if (!NOT_SPEND.has(r.category)) {
      const isCardDebit = r.category === 'carte' && cardMonths.has(m);
      if (!isCardDebit) {
        e.spend += -chf;
        e.byCategory[r.category] = (e.byCategory[r.category] ?? 0) - chf;
        if (r.category === 'travaux') e.works[r.bien ?? 'À préciser'] = (e.works[r.bien ?? 'À préciser'] ?? 0) - chf;
        if (uniques.some((x) => hits(x, r))) e.oneOff += -chf;
        const imp = imputations.find((x) => x.annee && hits(x, r));
        if (imp?.annee) e.moved.push({ year: imp.annee, category: r.category, amount: -chf });
        if (r.category === 'inconnu' && chf < 0) {
          unknownCount++;
          unknownTotal += -chf;
          const k = signatureKey(r.label, r.amount);
          const u = unk.get(k) ?? { key: k, label: r.label, amount: -r.amount, count: 0, total: 0, first: r.date, last: r.date, accounts: new Set<string>(), occurrences: [] };
          u.count++;
          u.total += -chf;
          if (r.date < u.first) u.first = r.date;
          if (r.date > u.last) u.last = r.date;
          u.accounts.add(r.account);
          if (u.occurrences.length < 6) u.occurrences.push({ date: r.date, account: r.account, amount: -chf });
          unk.set(k, u);
        }
      }
    }
    byMonth.set(m, e);
  }
  // Dépenses connues hors relevés (carte perdue, espèces): ajoutées à chaque mois, sauf si une ligne réelle les couvre déjà.
  const estimates = (l.raw.prepare('SELECT id, label, amount, currency, per, category FROM budget_estimates').all() as unknown as Estimate[]);
  for (const est of estimates) {
    const token = (est.label.toLowerCase().split(/\s+/).find((w) => w.length >= 4) ?? est.label.toLowerCase()).trim();
    const monthly = toChf(est.per === 'year' ? est.amount / 12 : est.amount, est.currency);
    for (const e of byMonth.values()) {
      const covered = rows.some((r) => r.date.startsWith(e.month) && r.label.toLowerCase().includes(token));
      if (covered) continue;
      e.spend += monthly;
      e.estimated += monthly;
      e.byCategory[est.category] = (e.byCategory[est.category] ?? 0) + monthly;
    }
  }
  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-monthsBack);
  const MINOR = 30;
  const allUnknown = [...unk.values()].sort((a, b) => b.total - a.total);
  const major = allUnknown.filter((u) => u.total >= MINOR).slice(0, 12);
  const minor = allUnknown.filter((u) => !major.includes(u));
  const unknownSamples = major.map((u) => ({ key: u.key, label: u.label, amount: u.amount, count: u.count, total: u.total, first: u.first, last: u.last, accounts: [...u.accounts], occurrences: u.occurrences }));
  const unknownMinor = { groups: minor.length, count: minor.reduce((s, u) => s + u.count, 0), total: minor.reduce((s, u) => s + u.total, 0) };
  const excluded = rows
    .filter((r) => r.category === 'exceptionnel' && r.amount > 0)
    .map((r) => ({ key: signatureKey(r.label, r.amount), label: r.label, date: r.date, amount: toChf(r.amount, r.currency) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);
  return { biens: getBiens(l), homes, unknownMinor, excluded, estimates, accounts, months, count: rows.length, unknown: { count: unknownCount, total: unknownTotal }, unknownSamples, currencies: [...new Set(rows.map((r) => r.currency))].sort() };
}

const CATEGORY_OK = (c: string): boolean => /^[a-z]{3,20}$/.test(c);

export function addEstimate(l: Ledger, e: Omit<Estimate, 'id'>): void {
  init(l);
  if (!e.label.trim() || !(e.amount > 0) || !CATEGORY_OK(e.category) || !/^[A-Z]{3}$/.test(e.currency) || (e.per !== 'month' && e.per !== 'year')) throw new Error('Estimation invalide.');
  l.raw.prepare('INSERT INTO budget_estimates (id, label, amount, currency, per, category) VALUES (?,?,?,?,?,?)').run(sha(`${e.label}|${Date.now()}`), e.label.trim().slice(0, 80), e.amount, e.currency, e.per, e.category);
}

export function removeEstimate(l: Ledger, id: string): void {
  init(l);
  l.raw.prepare('DELETE FROM budget_estimates WHERE id = ?').run(id);
}

/** Range dans « Autre » les petites lignes inconnues (moins de 30 francs au total par libellé), pour ne garder à identifier que l'important. */
export function setMinorUnknownToOther(l: Ledger, thresholdChf = 30): number {
  init(l);
  const rows = l.raw.prepare("SELECT id, label, amount, currency FROM budget_txs WHERE category = 'inconnu' AND amount < 0").all() as unknown as Pick<Row, 'id' | 'label' | 'amount' | 'currency'>[];
  const rates = l.rates();
  const groups = new Map<string, { ids: string[]; total: number }>();
  for (const r of rows) {
    const k = signatureKey(r.label, r.amount);
    const g = groups.get(k) ?? { ids: [], total: 0 };
    g.ids.push(r.id);
    g.total += -(r.currency === 'CHF' ? r.amount : r.amount * (rateFor(rates, r.currency)?.perUnit ?? 1));
    groups.set(k, g);
  }
  const upd = l.raw.prepare("UPDATE budget_txs SET category = 'autre', source = 'memoire' WHERE id = ?");
  let n = 0;
  for (const g of groups.values()) if (g.total < thresholdChf) for (const id of g.ids) { upd.run(id); n++; }
  return n;
}

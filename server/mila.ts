import { init } from './budget';
import type { Ledger } from './ledger';

/** Une règle de repérage des frais liés à Mila payés par la famille (loyer, école, repas sur place, argent de poche, virements). */
export interface MilaRule {
  kind: 'loyer' | 'ecole' | 'nourriture' | 'virement' | 'poche';
  re: string;
  /** Catégories acceptées (vide: toutes). */
  categories?: string[];
  from?: string;
}

/** La comptabilité de Mila commence le 17 août 2026; avant, seules les dépenses clairement liées au CPNV comptent. */
export const MILA_START = '2026-08-17';
const WIDE_START = '2025-01-01';
/** Arrivée sur place: les moyennes mensuelles se calculent depuis ce mois. */
export const MILA_SITE_MONTH = '2026-09';
/** Début du relevé de son compte Migros: les virements de la famille à partir de cette date sont du financement, pas un coût de plus. */
/** Solde de son compte au 1er août 2026, d'après le relevé. */
export const MILA_SOLDE_INITIAL = 35.76;
export const MILA_ACCOUNT_START = '2026-08-01';

export const DEFAULT_MILA_RULES: MilaRule[] = [
  // Clairement pour le CPNV: compté même avant le 17 août (fournitures, frais d'école).
  { kind: 'ecole', re: 'cpnv|cataropro', categories: ['enfants', 'quotidien'] },
  { kind: 'ecole', re: 'payot', categories: ['enfants'] },
  // Le reste commence le 17 août.
  { kind: 'ecole', re: 'payot', categories: ['quotidien'], from: MILA_START },
  { kind: 'loyer', re: 'balcon du jura', categories: ['enfants'], from: MILA_START },
  { kind: 'poche', re: '^mila imhof, all', from: MILA_START },
  { kind: 'virement', re: 'transfert mila', from: MILA_START },
  { kind: 'nourriture', re: 'ste-croix|sainte-croix|yverdon', categories: ['alimentation', 'restaurants'], from: MILA_START },
];

/** Catégories des écritures du compte de Mila, d'après le libellé (la première qui correspond gagne). */
const ACCOUNT_RULES: { cat: string; label: string; re: string }[] = [
  { cat: 'versement', label: 'Versements de la famille', re: 'transfert imhof' },
  { cat: 'ecole', label: 'École', re: 'cpnv|centre professionnel|payot|cataro' },
  { cat: 'transport', label: 'Transports', re: 'fairtiq|cff|sbb|tl ' },
  { cat: 'sante', label: 'Pharmacie', re: 'pharmacie' },
  { cat: 'vetements', label: 'Vêtements', re: 'zebra|h&m|zara|c&a' },
  { cat: 'restaurants', label: 'Restaurants et fast-food', re: 'burger king|mcdonald|sushi|kawa|mac42|intrigo|panetier|boulang|pizz|kebab' },
  { cat: 'twint', label: 'Twint entre amis', re: 'twint' },
  { cat: 'alimentation', label: 'Courses et snacks', re: 'coop|migros|denner|volg|spar|aldi|lidl' },
];
const AUTRE = 'Autres achats';
/** Dans son compte, seuls comptent les achats à Yverdon et Ste-Croix, et ce qui est clairement pour le CPNV. */
const ON_SITE = 'ste-croi|sainte-croix|yverdon|denner satellit|coop pronto 3650|pharmacie|cpnv|centre professionnel';

export interface MilaLine {
  key: string;
  label: string;
  /** Total depuis le début de la période suivie. */
  total: number;
  /** Moyenne par mois plein depuis l'arrivée sur place (septembre 2026). */
  perMonth: number;
  count: number;
}

export interface MilaView {
  from: string;
  siteFrom: string;
  /** Mois pleins pris en compte pour les moyennes. */
  fullMonths: string[];
  /** Payé directement par la famille (virements, cartes, prélèvements). */
  famille: { couts: MilaLine[]; epargne: MilaLine[]; financement: MilaLine[]; total: number; perMonth: number };
  /** Son compte Migros: ce qui y entre et ce qui en sort. */
  compte: null | {
    from: string;
    to: string;
    soldeInitial: number;
    solde: number;
    entrees: MilaLine[];
    sorties: MilaLine[];
    totalEntrees: number;
    totalSorties: number;
    /** Dépenses comptées (Yverdon, Ste-Croix, CPNV). */
    coutNet: number;
    coutNetPerMonth: number;
    /** Dépenses de son compte hors Yverdon et Ste-Croix: non comptées. */
    hors: number;
  };
  /** Coût réel pour la famille: payé directement + dépenses nettes de son compte. L'argent de poche (épargne) est à part. */
  cout: { total: number; perMonth: number };
}

export function milaRules(l: Ledger): MilaRule[] {
  try {
    const r = JSON.parse(l.getSetting('mila.rules') || '[]') as MilaRule[];
    return r.length ? r : DEFAULT_MILA_RULES;
  } catch {
    return DEFAULT_MILA_RULES;
  }
}

function ensureAccount(l: Ledger): void {
  l.raw.exec('CREATE TABLE IF NOT EXISTS mila_compte (id TEXT PRIMARY KEY, date TEXT NOT NULL, amount REAL NOT NULL, label TEXT NOT NULL)');
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r0 = (n: number) => Math.round(n);

function lines(map: Map<string, { label: string; byMonth: Map<string, number>; count: number }>, fullMonths: string[], order: string[]): MilaLine[] {
  const n = Math.max(1, fullMonths.length);
  return [...map.entries()]
    .map(([key, v]) => {
      const total = [...v.byMonth.values()].reduce((t, x) => t + x, 0);
      const site = fullMonths.reduce((t, m) => t + (v.byMonth.get(m) ?? 0), 0);
      return { key, label: v.label, total: r2(total), perMonth: r0(site / n), count: v.count };
    })
    .sort((a, b) => (order.indexOf(a.key) < 0 ? 99 : order.indexOf(a.key)) - (order.indexOf(b.key) < 0 ? 99 : order.indexOf(b.key)) || b.total - a.total);
}

function add(map: Map<string, { label: string; byMonth: Map<string, number>; count: number }>, key: string, label: string, month: string, amount: number): void {
  const e = map.get(key) ?? { label, byMonth: new Map<string, number>(), count: 0 };
  e.byMonth.set(month, (e.byMonth.get(month) ?? 0) + amount);
  e.count++;
  map.set(key, e);
}

export function milaView(l: Ledger, now: Date = new Date()): MilaView {
  init(l);
  ensureAccount(l);
  const rules = milaRules(l);
  const current = now.toISOString().slice(0, 7);
  const rows = l.raw
    .prepare("SELECT date, amount, label, category FROM budget_txs WHERE date >= ? AND amount < 0 AND category <> 'doublon' AND category <> 'interne'")
    .all(WIDE_START) as unknown as { date: string; amount: number; label: string; category: string }[];

  const accAll = l.raw.prepare('SELECT date, amount, label FROM mila_compte WHERE date >= ? ORDER BY date, id').all(MILA_START) as unknown as { date: string; amount: number; label: string }[];
  const onSite = new RegExp(ON_SITE, 'i');
  const acc = accAll.filter((t) => t.amount > 0 ? /transfert imhof/i.test(t.label) : onSite.test(t.label));
  const hors = r2(accAll.filter((t) => t.amount < 0 && !onSite.test(t.label)).reduce((t, x) => t - x.amount, 0));

  // Mois pleins écoulés depuis l'arrivée sur place (le mois en cours est exclu).
  const fullMonths: string[] = [];
  for (let y = 2026, m = 9; ; m++) {
    if (m > 12) { m = 1; y++; }
    const k = `${y}-${String(m).padStart(2, '0')}`;
    if (k >= current) break;
    fullMonths.push(k);
  }

  const couts = new Map<string, { label: string; byMonth: Map<string, number>; count: number }>();
  const epargne = new Map<string, { label: string; byMonth: Map<string, number>; count: number }>();
  const financement = new Map<string, { label: string; byMonth: Map<string, number>; count: number }>();
  for (const r of rows) {
    const rule = rules.find((x) => new RegExp(x.re, 'i').test(r.label) && (!x.categories?.length || x.categories.includes(r.category)) && (!x.from || r.date >= x.from));
    if (!rule) continue;
    const m = r.date.slice(0, 7);
    const v = -r.amount;
    if (rule.kind === 'loyer') add(couts, 'loyer', 'Logement (Balcon du Jura)', m, v);
    else if (rule.kind === 'ecole') add(couts, 'ecole', 'École et fournitures', m, v);
    else if (rule.kind === 'nourriture') add(couts, 'nourriture', 'Repas sur place payés avec nos cartes', m, v);
    else if (rule.kind === 'poche') add(epargne, 'poche', 'Argent de poche (versé sur son épargne)', m, v);
    else add(financement, 'virement', 'Virements vers son compte courant (déjà dans ses dépenses ci-dessous)', m, v);
  }

  const famCouts = lines(couts, fullMonths, ['loyer', 'ecole', 'nourriture', 'virement']);
  const famTotal = r2(famCouts.reduce((t, x) => t + x.total, 0));
  const famPerMonth = famCouts.reduce((t, x) => t + x.perMonth, 0);

  let compte: MilaView['compte'] = null;
  if (acc.length) {
    const entrees = new Map<string, { label: string; byMonth: Map<string, number>; count: number }>();
    const sorties = new Map<string, { label: string; byMonth: Map<string, number>; count: number }>();
    for (const t of acc) {
      const m = t.date.slice(0, 7);
      const rule = ACCOUNT_RULES.find((x) => new RegExp(x.re, 'i').test(t.label));
      const cat = rule?.cat ?? 'autre';
      if (t.amount > 0) {
        add(entrees, 'versement', 'Versements de la famille', m, t.amount);
      } else {
        const label = cat === 'versement' ? AUTRE : (rule?.label ?? AUTRE);
        add(sorties, cat === 'versement' ? 'autre' : cat, label, m, -t.amount);
      }
    }
    const sortiesL = lines(sorties, fullMonths, ['alimentation', 'restaurants', 'ecole', 'transport', 'sante', 'vetements', 'autre']);
    const entreesL = lines(entrees, fullMonths, ['versement']);
    const totalEntrees = r2(entreesL.reduce((t, x) => t + x.total, 0));
    const totalSorties = r2(sortiesL.reduce((t, x) => t + x.total, 0));
    const bal = l.raw.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM mila_compte').get() as { s: number } | undefined;
    const solde = r2(MILA_SOLDE_INITIAL + (bal?.s ?? 0));
    compte = {
      from: acc[0].date,
      to: acc[acc.length - 1].date,
      soldeInitial: MILA_SOLDE_INITIAL,
      solde,
      entrees: entreesL,
      sorties: sortiesL,
      totalEntrees,
      totalSorties,
      coutNet: totalSorties,
      coutNetPerMonth: sortiesL.reduce((t, x) => t + x.perMonth, 0),
      hors,
    };
  }

  return {
    from: MILA_START,
    siteFrom: MILA_SITE_MONTH,
    fullMonths,
    famille: { couts: famCouts, epargne: lines(epargne, fullMonths, ['poche']), financement: lines(financement, fullMonths, ['virement']), total: famTotal, perMonth: famPerMonth },
    compte,
    cout: { total: r2(famTotal + (compte?.coutNet ?? 0)), perMonth: famPerMonth + (compte?.coutNetPerMonth ?? 0) },
  };
}

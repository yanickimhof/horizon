import type { Ledger } from './ledger';
import { isGenericPayee, normalizeLabel } from './statements';
import { supplierOf } from './supplier';
import { rateFor } from '../src/engine/fx';

/**
 * Où va vraiment l'argent: au lieu de catégories, trois sortes de dépenses.
 * - ce qui revient (hypothèque, assurances, leasings, abonnements...): classé par coût sur l'année;
 * - le quotidien (commerçants): là où l'on dépense le plus;
 * - l'exceptionnel (impôts, travaux, grosses dépenses uniques).
 * Chaque fournisseur est comparé à lui-même, sur la même durée l'année précédente.
 */

export interface RecurringItem {
  key: string;
  label: string;
  category: string;
  bien: string | null;
  cadence: 'mensuel' | 'trimestriel' | 'semestriel' | 'annuel' | 'régulier';
  perYear: number;
  perMonth: number;
  count: number;
  last: string;
  /** Variation par rapport aux 12 mois précédents (null si l'historique ne suffit pas). */
  trend: number | null;
  /** Écart en francs par rapport à la même période un an plus tôt. */
  delta: number | null;
  /** Montant de la même période un an plus tôt (null si les relevés ne remontent pas assez loin). */
  prior: number | null;
  /** Une dépense qu'on peut renégocier ou résilier (assurance, télécom, abonnement, frais). */
  lever: boolean;
  /** Les paiements les plus récents de la période, tels que la banque les écrit. */
  lines: Line[];
}

export interface Line {
  date: string;
  amount: number;
  account: string;
  text: string;
}

export interface Merchant {
  key: string;
  label: string;
  category: string;
  total: number;
  count: number;
  trend: number | null;
  delta: number | null;
  prior: number | null;
  lines: Line[];
}

export interface OneOff {
  label: string;
  date: string;
  amount: number;
  category: string;
  bien: string | null;
  text: string;
}

export interface CategoryMove {
  category: string;
  perYear: number;
  trend: number;
  delta: number;
  prior: number;
}

export interface RecurringView {
  /** Variations par catégorie: un changement de fournisseur (autre assurance, autre opérateur) s'y lit d'un coup. */
  categories: CategoryMove[];
  /** Travaux et frais ponctuels d'un bien: affichés dans l'immobilier, pas dans l'exceptionnel. */
  works: OneOff[];
  /** Les douze mois pris en compte, du plus ancien au plus récent. */
  months: string[];
  /** Nombre de mois comparés à la même période un an plus tôt (0 si l'historique manque). */
  comparedMonths: number;
  /** Les mois de l'an passé auxquels la période est comparée, du plus ancien au plus récent. */
  priorMonths: string[];
  income: number;
  /** D'où viennent les gains de la période (salaire, loyers, chômage...), avec la même période un an plus tôt. */
  incomeBy: { label: string; amount: number; prior: number | null }[];
  /** Versements uniques non comptés dans les gains (vente, indemnité). */
  incomeOnce: number;
  /** Gains et dépenses de la même période un an plus tôt, ramenés à la même durée (null si l'historique manque). */
  compare: { income: number | null; spend: number | null };
  recurring: RecurringItem[];
  merchants: Merchant[];
  oneOffs: OneOff[];
  totals: { recurring: number; daily: number; exceptional: number; works: number };
}

interface Row {
  account: string;
  date: string;
  amount: number;
  currency: string;
  label: string;
  category: string;
  bien: string | null;
}

const NOT_SPEND = new Set(['interne', 'epargne', 'revenu', 'exceptionnel', 'doublon']);
// Un montant qui varie beaucoup d'un mois à l'autre (intérêts semestriels, primes) reste un engagement pour ces catégories.
const LOOSE = new Set(['logement', 'assurances', 'energie', 'telecom', 'banque', 'famille', 'enfants']);
const FIXED = new Set(['logement', 'assurances', 'energie', 'telecom', 'abonnements', 'banque', 'vehicule', 'enfants', 'famille']);
const LEVER = new Set(['assurances', 'telecom', 'abonnements', 'banque', 'energie']);
const ONE_OFF_CATEGORIES = new Set(['impots', 'travaux']);

const monthIndex = (m: string): number => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

function cadenceOf(months: number[]): RecurringItem['cadence'] {
  const sorted = [...new Set(months)].sort((a, b) => a - b);
  if (sorted.length < 2) return 'annuel';
  const gaps = sorted.slice(1).map((m, i) => m - sorted[i]);
  const g = median(gaps);
  if (g <= 1) return 'mensuel';
  if (g >= 2 && g <= 4) return 'trimestriel';
  if (g >= 5 && g <= 7) return 'semestriel';
  if (g >= 11) return 'annuel';
  return 'régulier';
}

export function recurringView(l: Ledger, now: Date = new Date(), period = '12'): RecurringView {
  const rows = l.raw.prepare('SELECT account, date, amount, currency, label, category, bien FROM budget_txs').all() as unknown as Row[];
  const kinds = new Map((l.raw.prepare('SELECT name, kind FROM budget_accounts').all() as { name: string; kind: string }[]).map((a) => [a.name, a.kind]));
  const rates = l.rates();
  const toChf = (n: number, ccy: string) => (ccy === 'CHF' ? n : n * (rateFor(rates, ccy)?.perUnit ?? 1));
  const cardMonths = new Set(rows.filter((r) => kinds.get(r.account) === 'card').map((r) => r.date.slice(0, 7)));
  const current = now.toISOString().slice(0, 7);

  const all = [...new Set(rows.map((r) => r.date.slice(0, 7)))].filter((m) => m < current).sort();
  const last = all[all.length - 1];
  const empty: RecurringView = { categories: [], works: [], months: [], comparedMonths: 0, priorMonths: [], income: 0, incomeBy: [], incomeOnce: 0, compare: { income: null, spend: null }, recurring: [], merchants: [], oneOffs: [], totals: { recurring: 0, daily: 0, exceptional: 0, works: 0 } };
  if (!last) return empty;
  // La période choisie: 12 derniers mois, une année (à ce jour si elle n'est pas finie) ou un mois.
  const range = period.match(/^(\d{4}-\d{2})\.\.(\d{4}-\d{2})$/);
  const pick = range ? all.filter((m) => m >= range[1] && m <= range[2]) : /^\d{4}-\d{2}$/.test(period) ? all.filter((m) => m === period) : /^\d{4}$/.test(period) ? all.filter((m) => m.startsWith(period)) : all.slice(-12);
  const sel = pick.length > 0 ? pick : all.slice(-12);
  const end = monthIndex(sel[sel.length - 1]);
  // Ce qui est « récurrent » se juge sur les douze mois qui finissent avec la période, quelle que soit sa longueur.
  const inCls = (m: string) => monthIndex(m) > end - 12 && monthIndex(m) <= end;
  const selSet = new Set(sel);
  const inSel = (m: string) => selSet.has(m);
  const months = sel;
  const perMonthCount = new Map<string, number>();
  for (const r of rows) perMonthCount.set(r.date.slice(0, 7), (perMonthCount.get(r.date.slice(0, 7)) ?? 0) + 1);
  const recentCounts = all.filter(inCls).map((m) => perMonthCount.get(m) ?? 0).sort((a, b) => a - b);
  const threshold = Math.max(3, 0.4 * (recentCounts[Math.floor(recentCounts.length / 2)] ?? 0));
  const denseStart = all.find((m) => (perMonthCount.get(m) ?? 0) >= threshold);
  const denseIdx = denseStart ? monthIndex(denseStart) : Infinity;
  // On ne compare que les mois dont le mois jumeau, un an plus tôt, est couvert: « même période l'an dernier ».
  const pairMonths = sel.filter((m) => monthIndex(m) - 12 >= denseIdx);
  const pairSet = new Set(pairMonths);
  const priorSet = new Set(pairMonths.map((m) => `${Number(m.slice(0, 4)) - 1}-${m.slice(5, 7)}`));
  const inPair = (m: string) => pairSet.has(m);
  const inPairPrior = (m: string) => priorSet.has(m);
  const priorCovered = pairMonths.length >= Math.min(6, sel.length);
  const scale = pairMonths.length > 0 ? sel.length / pairMonths.length : 1;

  // Noms (et au besoin catégories) choisis par l'utilisateur: réglage « budget.fournisseurs », liste de { re, name, category? }.
  const aliases = (() => {
    try {
      return (JSON.parse(l.getSetting('budget.fournisseurs') || '[]') as { re: string; name: string; category?: string }[]).filter((a) => a.re && a.name);
    } catch {
      return [];
    }
  })();
  const aliasOf = (label: string) => aliases.find((a) => new RegExp(a.re, 'i').test(label));
  const spend = rows
    // Les remboursements (assurance, impôts, achats retournés) sont gardés: ils viennent en déduction du même fournisseur.
    .filter((r) => !NOT_SPEND.has(r.category) && !(r.category === 'carte' && cardMonths.has(r.date.slice(0, 7))))
    .map((r) => {
      const hit = aliasOf(r.label);
      return hit?.category ? { ...r, category: hit.category } : r;
    });
  const income = rows.filter((r) => r.category === 'revenu' && r.amount > 0 && inSel(r.date.slice(0, 7))).reduce((t, r) => t + toChf(r.amount, r.currency), 0);

  // Un fournisseur est ce qu'on dirait à voix haute: « Migros », « CSS », « Intérêts hypothécaires, Osiris ».
  const hh = l.current().find((x) => x.key === 'household');
  const selfNames = [
    ...(typeof hh?.data.name === 'string' ? [normalizeLabel(String(hh.data.name))] : []),
    ...(Array.isArray(hh?.data.members) ? (hh!.data.members as { name?: unknown; role?: unknown }[]).filter((m) => m.role !== 'child' && typeof m.name === 'string').map((m) => normalizeLabel(String(m.name))) : []),
  ].filter((n) => n.length >= 3);
  const supplier = (r: Row): string => {
    const hit = aliasOf(r.label);
    if (hit) return hit.name;
    return isGenericPayee(r.label) ? normalizeLabel(r.label).slice(0, 40) : supplierOf(r.label, { selfNames, bien: r.bien }).name;
  };
  type G = { key: string; label: string; rows: Row[]; cat: Map<string, number> };
  const groups = new Map<string, G>();
  for (const r of spend) {
    const name = supplier(r);
    const k = normalizeLabel(name);
    const g = groups.get(k) ?? { key: k, label: isGenericPayee(r.label) ? r.label.slice(0, 40) : name, rows: [], cat: new Map<string, number>() };
    g.rows.push(r);
    g.cat.set(r.category, (g.cat.get(r.category) ?? 0) + Math.abs(toChf(r.amount, r.currency)));
    groups.set(k, g);
  }
  const sum = (rs: Row[], f: (m: string) => boolean) => rs.filter((r) => f(r.date.slice(0, 7))).reduce((t, r) => t - toChf(r.amount, r.currency), 0);
  const topCat = (g: G) => [...g.cat.entries()].sort((a, b) => b[1] - a[1])[0][0];
  // Un assureur maladie facture la prime (le même montant qui revient) et, à côté, des participations aux soins (montants variables, remboursements):
  // on sépare les deux pour que la prime se lise comme un engagement et les soins comme une dépense de santé.
  for (const g of [...groups.values()]) {
    if (topCat(g) !== 'assurances' || g.rows.length < 12) continue;
    const counts = new Map<number, number>();
    for (const r of g.rows) counts.set(Math.round(-toChf(r.amount, r.currency)), (counts.get(Math.round(-toChf(r.amount, r.currency))) ?? 0) + 1);
    const repeated = new Set([...counts.entries()].filter(([v, n]) => n >= 4 && v >= 10).map(([v]) => v));
    const premium = g.rows.filter((r) => repeated.has(Math.round(-toChf(r.amount, r.currency))));
    const care = g.rows.filter((r) => !repeated.has(Math.round(-toChf(r.amount, r.currency))));
    if (premium.length === 0 || care.length < 4) continue;
    g.rows = premium;
    const k = `${g.key} soins`;
    groups.set(k, { key: k, label: `${g.label}, participations aux soins`, rows: care.map((r) => ({ ...r, category: 'sante' })), cat: new Map([['sante', care.reduce((t, r) => t + Math.abs(toChf(r.amount, r.currency)), 0)]]) });
  }
  const toLines = (rs: Row[]): Line[] => [...rs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12).map((r) => ({ date: r.date, amount: -toChf(r.amount, r.currency), account: r.account, text: r.label.replace(/\s+/g, ' ').slice(0, 110) }));

  const recurring: RecurringItem[] = [];
  const merchants: Merchant[] = [];
  const oneOffs: OneOff[] = [];
  const works: OneOff[] = [];
  const totals = { recurring: 0, daily: 0, exceptional: 0, works: 0 };

  for (const g of groups.values()) {
    const win = g.rows.filter((r) => inCls(r.date.slice(0, 7)));
    const chosen = g.rows.filter((r) => inSel(r.date.slice(0, 7)));
    if (chosen.length === 0) continue;
    const base = win.length > 0 ? win : chosen;
    const category = topCat(g);
    const monthsSet = [...new Set(g.rows.map((r) => monthIndex(r.date.slice(0, 7))))];
    const winMonths = [...new Set(base.map((r) => r.date.slice(0, 7)))];
    const perMonthCnt = base.length / Math.max(winMonths.length, 1);
    // Montants par mois: stables pour un abonnement, éparpillés pour un commerçant.
    const monthlyTotals = winMonths.map((m) => base.filter((r) => r.date.slice(0, 7) === m).reduce((t, r) => t - toChf(r.amount, r.currency), 0));
    const mean = monthlyTotals.reduce((t, v) => t + v, 0) / monthlyTotals.length;
    const cv = mean > 0 ? Math.sqrt(monthlyTotals.reduce((t, v) => t + (v - mean) ** 2, 0) / monthlyTotals.length) / mean : 9;
    const generic = isGenericPayee(base[0].label);
    const isFixed = !generic && FIXED.has(category) && winMonths.length >= 2 && cv <= (LOOSE.has(category) ? 2 : 0.6);
    const isStable = !generic && !ONE_OFF_CATEGORIES.has(category) && winMonths.length >= 6 && cv <= 0.15 && perMonthCnt <= 1.5;
    const baseTotal = base.reduce((t, r) => t - toChf(r.amount, r.currency), 0);
    const isAnnual = !generic && (LEVER.has(category) ? baseTotal >= 100 : FIXED.has(category)) && winMonths.length === 1 && (LEVER.has(category) || monthsSet.some((m) => Math.abs(m - monthIndex(winMonths[0]) + 12) <= 1 || Math.abs(m - monthIndex(winMonths[0]) - 12) <= 1));

    const amount = sum(chosen, () => true);
    const prior = priorCovered ? sum(g.rows, inPairPrior) : null;
    const now12 = priorCovered ? sum(g.rows, inPair) : 0;
    const trend = prior !== null && prior > 50 ? now12 / prior - 1 : null;
    const delta = prior !== null && prior > 50 ? (now12 - prior) * scale : null;
    const priorScaled = prior !== null && prior > 50 ? prior * scale : null;
    const bien = chosen.find((r) => r.bien)?.bien ?? null;

    if (isFixed || isStable || isAnnual) {
      recurring.push({ key: g.key, label: g.label, category, bien, cadence: cadenceOf(monthsSet), perYear: amount, perMonth: amount / sel.length, count: chosen.length, last: chosen.map((r) => r.date).sort().pop() as string, trend, delta, prior: priorScaled, lever: LEVER.has(category), lines: toLines(chosen) });
      totals.recurring += amount;
      continue;
    }
    // Le reste. Un travail ou un frais lié à un bien va dans l'immobilier. Un impôt ou une grosse dépense inhabituelle est exceptionnel.
    // Un commerçant fréquenté au moins quatre mois est du quotidien: seule une très grosse dépense en sort.
    const regular = winMonths.length >= 4;
    const limit = regular ? 1000 : 300;
    let dailyTotal = 0;
    const dailyRows: Row[] = [];
    for (const r of chosen) {
      const chf = -toChf(r.amount, r.currency);
      const entry = { label: (isGenericPayee(r.label) ? r.label : supplier(r)).trim().slice(0, 60), date: r.date, amount: chf, category: r.category, bien: r.bien, text: r.label.replace(/\s+/g, ' ').slice(0, 110) };
      if (r.bien || r.category === 'travaux') {
        works.push(entry);
        totals.works += chf;
      } else if (r.category === 'impots' || r.category === 'voyages' || chf >= limit) {
        oneOffs.push(entry);
        totals.exceptional += chf;
      } else {
        dailyTotal += chf;
        dailyRows.push(r);
      }
    }
    totals.daily += dailyTotal;
    if (dailyTotal >= 100 * Math.min(1, sel.length / 12)) merchants.push({ key: g.key, label: g.label, category, total: dailyTotal, count: dailyRows.length, trend, delta, prior: priorScaled, lines: toLines(dailyRows) });
  }

  // Par catégorie, pour que le passage d'un fournisseur à un autre ne passe pas pour une baisse ou une hausse.
  const categories: CategoryMove[] = [];
  if (priorCovered) {
    const byCat = new Map<string, { now: number; prior: number; year: number }>();
    for (const r of spend) {
      const m = r.date.slice(0, 7);
      const c = byCat.get(r.category) ?? { now: 0, prior: 0, year: 0 };
      const chf = -toChf(r.amount, r.currency);
      if (inSel(m)) c.year += chf;
      if (inPair(m)) c.now += chf;
      if (inPairPrior(m)) c.prior += chf;
      byCat.set(r.category, c);
    }
    for (const [category, c] of byCat) {
      if (c.prior < 200) continue;
      const trend = c.now / c.prior - 1;
      const delta = (c.now - c.prior) * scale;
      if (Math.abs(trend) >= 0.1 && Math.abs(delta) >= 300 * Math.min(1, sel.length / 12)) categories.push({ category, perYear: c.year, trend, delta, prior: c.prior * scale });
    }
    categories.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }
  // Les gains par source, et la même période un an plus tôt.
  const incLabel = (r: Row): string => aliasOf(r.label)?.name ?? (r.bien || /loyer|g[ée]rance|r[ée]gie|immobili|myhome|iloc|mietzins/i.test(r.label) ? 'Loyers' : /ch[oô]mage|arbeitslosen/i.test(r.label) ? 'Chômage' : supplierOf(r.label, { selfNames, bien: r.bien }).name);
  const incomeRows = rows.filter((r) => r.category === 'revenu' && r.amount > 0);
  const incMap = new Map<string, { amount: number; prior: number }>();
  for (const r of incomeRows) {
    const m = r.date.slice(0, 7);
    const chf = toChf(r.amount, r.currency);
    const k = incLabel(r);
    const e = incMap.get(k) ?? { amount: 0, prior: 0 };
    if (inSel(m)) e.amount += chf;
    if (inPairPrior(m)) e.prior += chf * scale;
    incMap.set(k, e);
  }
  const incList = [...incMap.entries()].filter(([, v]) => v.amount > 0 || v.prior > 0).map(([label, v]) => ({ label, amount: v.amount, prior: priorCovered ? v.prior : null })).sort((a, b) => b.amount - a.amount);
  const incomeBy = incList.length > 4 ? [...incList.slice(0, 4), { label: 'Autres', amount: incList.slice(4).reduce((t, x) => t + x.amount, 0), prior: priorCovered ? incList.slice(4).reduce((t, x) => t + (x.prior ?? 0), 0) : null }] : incList;
  const incomeOnce = rows.filter((r) => r.category === 'exceptionnel' && r.amount > 0 && inSel(r.date.slice(0, 7))).reduce((t, r) => t + toChf(r.amount, r.currency), 0);
  const compare = {
    income: priorCovered ? incList.reduce((t, x) => t + (x.prior ?? 0), 0) : null,
    spend: priorCovered ? spend.filter((r) => inPairPrior(r.date.slice(0, 7))).reduce((t, r) => t - toChf(r.amount, r.currency), 0) * scale : null,
  };
  recurring.sort((a, b) => b.perYear - a.perYear);
  merchants.sort((a, b) => b.total - a.total);
  oneOffs.sort((a, b) => b.amount - a.amount);
  works.sort((a, b) => b.amount - a.amount);
  return { categories: categories.slice(0, 8), works, months, comparedMonths: priorCovered ? pairMonths.length : 0, priorMonths: priorCovered ? [...priorSet].sort() : [], income, incomeBy, incomeOnce, compare, recurring, merchants, oneOffs, totals };
}

export interface Fournisseur {
  re: string;
  name: string;
  category?: string;
}

export function getFournisseurs(l: Ledger): Fournisseur[] {
  try {
    return JSON.parse(l.getSetting('budget.fournisseurs') || '[]');
  } catch {
    return [];
  }
}

/** Enregistre les noms (et catégories) choisis par l'utilisateur pour des fournisseurs. */
export function setFournisseurs(l: Ledger, rules: Fournisseur[]): void {
  const clean: Fournisseur[] = [];
  for (const r of rules) {
    const re = String(r.re ?? '').trim();
    const name = String(r.name ?? '').trim();
    if (!re || !name) continue;
    try {
      new RegExp(re, 'i');
    } catch {
      throw new Error(`Motif invalide: ${re}`);
    }
    clean.push({ re, name, ...(r.category ? { category: String(r.category) } : {}) });
  }
  l.setSetting('budget.fournisseurs', JSON.stringify(clean));
}

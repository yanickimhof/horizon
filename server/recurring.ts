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
  /** Montant sur les mêmes mois cette année: c'est lui qu'on compare à `prior`. */
  now: number | null;
  /** Une dépense qu'on peut renégocier ou résilier (assurance, télécom, abonnement, frais). */
  lever: boolean;
  /** Les paiements les plus récents de la période, tels que la banque les écrit. */
  lines: Line[];
  /** Les fournisseurs tels que l'outil les lit, pour qu'une correction vise tout le groupe. */
  bases: string[];
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
  now: number | null;
  lines: Line[];
  bases: string[];
}

export interface OneOff {
  label: string;
  date: string;
  amount: number;
  category: string;
  bien: string | null;
  text: string;
  bases: string[];
}

export interface CategoryMove {
  category: string;
  perYear: number;
  trend: number;
  delta: number;
  prior: number;
}

export interface Change {
  key: string;
  label: string;
  kind: 'prix' | 'nouveau' | 'arret';
  /** Montant d'un paiement avant / après (prix), ou le montant courant (nouveau, arrêt). */
  from: number | null;
  to: number | null;
  cadence: string;
  /** Mois (AAAA-MM) du premier paiement au nouveau tarif, du premier paiement (nouveau) ou du dernier (arrêt). */
  since: string;
  /** Effet sur un an, en francs (positif = coûte plus). */
  yearly: number;
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
  compare: { income: number | null; spend: number | null; incomeNow: number | null; spendNow: number | null };
  /** Les mois de la période qui ont un jumeau un an plus tôt: ce sont eux, et eux seuls, qui servent aux comparaisons. */
  pairMonths: string[];
  /** Vrais changements de tarif des charges fixes (prime, abonnement), nouveaux abonnements et arrêts. */
  changes: Change[];
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
  const empty: RecurringView = { categories: [], works: [], months: [], comparedMonths: 0, priorMonths: [], income: 0, incomeBy: [], incomeOnce: 0, compare: { income: null, spend: null, incomeNow: null, spendNow: null }, pairMonths: [], changes: [], recurring: [], merchants: [], oneOffs: [], totals: { recurring: 0, daily: 0, exceptional: 0, works: 0 } };
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

  // Un fournisseur est ce qu'on dirait à voix haute: « Migros », « CSS », « Intérêts hypothécaires, Osiris ».
  const hh = l.current().find((x) => x.key === 'household');
  const selfNames = [
    ...(typeof hh?.data.name === 'string' ? [normalizeLabel(String(hh.data.name))] : []),
    ...(Array.isArray(hh?.data.members) ? (hh!.data.members as { name?: unknown; role?: unknown }[]).filter((m) => m.role !== 'child' && typeof m.name === 'string').map((m) => normalizeLabel(String(m.name))) : []),
  ].filter((n) => n.length >= 3);
  // Noms (et au besoin catégories) choisis par l'utilisateur: réglage « budget.fournisseurs », liste de { re? | key?, name, category? }.
  // Une règle « key » vise un fournisseur tel que l'outil le lit (toutes ses variantes), une règle « re » un libellé précis.
  const aliases = (() => {
    try {
      return (JSON.parse(l.getSetting('budget.fournisseurs') || '[]') as { re?: string; key?: string; name: string; category?: string }[]).filter((x) => (x.re || x.key) && x.name);
    } catch {
      return [];
    }
  })();
  const compact = (n: string) => normalizeLabel(n).replace(/[^a-z0-9]/g, '');
  const baseName = (r: Row): string => (isGenericPayee(r.label) ? normalizeLabel(r.label).slice(0, 40) : supplierOf(r.label, { selfNames, bien: r.bien }).name);
  const baseKey = (r: Row): string => compact(baseName(r));
  const aliasOf = (r: Row) => aliases.find((x) => (x.re && new RegExp(x.re, 'i').test(r.label)) || (x.key && x.key === baseKey(r)));
  const spend = rows
    // Les remboursements (assurance, impôts, achats retournés) sont gardés: ils viennent en déduction du même fournisseur.
    .filter((r) => !NOT_SPEND.has(r.category) && !(r.category === 'carte' && cardMonths.has(r.date.slice(0, 7))))
    .map((r) => {
      const hit = aliasOf(r);
      return hit?.category ? { ...r, category: hit.category } : r;
    });

  const supplier = (r: Row): string => {
    const hit = aliasOf(r);
    if (hit) return hit.name;
    return isGenericPayee(r.label) ? normalizeLabel(r.label).slice(0, 40) : supplierOf(r.label, { selfNames, bien: r.bien }).name;
  };
  type G = { key: string; label: string; rows: Row[]; cat: Map<string, number>; bases: Set<string> };
  const groups = new Map<string, G>();
  for (const r of spend) {
    const name = supplier(r);
    // Deux écritures du même nom (casse, points, espaces) forment un seul fournisseur.
    const k = normalizeLabel(name).replace(/[^a-z0-9]/g, '');
    const g = groups.get(k) ?? { key: k, label: isGenericPayee(r.label) ? r.label.slice(0, 40) : name, rows: [], cat: new Map<string, number>(), bases: new Set<string>() };
    g.rows.push(r);
    g.bases.add(baseKey(r));
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
    groups.set(k, { key: k, label: `${g.label}, participations aux soins`, rows: care.map((r) => ({ ...r, category: 'sante' })), cat: new Map([['sante', care.reduce((t, r) => t + Math.abs(toChf(r.amount, r.currency)), 0)]]), bases: new Set<string>() });
  }
  const toLines = (rs: Row[]): Line[] => [...rs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12).map((r) => ({ date: r.date, amount: -toChf(r.amount, r.currency), account: r.account, text: r.label.replace(/\s+/g, ' ').slice(0, 110) }));

  const recurring: RecurringItem[] = [];
  const merchants: Merchant[] = [];
  const oneOffs: OneOff[] = [];
  const works: OneOff[] = [];
  const changes: Change[] = [];
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
    // Les comparaisons se font sur les mêmes mois, sans extrapolation: ce qu'on compare est exactement ce qui est écrit.
    const delta = prior !== null && prior > 50 ? now12 - prior : null;
    const priorScaled = prior !== null && prior > 50 ? prior : null;
    const nowPair = prior !== null && prior > 50 ? now12 : null;
    const bien = chosen.find((r) => r.bien)?.bien ?? null;

    if (isFixed || isStable || isAnnual) {
      recurring.push({ key: g.key, label: g.label, category, bien, cadence: cadenceOf(monthsSet), perYear: amount, perMonth: amount / sel.length, count: chosen.length, last: chosen.map((r) => r.date).sort().pop() as string, trend, delta, prior: priorScaled, now: nowPair, lever: LEVER.has(category), lines: toLines(chosen), bases: [...g.bases] });
      totals.recurring += amount;
      // Tarif: on lit les paiements un par un, en séries de montants voisins.
      const pays = g.rows.filter((r) => monthIndex(r.date.slice(0, 7)) <= end && r.amount < 0).sort((a, b) => a.date.localeCompare(b.date));
      const runs: { amount: number; n: number; first: string }[] = [];
      for (const r of pays) {
        const v = -toChf(r.amount, r.currency);
        const last = runs[runs.length - 1];
        if (last && Math.abs(v - last.amount) <= Math.max(1, last.amount * 0.03)) last.n++;
        else runs.push({ amount: v, n: 1, first: r.date.slice(0, 7) });
      }
      const cad = cadenceOf(monthsSet);
      const ppy = cad === 'mensuel' ? 12 : cad === 'trimestriel' ? 4 : cad === 'semestriel' ? 2 : cad === 'annuel' ? 1 : 12;
      const need = ppy >= 12 ? 2 : 1;
      const cur = runs[runs.length - 1];
      const before = runs[runs.length - 2];
      if (cur && before && cur.n >= need && before.n >= need && winMonths.length >= 2 && cur.amount >= 5 && Math.abs(cur.amount - before.amount) >= Math.max(2, before.amount * 0.04) && monthIndex(cur.first) > end - 12) {
        changes.push({ key: g.key, label: g.label, kind: 'prix', from: before.amount, to: cur.amount, cadence: cad, since: cur.first, yearly: (cur.amount - before.amount) * ppy });
      } else if (runs.length === 1 && pays.length >= 2 && monthIndex(pays[0].date.slice(0, 7)) > end - 5 && cur.amount >= 5) {
        changes.push({ key: g.key, label: g.label, kind: 'nouveau', from: null, to: cur.amount, cadence: cad, since: pays[0].date.slice(0, 7), yearly: cur.amount * ppy });
      } else if (pays.length >= 4 && ppy >= 12 && monthIndex(pays[pays.length - 1].date.slice(0, 7)) < end - 1 && monthIndex(pays[pays.length - 1].date.slice(0, 7)) > end - 12 && cur.amount >= 5) {
        changes.push({ key: g.key, label: g.label, kind: 'arret', from: cur.amount, to: null, cadence: cad, since: pays[pays.length - 1].date.slice(0, 7), yearly: -cur.amount * ppy });
      }
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
      const entry = { label: (isGenericPayee(r.label) ? r.label : supplier(r)).trim().slice(0, 60), date: r.date, amount: chf, category: r.category, bien: r.bien, text: r.label.replace(/\s+/g, ' ').slice(0, 110), bases: [baseKey(r)] };
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
    if (dailyTotal >= 100 * Math.min(1, sel.length / 12)) merchants.push({ key: g.key, label: g.label, category, total: dailyTotal, count: dailyRows.length, trend, delta, prior: priorScaled, now: nowPair, lines: toLines(dailyRows), bases: [...g.bases] });
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
      const delta = c.now - c.prior;
      if (Math.abs(trend) >= 0.1 && Math.abs(delta) >= 300 * Math.min(1, sel.length / 12)) categories.push({ category, perYear: c.now, trend, delta, prior: c.prior });
    }
    categories.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }
  // Les gains par source, et la même période un an plus tôt.
  const incLabel = (r: Row): string => aliasOf(r)?.name ?? (r.bien || /loyer|g[ée]rance|r[ée]gie|immobili|myhome|iloc|mietzins/i.test(r.label) ? 'Loyers' : /ch[oô]mage|arbeitslosen/i.test(r.label) ? 'Chômage' : supplierOf(r.label, { selfNames, bien: r.bien }).name);
  // Un versement peut regrouper plusieurs choses (dernier salaire, bonus, plan social): réglage « budget.eclats », liste de { re, date?, parts: [{ label, amount?, once? }] }.
  // La dernière part reçoit le reste; « once » veut dire hors habituel (non compté dans les gains courants).
  const splits = (() => {
    try {
      return JSON.parse(l.getSetting('budget.eclats') || '[]') as { re: string; date?: string; parts: { label: string; amount?: number; once?: boolean }[] }[];
    } catch {
      return [];
    }
  })();
  type Ev = { month: string; label: string; amount: number; once: boolean };
  const events: Ev[] = [];
  for (const r of rows) {
    if (r.amount <= 0 || (r.category !== 'revenu' && r.category !== 'exceptionnel')) continue;
    const m = r.date.slice(0, 7);
    const chf = toChf(r.amount, r.currency);
    const rule = splits.find((x) => new RegExp(x.re, 'i').test(r.label) && (!x.date || x.date === r.date));
    if (rule && rule.parts.length > 0) {
      let left = chf;
      rule.parts.forEach((part, i) => {
        const v = i === rule.parts.length - 1 ? left : Math.min(left, part.amount ?? left);
        left -= v;
        events.push({ month: m, label: part.label, amount: v, once: !!part.once });
      });
    } else {
      events.push({ month: m, label: incLabel(r), amount: chf, once: r.category === 'exceptionnel' });
    }
  }
  const incMap = new Map<string, { amount: number; prior: number; now: number }>();
  let income = 0;
  let incomeOnce = 0;
  for (const e of events) {
    if (e.once) {
      if (inSel(e.month)) incomeOnce += e.amount;
      continue;
    }
    const k = incMap.get(e.label) ?? { amount: 0, prior: 0, now: 0 };
    if (inSel(e.month)) {
      k.amount += e.amount;
      income += e.amount;
    }
    if (inPairPrior(e.month)) k.prior += e.amount;
    if (inPair(e.month)) k.now += e.amount;
    incMap.set(e.label, k);
  }
  const incList = [...incMap.entries()].filter(([, v]) => v.amount > 0 || v.prior > 0).map(([label, v]) => ({ label, amount: v.amount, prior: priorCovered ? v.prior : null })).sort((a, b) => b.amount - a.amount);
  const incomeBy = incList.length > 4 ? [...incList.slice(0, 4), { label: 'Autres', amount: incList.slice(4).reduce((t, x) => t + x.amount, 0), prior: priorCovered ? incList.slice(4).reduce((t, x) => t + (x.prior ?? 0), 0) : null }] : incList;
  const sumSpend = (f: (m: string) => boolean) => spend.filter((r) => f(r.date.slice(0, 7))).reduce((t, r) => t - toChf(r.amount, r.currency), 0);
  const compare = {
    income: priorCovered ? incList.reduce((t, x) => t + (x.prior ?? 0), 0) : null,
    spend: priorCovered ? sumSpend(inPairPrior) : null,
    incomeNow: priorCovered ? [...incMap.values()].reduce((t, x) => t + x.now, 0) : null,
    spendNow: priorCovered ? sumSpend(inPair) : null,
  };
  recurring.sort((a, b) => b.perYear - a.perYear);
  merchants.sort((a, b) => b.total - a.total);
  oneOffs.sort((a, b) => b.amount - a.amount);
  works.sort((a, b) => b.amount - a.amount);
  return { categories: categories.slice(0, 8), works, months, comparedMonths: priorCovered ? pairMonths.length : 0, priorMonths: priorCovered ? [...priorSet].sort() : [], pairMonths: priorCovered ? pairMonths : [], income, incomeBy, incomeOnce, compare, changes: changes.sort((a, b) => Math.abs(b.yearly) - Math.abs(a.yearly)).slice(0, 8), recurring, merchants, oneOffs, totals };
}

export interface Fournisseur {
  re?: string;
  key?: string;
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
    const key = String(r.key ?? '').trim();
    const name = String(r.name ?? '').trim();
    if ((!re && !key) || !name) continue;
    if (re) {
      try {
        new RegExp(re, 'i');
      } catch {
        throw new Error(`Motif invalide: ${re}`);
      }
    }
    clean.push({ ...(re ? { re } : { key }), name, ...(r.category ? { category: String(r.category) } : {}) });
  }
  l.setSetting('budget.fournisseurs', JSON.stringify(clean));
}

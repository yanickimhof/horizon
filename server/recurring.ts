import type { Ledger } from './ledger';
import { isGenericPayee, normalizeLabel, payeeName } from './statements';
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
  /** Écart en francs sur l'année par rapport aux 12 mois précédents. */
  delta: number | null;
  /** Une dépense qu'on peut renégocier ou résilier (assurance, télécom, abonnement, frais). */
  lever: boolean;
}

export interface Merchant {
  key: string;
  label: string;
  category: string;
  total: number;
  count: number;
  trend: number | null;
  delta: number | null;
}

export interface OneOff {
  label: string;
  date: string;
  amount: number;
  category: string;
  bien: string | null;
}

export interface RecurringView {
  /** Les douze mois pris en compte, du plus ancien au plus récent. */
  months: string[];
  income: number;
  recurring: RecurringItem[];
  merchants: Merchant[];
  oneOffs: OneOff[];
  totals: { recurring: number; daily: number; exceptional: number };
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

export function recurringView(l: Ledger, now: Date = new Date()): RecurringView {
  const rows = l.raw.prepare('SELECT account, date, amount, currency, label, category, bien FROM budget_txs').all() as unknown as Row[];
  const kinds = new Map((l.raw.prepare('SELECT name, kind FROM budget_accounts').all() as { name: string; kind: string }[]).map((a) => [a.name, a.kind]));
  const rates = l.rates();
  const toChf = (n: number, ccy: string) => (ccy === 'CHF' ? n : n * (rateFor(rates, ccy)?.perUnit ?? 1));
  const cardMonths = new Set(rows.filter((r) => kinds.get(r.account) === 'card').map((r) => r.date.slice(0, 7)));
  const current = now.toISOString().slice(0, 7);

  // Les douze derniers mois complets, et les douze précédents pour comparer.
  const all = [...new Set(rows.map((r) => r.date.slice(0, 7)))].filter((m) => m < current).sort();
  const last = all[all.length - 1];
  const empty: RecurringView = { months: [], income: 0, recurring: [], merchants: [], oneOffs: [], totals: { recurring: 0, daily: 0, exceptional: 0 } };
  if (!last) return empty;
  const end = monthIndex(last);
  const inWindow = (m: string) => monthIndex(m) > end - 12 && monthIndex(m) <= end;
  const inPrior = (m: string) => monthIndex(m) > end - 24 && monthIndex(m) <= end - 12;
  const months = all.filter(inWindow);
  const dataStart = monthIndex(all[0]);
  // La comparaison n'a de sens que si les douze mois d'avant sont couverts au moins à moitié.
  const priorCovered = all.filter(inPrior).length >= 6 && dataStart <= end - 12 - 5;

  const spend = rows.filter((r) => r.amount < 0 && !NOT_SPEND.has(r.category) && !(r.category === 'carte' && cardMonths.has(r.date.slice(0, 7))));
  const income = rows.filter((r) => r.category === 'revenu' && r.amount > 0 && inWindow(r.date.slice(0, 7))).reduce((t, r) => t + toChf(r.amount, r.currency), 0);

  // Un fournisseur: son nom, sauf libellé générique (« Paiement », « Débit LSV »), où le début du libellé complet fait foi.
  const keyOf = (r: Row): string => (isGenericPayee(r.label) ? normalizeLabel(r.label).slice(0, 40) : payeeName(r.label));
  type G = { key: string; label: string; rows: Row[]; cat: Map<string, number> };
  const groups = new Map<string, G>();
  for (const r of spend) {
    const k = keyOf(r);
    const g = groups.get(k) ?? { key: k, label: r.label.split(',')[0].trim().slice(0, 48) || k, rows: [], cat: new Map<string, number>() };
    g.rows.push(r);
    g.cat.set(r.category, (g.cat.get(r.category) ?? 0) + Math.abs(toChf(r.amount, r.currency)));
    groups.set(k, g);
  }
  const sum = (rs: Row[], f: (m: string) => boolean) => rs.filter((r) => f(r.date.slice(0, 7))).reduce((t, r) => t - toChf(r.amount, r.currency), 0);
  const topCat = (g: G) => [...g.cat.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const recurring: RecurringItem[] = [];
  const merchants: Merchant[] = [];
  const oneOffs: OneOff[] = [];
  const totals = { recurring: 0, daily: 0, exceptional: 0 };

  for (const g of groups.values()) {
    const win = g.rows.filter((r) => inWindow(r.date.slice(0, 7)));
    if (win.length === 0) continue;
    const category = topCat(g);
    const monthsSet = [...new Set(g.rows.map((r) => monthIndex(r.date.slice(0, 7))))];
    const winMonths = [...new Set(win.map((r) => r.date.slice(0, 7)))];
    const perMonthCount = win.length / Math.max(winMonths.length, 1);
    // Montants par mois: stables pour un abonnement, éparpillés pour un commerçant.
    const monthlyTotals = winMonths.map((m) => win.filter((r) => r.date.slice(0, 7) === m).reduce((t, r) => t - toChf(r.amount, r.currency), 0));
    const mean = monthlyTotals.reduce((t, v) => t + v, 0) / monthlyTotals.length;
    const cv = mean > 0 ? Math.sqrt(monthlyTotals.reduce((t, v) => t + (v - mean) ** 2, 0) / monthlyTotals.length) / mean : 9;
    const generic = isGenericPayee(win[0].label);
    const isFixed = !generic && FIXED.has(category) && winMonths.length >= 2 && cv <= 0.6;
    const isStable = !generic && !ONE_OFF_CATEGORIES.has(category) && winMonths.length >= 6 && cv <= 0.15 && perMonthCount <= 1.5;
    const isAnnual = !generic && FIXED.has(category) && winMonths.length === 1 && monthsSet.some((m) => Math.abs(m - monthIndex(winMonths[0]) + 12) <= 1 || Math.abs(m - monthIndex(winMonths[0]) - 12) <= 1);

    const perYear = sum(win, () => true);
    const prior = priorCovered ? sum(g.rows, inPrior) : null;
    const trend = prior !== null && prior > 50 ? perYear / prior - 1 : null;
    const delta = prior !== null && prior > 50 ? perYear - prior : null;
    const bien = win.find((r) => r.bien)?.bien ?? null;

    if (isFixed || isStable || isAnnual) {
      recurring.push({ key: g.key, label: g.label, category, bien, cadence: cadenceOf(monthsSet), perYear, perMonth: perYear / 12, count: win.length, last: win.map((r) => r.date).sort().pop() as string, trend, delta, lever: LEVER.has(category) });
      totals.recurring += perYear;
      continue;
    }
    // Le reste: une grosse dépense unique ou un impôt est exceptionnel, le reste est du quotidien.
    let dailyTotal = 0;
    for (const r of win) {
      const chf = -toChf(r.amount, r.currency);
      if (ONE_OFF_CATEGORIES.has(r.category) || chf >= 1500) {
        oneOffs.push({ label: r.label.split(',')[0].trim().slice(0, 48), date: r.date, amount: chf, category: r.category, bien: r.bien });
        totals.exceptional += chf;
      } else {
        dailyTotal += chf;
      }
    }
    totals.daily += dailyTotal;
    if (dailyTotal >= 100) merchants.push({ key: g.key, label: g.label, category, total: dailyTotal, count: win.length, trend, delta });
  }

  recurring.sort((a, b) => b.perYear - a.perYear);
  merchants.sort((a, b) => b.total - a.total);
  oneOffs.sort((a, b) => b.amount - a.amount);
  return { months, income, recurring, merchants, oneOffs, totals };
}

import type { Snapshot } from './types';
import type { BudgetLike } from './treasury';
import { lastFullMonths } from './treasury';

/** Données d'un bien telles que le fait les porte (champs optionnels). */
export interface BienData {
  estimateLow?: number;
  estimateHigh?: number;
  ownerValue?: number;
  ownerValueYear?: number;
  fiscalValue2025?: number;
  grossRent2025?: number;
  netRentAnnual?: number;
  purchasePrice?: number;
  purchaseYear?: number;
  commune?: string;
  valueSource?: string;
}

export interface FactLike { key: string; data: Record<string, unknown>; status: string; validTo: string | null }

export interface DebtLine { label: string; balance: number; rate: number; variable: boolean; fixedUntil: string | null }

export interface Bien {
  key: string;
  name: string;
  home: boolean;
  commune: string | null;
  value: number;
  low: number;
  high: number;
  /** Fourchette tirée d'une estimation déclarée, pas d'une hypothèse de ce code. */
  ranged: boolean;
  fiscal: number | null;
  purchase: number | null;
  ownerValue: number | null;
  debt: number;
  debts: DebtLine[];
  equity: number;
  ltv: number;
  /** Rapport dette sur valeur à la borne basse de l'estimation. */
  ltvLow: number;
  interest: number;
  amortization: number;
  /** Versements réguliers de loyer par an (faits), net de la gérance. */
  rent: number;
  grossRent: number | null;
  /** Loyer net de la dette (intérêts et amortissement), par an, avant taxe foncière, assurance et travaux. */
  cashAfterDebt: number;
  /** Rendement brut: loyer payé par le locataire sur valeur. */
  grossYield: number | null;
  /** Rendement net avant dette: versements annuels sur valeur. */
  netYield: number;
  /** Couverture des intérêts et de l'amortissement par le loyer. */
  coverage: number | null;
  /** Hausse annuelle des intérêts pour +1 point sur la part variable. */
  rateShock: number;
  /** Relevés des 12 derniers mois complets, si le bien y apparaît. */
  observed: { months: number; rent: number; charges: number; net: number } | null;
}

export interface Portfolio {
  biens: Bien[];
  totalValue: number;
  totalDebt: number;
  equity: number;
  ltv: number;
  /** Part de l'immobilier dans l'actif total. */
  concentration: number;
  /** Part de l'immobilier dans le patrimoine net. */
  netConcentration: number;
  /** Prochaine échéance de taux fixe. */
  nextFixed: { date: string; label: string; balance: number } | null;
  variableDebt: number;
  rateShock: number;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** « PPE Les Peupliers » -> « Peupliers »; « Résidence principale (PPE Osiris) » -> « Osiris ». */
export function bienName(label: string): string {
  const inPpe = label.match(/\(\s*PPE\s+([^)]+)\)/i);
  if (inPpe) return inPpe[1].trim();
  return label.replace(/\(.*?\)/g, '').replace(/^PPE\s+(Les\s+)?/i, '').trim();
}

const matches = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  return x !== '' && y !== '' && (x.includes(y) || y.includes(x));
};

const fixedUntil = (note: string | undefined): string | null => {
  const m = (note ?? '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};

export function portfolio(snap: Snapshot, facts: FactLike[], budget: BudgetLike | null): Portfolio {
  const data = new Map(facts.filter((f) => f.status === 'confirmed' && f.validTo === null).map((f) => [f.key, f.data]));
  const note = (key: string) => String((data.get(key) as { note?: unknown } | undefined)?.note ?? '');
  const homes = new Set((budget?.homes ?? []).map((h) => norm(h)));
  const full = budget ? lastFullMonths(budget.months) : [];

  const biens: Bien[] = snap.assets
    .filter((a) => a.class === 'real_estate')
    .map((a) => {
      const d = (data.get(a.key) ?? {}) as BienData;
      const name = bienName(a.label);
      const home = a.subtype === 'home' || homes.has(norm(name));
      const lo = d.estimateLow;
      const hi = d.estimateHigh;
      const ranged = typeof lo === 'number' && typeof hi === 'number' && lo > 0 && hi >= lo;
      const debts: DebtLine[] = snap.liabilities
        .filter((l) => l.securedBy === a.key)
        .map((l) => ({ label: l.label, balance: l.balance, rate: l.rate, variable: l.variable, fixedUntil: l.variable ? null : fixedUntil(note(l.key)) }));
      const debt = debts.reduce((s, l) => s + l.balance, 0);
      const interest = snap.liabilities.filter((l) => l.securedBy === a.key).reduce((s, l) => s + l.balance * l.rate, 0);
      const amortization = snap.expenses
        .filter((e) => /amort/i.test(e.key + e.label) && matches(e.label, name))
        .reduce((s, e) => s + e.monthly * 12, 0);
      const rent = snap.incomes.filter((i) => /^income:loc-/.test(i.key) && matches(i.label, name)).reduce((s, i) => s + i.monthly * 12, 0);
      const value = a.value;
      const low = ranged ? lo! : value;
      const high = ranged ? hi! : value;
      const obs = full.map((m) => Object.entries(m.immo).find(([b]) => matches(b, name))?.[1]).filter((x): x is { loyers: number; charges: number } => !!x);
      const f = full.length ? 12 / full.length : 0;
      const observed = obs.length
        ? {
            months: full.length,
            rent: obs.reduce((s, x) => s + x.loyers, 0) * f,
            charges: obs.reduce((s, x) => s + x.charges, 0) * f,
            net: obs.reduce((s, x) => s + x.loyers - x.charges, 0) * f,
          }
        : null;
      return {
        key: a.key,
        name,
        home,
        commune: d.commune ?? null,
        value,
        low,
        high,
        ranged,
        fiscal: d.fiscalValue2025 ?? null,
        purchase: d.purchasePrice ?? null,
        ownerValue: d.ownerValue ?? null,
        debt,
        debts,
        equity: value - debt,
        ltv: value > 0 ? debt / value : 0,
        ltvLow: low > 0 ? debt / low : 0,
        interest,
        amortization,
        rent,
        grossRent: d.grossRent2025 ?? null,
        cashAfterDebt: rent - interest - amortization,
        grossYield: d.grossRent2025 && value > 0 ? d.grossRent2025 / value : null,
        netYield: value > 0 ? rent / value : 0,
        coverage: interest + amortization > 0 ? rent / (interest + amortization) : null,
        rateShock: debts.filter((l) => l.variable).reduce((s, l) => s + l.balance * 0.01, 0),
        observed,
      };
    })
    .sort((p, q) => Number(p.home) - Number(q.home) || q.value - p.value);

  const totalValue = biens.reduce((s, b) => s + b.value, 0);
  const totalDebt = biens.reduce((s, b) => s + b.debt, 0);
  const assets = snap.assets.reduce((s, a) => s + a.value, 0);
  const debtAll = snap.liabilities.reduce((s, l) => s + l.balance, 0);
  const fixed = biens
    .flatMap((b) => b.debts.filter((d) => d.fixedUntil).map((d) => ({ date: d.fixedUntil as string, label: `${b.name}: ${d.label}`, balance: d.balance })))
    .sort((p, q) => p.date.localeCompare(q.date));
  const today = snap.asOf.slice(0, 10);

  return {
    biens,
    totalValue,
    totalDebt,
    equity: totalValue - totalDebt,
    ltv: totalValue > 0 ? totalDebt / totalValue : 0,
    concentration: assets > 0 ? totalValue / assets : 0,
    netConcentration: assets - debtAll > 0 ? (totalValue - totalDebt) / (assets - debtAll) : 0,
    nextFixed: fixed.find((x) => x.date >= today) ?? null,
    variableDebt: biens.reduce((s, b) => s + b.debts.filter((d) => d.variable).reduce((t, d) => t + d.balance, 0), 0),
    rateShock: biens.reduce((s, b) => s + b.rateShock, 0),
  };
}

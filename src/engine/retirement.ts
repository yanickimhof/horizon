import type { Asset, Expense, Income, Liability, RetirementMode, Snapshot } from './types';
import { DEFAULT_ASSUMPTIONS, compound, resolvePhase, valueAt, type Assumptions } from './assumptions';
import { isActive } from './timing';
import { COUNTRY } from './country';
import { incomeTax, wealthTax } from './tax';

/**
 * Simulation de la retraite, mois par mois, en francs d'AUJOURD'HUI (pouvoir d'achat constant).
 * Réponse à une seule question: avec ce patrimoine, ces revenus et ce budget, tient-on jusqu'à
 * l'âge visé, et faut-il vendre un bien pour y arriver?
 *
 * Principes:
 * - avant la retraite: les revenus (salaire compris) moins toutes les dépenses alimentent les liquidités;
 * - à la retraite: les avoirs de prévoyance (LPP, 3a, 401(k)) sont versés, impôt de sortie déduit;
 * - après: les revenus qui continuent (loyers, rentes) moins le budget de retraite et l'impôt sur ces revenus;
 * - un bien vendu rapporte sa valeur moins la décote et la dette, et supprime son loyer et ses charges.
 */

export interface Sale {
  key: string;
  /** Âge du premier adulte à la vente. */
  age: number;
}

export interface RetirementParams {
  retireAge: number;
  endAge: number;
  /** Budget mensuel de retraite. null: dépenses actuelles hors impôts et hors études. */
  monthlyBudget: number | null;
  /** Impôt sur les revenus de retraite (loyers, rentes), en part de ces revenus. */
  retirementTaxRate: number;
  /** Points de taux ajoutés aux dettes à taux variable dès maintenant. */
  rateShock: number;
  /** Mois sans salaire ni bonus à partir d'aujourd'hui. */
  salaryLossMonths: number;
  /** Indemnité de chômage mensuelle nette versée pendant ces mois (0: aucune). */
  unemploymentBenefit: number;
  /** Durée maximale de l'indemnité de chômage, en mois. */
  unemploymentMonths: number;
  /** Le 401(k) est racheté dans le 2e pilier: impôt de sortie réduit, perte de change. */
  rollover401k: boolean;
  sales: Sale[];
  /** Vendre automatiquement un bien quand les liquidités deviennent négatives. */
  autoSell: boolean;
  /** Taux au moins appliqué aux dettes variables, 0 pour garder le taux actuel. */
  normalRate: number;
  /** Impôts de retraite calculés (revenu et fortune). Sinon, un taux simple sur les loyers et rentes. */
  detailedTax: boolean;
  /** Part des loyers perdue en vacance locative, 0 à 1. */
  vacancyRate: number;
  /** Loyer annuel de remplacement après la vente de la résidence, en part de sa valeur. */
  replacementRentRate: number;
}

/**
 * Chômage, selon le SECO: gain assuré plafonné à 148 200 par an (12 350 par mois), indemnité de 80 % lorsqu'un enfant
 * de moins de 25 ans est à charge (70 % sinon), 400 indemnités journalières au plus (au moins 18 mois de cotisation),
 * soit environ 18 mois. Environ 6 % de cotisations sociales sont retenues.
 */
export const UNEMPLOYMENT_GAIN_MAX_MONTHLY = COUNTRY.unemployment.gainMaxMonthly;
export const UNEMPLOYMENT_NET_MONTHLY = Math.round(UNEMPLOYMENT_GAIN_MAX_MONTHLY * COUNTRY.unemployment.rate * COUNTRY.unemployment.netFactor);

export const DEFAULT_PARAMS: RetirementParams = {
  retireAge: COUNTRY.retirement.defaultAge,
  endAge: COUNTRY.retirement.endAge,
  monthlyBudget: null,
  retirementTaxRate: COUNTRY.retirement.taxRate,
  rateShock: 0,
  salaryLossMonths: 0,
  unemploymentBenefit: 0,
  unemploymentMonths: COUNTRY.unemployment.months,
  rollover401k: false,
  sales: [],
  autoSell: false,
  normalRate: COUNTRY.rates.normalVariableRate,
  detailedTax: true,
  vacancyRate: COUNTRY.tax.vacancyRate,
  replacementRentRate: COUNTRY.tax.replacementRentRate,
};

export interface YearRow {
  age: number;
  year: number;
  liquid: number;
  pensions: number;
  realEstate: number;
  netWorth: number;
  /** Revenus mensuels de l'année (moyenne du mois d'échantillonnage). */
  income: number;
  /** Dépenses mensuelles, impôt de retraite compris. */
  spending: number;
}

export interface RetirementEvent {
  age: number;
  year: number;
  kind: 'retire' | 'sale' | 'pension' | 'broke' | 'liquidity';
  text: string;
}

export interface RetirementResult {
  rows: YearRow[];
  events: RetirementEvent[];
  /** Âge où les liquidités passent sous zéro pour la première fois, ou null. */
  liquidityEndsAge: number | null;
  /** Âge où même après la vente de tous les biens il manque de l'argent, ou null. */
  brokeAge: number | null;
  /** Budget mensuel de retraite retenu. */
  budget: number;
  /** Biens vendus, dans l'ordre. */
  sold: { key: string; label: string; age: number }[];
  /** Patrimoine net à l'âge final. */
  finalNetWorth: number;
  /** Plus bas niveau de liquidités sur la période (négatif = manque). */
  minLiquid: number;
}

const STOP = new Set(['ppe', 'résidence', 'residence', 'principale', 'studio', 'les', 'la', 'le', 'de', 'du', 'des', 'appartement', 'villa', 'maison']);

/** Mot distinctif du nom d'un bien (Les Tilleuls, Les Alpes...), pour relier loyers et charges au bien. */
export function propertyToken(label: string): string {
  const words = label.toLowerCase().replace(/[()]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  return words.sort((a, b) => b.length - a.length)[0] ?? label.toLowerCase();
}

export interface PropertyLinks {
  asset: Asset;
  incomes: Income[];
  expenses: Expense[];
  liabilities: Liability[];
}

export function propertyLinks(s: Snapshot, asset: Asset): PropertyLinks {
  const tok = propertyToken(asset.label);
  return {
    asset,
    incomes: s.incomes.filter((i) => i.label.toLowerCase().includes(tok) && !/salaire/i.test(i.label)),
    expenses: s.expenses.filter((e) => !e.lump && e.label.toLowerCase().includes(tok)),
    liabilities: s.liabilities.filter((l) => l.securedBy === asset.key),
  };
}

export function properties(s: Snapshot): PropertyLinks[] {
  return s.assets.filter((a) => a.class === 'real_estate').map((a) => propertyLinks(s, a));
}

export const isWage = (i: Income) => !i.stable || /salaire/i.test(i.label);
/** Dépense qui disparaît à la retraite: impôts (remplacés par un taux), études des enfants. */
export const RETIREMENT_FACTOR: Record<RetirementMode, number> = { gone: 0, lower: 0.7, same: 1, higher: 1.3 };

/**
 * Ce que devient une dépense à la retraite, déduit de son nom et de sa catégorie quand l'utilisateur n'a rien choisi:
 * disparaissent les impôts (recalculés à part), les études, la garde et les dépenses des enfants; baissent les trajets;
 * augmentent la santé non remboursée, les vacances et les loisirs. Tout le reste est inchangé.
 */
/** Les impôts sur le revenu et la fortune sont recalculés à part à la retraite: ces lignes ne comptent jamais dans le budget. */
export const isTaxLine = (e: Expense): boolean => e.category === 'tax' || /^(expense:impots|imp[ôo]ts)/i.test(e.key) || /^imp[ôo]ts/i.test(e.label);

export function defaultRetirementMode(e: Expense): RetirementMode {
  const text = `${e.key} ${e.label} ${e.category}`;
  if (isTaxLine(e)) return 'gone';
  if (/[ée]tud|study|garde|childcare|enfant|[ée]tudiant/i.test(text)) return 'gone';
  if (/transports? publics|trajet|expense:transit/i.test(text)) return 'lower';
  if (/frais de sant[ée]|health-out|vacances|holidays|loisirs|leisure/i.test(text)) return 'higher';
  return 'same';
}

export const retirementMode = (e: Expense): RetirementMode => (isTaxLine(e) ? 'gone' : (e.retirement ?? defaultRetirementMode(e)));
export const retirementFactor = (e: Expense): number => RETIREMENT_FACTOR[retirementMode(e)];
const droppedAtRetirement = (e: Expense) => retirementFactor(e) === 0;

/** Rendement net (loyer moins charges) par franc de fonds propres: sert à choisir quel bien vendre en premier. */
function sellOrder(s: Snapshot): PropertyLinks[] {
  const yieldOf = (p: PropertyLinks) => {
    const rent = p.incomes.reduce((a, i) => a + i.monthly, 0) * 12;
    const cost = p.expenses.reduce((a, e) => a + e.monthly, 0) * 12;
    const equity = Math.max(1, p.asset.value - p.liabilities.reduce((a, l) => a + l.balance, 0));
    return (rent - cost) / equity;
  };
  const props = properties(s);
  // La résidence principale part en dernier; ensuite le bien qui rapporte le moins par franc de fonds propres.
  return props.sort((a, b) => Number(a.asset.subtype === 'home') - Number(b.asset.subtype === 'home') || yieldOf(a) - yieldOf(b));
}

export function simulateRetirement(s: Snapshot, p: RetirementParams = DEFAULT_PARAMS, asIn: Assumptions = DEFAULT_ASSUMPTIONS): RetirementResult {
  const asOf = new Date(s.asOf);
  const age0 = asOf.getFullYear() - s.household.birthYear;
  const as = resolvePhase(asIn, age0);
  const startYear = asOf.getFullYear();
  const R = Math.max(0, Math.round((p.retireAge - age0) * 12));
  const H = Math.max(R + 12, Math.round((p.endAge - age0) * 12));

  const liquidAssets = s.assets.filter((a) => a.class !== 'real_estate' && a.class !== 'pension');
  const pensionAssets = s.assets.filter((a) => a.class === 'pension').map((a) => (a.account === '401k' && p.rollover401k ? { ...a, haircut: 0.13 } : a));
  const props = properties(s);
  const order = sellOrder(s);
  /** Solde restant dû d'une dette à `t` mois: seul l'amortissement déclaré la réduit. */
  const owed = (l: Liability, t: number) => Math.max(0, l.balance - ((l.amortization ?? 0) * t) / 12);
  const rentKeys = new Set(props.filter((x) => x.asset.subtype !== 'home').flatMap((x) => x.incomes.map((i) => i.key)));
  const propKeys = new Set(props.map((x) => x.asset.key));
  const otherDebt = s.liabilities.filter((l) => !l.securedBy || !propKeys.has(l.securedBy)).reduce((a, l) => a + l.balance, 0);
  /** Fortune imposable à `t`: liquidités, valeur fiscale des biens non vendus, moins les dettes et la déduction. */
  const fortuneAt = (t: number, liq: number, soldNow: Set<string>): number => {
    let f = Math.max(0, liq) - otherDebt - COUNTRY.tax.wealthAllowance;
    for (const x of props) {
      if (soldNow.has(x.asset.key)) continue;
      f += valueAt(x.asset, t, as) * COUNTRY.tax.realEstateFiscalRatio - x.liabilities.reduce((d, l) => d + owed(l, t), 0);
    }
    return Math.max(0, f);
  };
  let replacementRent = 0;

  let liquid = liquidAssets.reduce((a, x) => a + x.value * (1 - x.haircut), 0);
  const liquidBase = liquid || 1;
  const poolRate = (inPhase: boolean) =>
    liquidAssets.reduce((a, x) => {
      const cls = x.growthLike ?? x.class;
      const g = x.realGrowth ?? (inPhase && as.phase ? as.phase.realGrowth[cls] : as.realGrowth[cls]) ?? 0;
      return a + x.value * (1 - x.haircut) * g;
    }, 0) / liquidBase;
  const monthlyBase = Math.pow(1 + Math.max(-0.5, poolRate(false)), 1 / 12) - 1;
  const monthlyPhase = Math.pow(1 + Math.max(-0.5, poolRate(true)), 1 / 12) - 1;
  const inPhaseAt = (t: number) => as.phase !== undefined && as.phase.fromYear !== undefined && t / 12 >= as.phase.fromYear && t / 12 < (as.phase.toYear ?? 0);
  /** Impôt sur la fortune déjà compris dans les impôts actuels: seule sa hausse s'ajoute avant la retraite. */
  const w0 = wealthTax(fortuneAt(0, liquid, new Set()));

  const sold = new Map<string, number>();
  const events: RetirementEvent[] = [];
  const rows: YearRow[] = [];
  const mk = (t: number) => ({ age: age0 + t / 12, year: startYear + Math.floor(t / 12) });

  const dropAtR = s.expenses.filter((e) => !e.lump && droppedAtRetirement(e));
  const autoBudget = s.expenses.filter((e) => !e.lump && isActive(e, R)).reduce((a, e) => a + e.monthly * retirementFactor(e), 0);
  const budget = p.monthlyBudget ?? autoBudget;
  void dropAtR;

  /** Valeur d'un avoir de prévoyance à `t`: capital qui croît, plus les cotisations versées jusqu'à la retraite. */
  const pensionValue = (a: Asset, t: number): number => {
    const base = valueAt(a, t, as);
    const c = a.contribution ?? 0;
    if (!c) return base;
    const n = Math.min(t, R);
    const cls = a.growthLike ?? a.class;
    const g = a.realGrowth ?? as.realGrowth[cls] ?? 0;
    const gP = a.realGrowth ?? as.phase?.realGrowth[cls] ?? g;
    const fn = compound(g, gP, n, as.phase);
    let sum = 0;
    for (let m = 1; m <= n; m++) sum += (c * fn) / Math.max(1e-9, compound(g, gP, m, as.phase));
    return base + sum;
  };

  const sell = (pl: PropertyLinks, t: number) => {
    if (sold.has(pl.asset.key)) return;
    const debt = pl.liabilities.reduce((a, l) => a + owed(l, t), 0);
    liquid += valueAt(pl.asset, t, as) * (1 - pl.asset.haircut) - debt;
    if (pl.asset.subtype === 'home') replacementRent += (valueAt(pl.asset, t, as) * p.replacementRentRate) / 12;
    sold.set(pl.asset.key, t);
    events.push({ ...mk(t), kind: 'sale', text: `Vente de ${pl.asset.label}` });
  };

  const scheduled = p.sales.map((x) => ({ key: x.key, t: Math.max(0, Math.round((x.age - age0) * 12)) }));
  let liquidityEndsAge: number | null = null;
  let brokeAge: number | null = null;
  let minLiquid = liquid;
  let pensionsReleased = false;

  for (let t = 0; t < H; t++) {
    // Vente prévue à cette date.
    for (const sc of scheduled) if (sc.t === t) {
      const pl = props.find((x) => x.asset.key === sc.key);
      if (pl) sell(pl, t);
    }
    // Avoirs de prévoyance versés à la retraite.
    if (t === R && !pensionsReleased) {
      pensionsReleased = true;
      const got = pensionAssets.reduce((a, x) => a + pensionValue(x, t) * (1 - x.haircut), 0);
      liquid += got;
      events.push({ ...mk(t), kind: 'retire', text: 'Retraite' });
      if (got > 0) events.push({ ...mk(t), kind: 'pension', text: 'Versement des avoirs de prévoyance (impôt de sortie déduit)' });
    }

    const soldKeys = new Set(sold.keys());
    const liveProps = props.filter((x) => !soldKeys.has(x.asset.key));
    const goneIncomes = new Set(props.filter((x) => soldKeys.has(x.asset.key)).flatMap((x) => x.incomes.map((i) => i.key)));
    const goneExpenses = new Set(props.filter((x) => soldKeys.has(x.asset.key)).flatMap((x) => x.expenses.map((e) => e.key)));

    // Revenus.
    let income = 0;
    let stableIncome = 0;
    for (const i of s.incomes) {
      if (goneIncomes.has(i.key) || !isActive(i, t)) continue;
      if (isWage(i)) {
        if (t >= R || t < p.salaryLossMonths) continue;
        income += i.monthly;
      } else {
        const m = rentKeys.has(i.key) ? i.monthly * (1 - p.vacancyRate) : i.monthly;
        income += m;
        stableIncome += m;
      }
    }

    if (p.unemploymentBenefit > 0 && t < Math.min(p.salaryLossMonths, p.unemploymentMonths)) income += p.unemploymentBenefit;

    // Dépenses, avec la dérive réelle du coût de la vie (santé surtout) par rapport aux prix.
    const drift = compound(as.expenseGrowth, as.phase?.expenseGrowth ?? as.expenseGrowth, t, as.phase);
    let spend = 0;
    if (t < R) {
      for (const e of s.expenses) {
        if (goneExpenses.has(e.key)) continue;
        if (e.lump) {
          if (e.lump.month === t) spend += e.lump.amount;
        } else if (isActive(e, t)) spend += e.monthly * drift;
      }
    } else {
      const saved = props.filter((x) => soldKeys.has(x.asset.key)).flatMap((x) => x.expenses).reduce((a, e) => a + e.monthly * retirementFactor(e), 0);
      spend += Math.max(0, budget - saved) * drift;
      for (const e of s.expenses) if (e.lump && e.lump.month === t) spend += e.lump.amount;
      if (p.detailedTax) {
        const rentalCosts = liveProps.filter((x) => x.asset.subtype !== 'home').flatMap((x) => x.expenses).reduce((a, e) => a + e.monthly, 0);
        const taxableIncome = Math.max(0, (stableIncome - rentalCosts) * 12 - COUNTRY.tax.retirementDeduction);
        spend += (incomeTax(taxableIncome) + wealthTax(fortuneAt(t, liquid, soldKeys))) / 12;
      } else {
        spend += stableIncome * p.retirementTaxRate;
      }
    }
    if (t < R && p.detailedTax) spend += Math.max(0, wealthTax(fortuneAt(t, liquid, soldKeys)) - w0) / 12;
    spend += replacementRent;
    // Hausse des taux sur la dette restante.
    {
      const live = new Set(liveProps.map((x) => x.asset.key));
      spend += s.liabilities
        .filter((l) => l.variable && (!l.securedBy || live.has(l.securedBy)))
        .reduce((a, l) => a + (owed(l, t) * (Math.max(0, p.normalRate - l.rate) + p.rateShock)) / 12, 0);
    }

    liquid = (liquid > 0 ? liquid * (1 + (inPhaseAt(t) ? monthlyPhase : monthlyBase)) : liquid) + income - spend;

    // Vente automatique quand les liquidités manquent.
    if (liquid < 0 && liquidityEndsAge === null) {
      liquidityEndsAge = mk(t).age;
      events.push({ ...mk(t), kind: 'liquidity', text: 'Les liquidités sont épuisées' });
    }
    if (p.autoSell) {
      for (const pl of order) {
        if (liquid >= 0) break;
        if (!sold.has(pl.asset.key)) sell(pl, t);
      }
    }
    if (liquid < 0 && (p.autoSell ? order.every((x) => sold.has(x.asset.key)) : false) && brokeAge === null) {
      brokeAge = mk(t).age;
      events.push({ ...mk(t), kind: 'broke', text: 'Même après la vente de tous les biens, il manque de l’argent' });
    }
    minLiquid = Math.min(minLiquid, liquid);

    if (t % 12 === 0) {
      const sk = new Set(sold.keys());
      const re = props.filter((x) => !sk.has(x.asset.key)).reduce((a, x) => a + valueAt(x.asset, t, as) - x.liabilities.reduce((d, l) => d + owed(l, t), 0), 0);
      const pen = !pensionsReleased ? pensionAssets.reduce((a, x) => a + pensionValue(x, t) * (1 - x.haircut), 0) : 0;
      rows.push({ ...mk(t), liquid, pensions: pen, realEstate: re, netWorth: liquid + pen + re, income, spending: spend });
    }
  }

  const last = rows[rows.length - 1];
  return {
    rows,
    events,
    liquidityEndsAge,
    brokeAge,
    budget,
    sold: [...sold.entries()].map(([key, t]) => ({ key, label: s.assets.find((a) => a.key === key)?.label ?? key, age: age0 + t / 12 })),
    finalNetWorth: last ? last.netWorth : 0,
    minLiquid,
  };
}

export type Verdict = 'ok' | 'sales' | 'short';

export interface Assessment {
  noSale: RetirementResult;
  withSales: RetirementResult;
  verdict: Verdict;
}

/** Deux passes: sans vendre de bien (hors ventes choisies), puis avec vente automatique si les liquidités manquent. */
export function assess(s: Snapshot, p: RetirementParams, as: Assumptions = DEFAULT_ASSUMPTIONS): Assessment {
  const noSale = simulateRetirement(s, { ...p, autoSell: false }, as);
  const withSales = simulateRetirement(s, { ...p, autoSell: true }, as);
  const verdict: Verdict = noSale.liquidityEndsAge === null ? 'ok' : withSales.brokeAge === null ? 'sales' : 'short';
  return { noSale, withSales, verdict };
}

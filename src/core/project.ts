import type { Fact } from './types';
import type { Asset, AssetClass, Certainty, Household, Snapshot } from '../engine/types';
import { toMonthly, type Frequency } from '../engine/frequency';
import { emptyRates, rateFor, toBase, type RateTable } from '../engine/fx';
import { accessProfile } from '../engine/accounts';
import { catalogEntry } from '../engine/catalog';

const DEFAULT_HOUSEHOLD: Household = {
  name: '',
  birthYear: 1980,
  adults: 1,
  children: 0,
  owner: false,
  retirementAge: 65,
};

/**
 * Hypothèses par classe d'actifs (mobilisation et décote). Valeurs de départ,
 * surchargeables fait par fait via data.liquidityMonths / data.haircut.
 * Les comptes de prévoyance passent par accessProfile (type de compte, âge).
 */
export function classProfile(
  cls: AssetClass,
  occupied: boolean,
): Pick<Asset, 'liquidityMonths' | 'haircut' | 'real'> {
  switch (cls) {
    case 'cash':
      return { liquidityMonths: 0, haircut: 0, real: false };
    case 'securities':
      return { liquidityMonths: 0, haircut: 0.1, real: true };
    case 'crypto':
      return { liquidityMonths: 0, haircut: 0.15, real: false };
    case 'real_estate':
      return { liquidityMonths: 60, haircut: occupied ? 0.25 : 0.1, real: true };
    case 'business':
      return { liquidityMonths: 36, haircut: 0.3, real: true };
    case 'pension':
      return { liquidityMonths: 0, haircut: 0.1, real: false }; // remplacé par accessProfile
    default:
      return { liquidityMonths: 12, haircut: 0.2, real: false };
  }
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);

/**
 * Faits vers instantané, à une date, avec une table de cours.
 * Seuls les faits confirmés ou supposés comptent: les propositions attendent la validation.
 * Tout montant est converti en CHF; un cours manquant est signalé et rend la ligne "supposée".
 */
export function project(facts: Fact[], asOf: Date = new Date(), rates: RateTable = emptyRates()): Snapshot {
  const iso = asOf.toISOString();
  const live = facts.filter(
    (f) =>
      (f.status === 'confirmed' || f.status === 'assumed') &&
      f.validFrom <= iso &&
      (f.validTo === null || f.validTo > iso),
  );
  const latest = new Map<string, Fact>();
  for (const f of live) {
    const cur = latest.get(f.key);
    if (!cur || f.recordedAt >= cur.recordedAt) latest.set(f.key, f);
  }
  const certainty = (f: Fact, extra = false): Certainty =>
    extra || f.status === 'assumed' || f.origin === 'default' || f.origin === 'inferred' ? 'assumed' : 'confirmed';

  const all = [...latest.values()];
  const hhFact = all.find((f) => f.kind === 'household');
  const hd = hhFact?.data ?? {};
  const household: Household = {
    name: str(hd.name, DEFAULT_HOUSEHOLD.name),
    birthYear: num(hd.birthYear, DEFAULT_HOUSEHOLD.birthYear),
    adults: num(hd.adults, DEFAULT_HOUSEHOLD.adults),
    children: num(hd.children, DEFAULT_HOUSEHOLD.children),
    owner: Boolean(hd.owner ?? DEFAULT_HOUSEHOLD.owner),
    retirementAge: num(hd.retirementAge, DEFAULT_HOUSEHOLD.retirementAge),
  };
  const age = asOf.getFullYear() - household.birthYear;
  const nowIdx = asOf.getFullYear() * 12 + asOf.getMonth();
  /** Fenêtre de validité dans le monde réel: années ou âges de début et de fin (fin incluse pour une année, exclue pour un âge). */
  const windowOf = (d: Record<string, unknown>): { startMonth?: number; endMonth?: number } => {
    let start: number | undefined;
    let end: number | undefined;
    if (typeof d.startYear === 'number') start = d.startYear * 12 + (typeof d.startMonth === 'number' ? d.startMonth - 1 : 0) - nowIdx;
    else if (typeof d.startAge === 'number') start = Math.round((d.startAge - age) * 12);
    if (typeof d.endYear === 'number') end = (d.endYear + 1) * 12 - nowIdx;
    else if (typeof d.endAge === 'number') end = Math.round((d.endAge - age) * 12);
    return { startMonth: start !== undefined && start > 0 ? start : undefined, endMonth: end };
  };

  const snap: Snapshot = {
    asOf: iso,
    base: 'CHF',
    rates,
    household,
    assets: [],
    liabilities: [],
    incomes: [],
    expenses: [],
    goals: [],
  };

  for (const f of all) {
    const d = f.data;
    switch (f.kind) {
      case 'asset': {
        const cls = str(d.class, 'other') as AssetClass;
        // Ordre de priorité: valeur saisie sur la ligne > profil du type (catalogue) > règle du compte > classe.
        const cat = catalogEntry(str(d.subtype) || undefined)?.profile;
        const base = classProfile(cls, Boolean(d.occupied ?? cat?.occupied));
        const acc = cls === 'pension' ? accessProfile(str(d.account) || str(d.subtype) || undefined, { age, retirementAge: household.retirementAge }) : undefined;
        const p = {
          ...(acc ? { liquidityMonths: acc.liquidityMonths, haircut: acc.haircut, real: acc.real } : base),
          ...(cat?.liquidityMonths !== undefined ? { liquidityMonths: cat.liquidityMonths } : {}),
          ...(cat?.haircut !== undefined ? { haircut: cat.haircut } : {}),
          ...(cat?.real !== undefined ? { real: cat.real } : {}),
        };
        const share = Math.min(1, Math.max(0, num(d.share, 1)));

        // Actif coté: quantité x cours du symbole. Sinon: montant x cours de la devise.
        const symbol = str(d.symbol) || undefined;
        const currency = str(d.currency, symbol ? 'USD' : 'CHF');
        let valueNative: number;
        let conv: { value: number; fx: number; missing: boolean };
        if (symbol) {
          const qty = num(d.quantity);
          const r = rateFor(rates, symbol);
          valueNative = qty;
          conv = r ? { value: qty * r.perUnit, fx: r.perUnit, missing: false } : { value: num(d.value), fx: 1, missing: true };
        } else {
          valueNative = num(d.value);
          conv = toBase(valueNative, currency, rates);
        }
        snap.assets.push({
          key: f.key,
          label: str(d.label),
          class: cls,
          value: conv.value * share,
          currency,
          valueNative,
          subtype: str(d.subtype) || undefined,
          share: share === 1 ? undefined : share,
          fx: conv.fx,
          rateMissing: conv.missing || undefined,
          symbol,
          quantity: symbol ? num(d.quantity) : undefined,
          account: str(d.account) || undefined,
          accessNote: acc?.why,
          growthLike: typeof d.growthLike === 'string' ? (d.growthLike as AssetClass) : (cat?.growthLike ?? acc?.growthLike),
          realGrowth: typeof d.realGrowth === 'number' ? d.realGrowth : undefined,
          contribution: typeof d.contribution === 'number' && d.contribution > 0 ? d.contribution : undefined,
          region: str(d.region, 'CH'),
          real: typeof d.real === 'boolean' ? d.real : p.real,
          liquidityMonths: num(d.liquidityMonths, p.liquidityMonths),
          haircut: num(d.haircut, p.haircut),
          certainty: certainty(f, conv.missing),
        });
        break;
      }
      case 'liability': {
        const currency = str(d.currency, 'CHF');
        const conv = toBase(num(d.balance), currency, rates);
        const lshare = Math.min(1, Math.max(0, num(d.share, 1)));
        snap.liabilities.push({
          key: f.key,
          label: str(d.label),
          share: lshare === 1 ? undefined : lshare,
          balance: conv.value * lshare,
          currency,
          balanceNative: num(d.balance),
          fx: conv.fx,
          rateMissing: conv.missing || undefined,
          rate: num(d.rate),
          variable: Boolean(d.variable),
          securedBy: typeof d.securedBy === 'string' ? d.securedBy : undefined,
          amortization: typeof d.amortization === 'number' && d.amortization > 0 ? d.amortization : undefined,
          certainty: certainty(f, conv.missing),
        });
        break;
      }
      case 'income': {
        const conv = toBase(toMonthly(num(d.amount), str(d.frequency, 'monthly') as Frequency), str(d.currency, 'CHF'), rates);
        snap.incomes.push({
          key: f.key,
          label: str(d.label),
          monthly: conv.value,
          stable: Boolean(d.stable),
          ...windowOf(d),
          certainty: certainty(f, conv.missing),
        });
        break;
      }
      case 'expense': {
        const once = d.frequency === 'once';
        const conv = toBase(once ? num(d.amount) : toMonthly(num(d.amount), str(d.frequency, 'monthly') as Frequency), str(d.currency, 'CHF'), rates);
        const w = windowOf(d);
        // Une dépense ponctuelle déjà passée ne pèse plus sur l'avenir.
        const rawStart = typeof d.startYear === 'number' ? d.startYear * 12 + (typeof d.startMonth === 'number' ? d.startMonth - 1 : 0) - nowIdx : undefined;
        const pastLump = once && rawStart !== undefined && rawStart < 0;
        snap.expenses.push({
          key: f.key,
          label: str(d.label),
          category: str(d.category, 'other'),
          // Une dépense ponctuelle n'est pas récurrente: elle ne pèse que le mois où elle tombe.
          monthly: once ? 0 : conv.value,
          essential: d.essential !== false,
          ...(['gone', 'lower', 'same', 'higher'].includes(str(d.retirement, '')) ? { retirement: str(d.retirement, '') as 'gone' | 'lower' | 'same' | 'higher' } : {}),
          ...(once ? { lump: { month: Math.max(0, w.startMonth ?? 0), amount: pastLump ? 0 : conv.value } } : { ...w }),
          certainty: certainty(f, conv.missing),
        });
        break;
      }
      case 'goal': {
        const conv = toBase(num(d.targetAmount), str(d.currency, 'CHF'), rates);
        const saved = toBase(num(d.saved), str(d.currency, 'CHF'), rates);
        snap.goals.push({
          key: f.key,
          label: str(d.label),
          targetAmount: conv.value,
          targetYear: num(d.targetYear),
          saved: saved.value,
          certainty: certainty(f, conv.missing),
        });
        break;
      }
    }
  }
  return snap;
}

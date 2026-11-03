/**
 * Estimation de la valeur d'un bien immobilier, sans aucune donnée externe: tout
 * vient de ce que l'utilisateur sait (prix d'achat, valeur fiscale, loyer, prix
 * au m² observé sur des biens comparables). On n'interroge jamais un service
 * avec l'adresse du bien, ce qui révélerait un actif.
 *
 * Le résultat est une FOURCHETTE avec le détail des méthodes, jamais un chiffre sec.
 */
export interface PropertyInput {
  purchasePrice?: number;
  purchaseYear?: number;
  /** Rapport entre la valeur d'aujourd'hui et le prix d'achat, si connu (par exemple 1,18). */
  indexSincePurchase?: number;
  /** Hausse annuelle supposée si aucun indice n'est donné. */
  annualAppreciation?: number;
  fiscalValue?: number;
  /** Dernière estimation connue du propriétaire (ou d'un tiers), avec son année: sert d'ancre, vieillie modestement. */
  ownerValue?: number;
  ownerValueYear?: number;
  /** Part de la valeur de marché que représente la valeur fiscale (varie fortement selon le canton). */
  fiscalRatio?: number;
  netRentAnnual?: number;
  capRate?: number;
  /** Surface habitable (m²). */
  areaM2?: number;
  /** Balcons et terrasses (m²), comptés pour une fraction de la surface habitable. */
  terraceM2?: number;
  /** Jardin privatif (m²), compté pour très peu. */
  gardenM2?: number;
  /** Cave, galetas, annexes (m²). */
  cellarM2?: number;
  /** Prix au m² observé sur des biens comparables, hors places de parc. */
  pricePerM2?: number;
  /** Dispersion relative des comparables (demi-écart interquartile / médiane): élargit la fourchette. */
  comparablesSpread?: number;
  /** Places de parc: nombre, et valeur unitaire si connue (sinon hypothèse indicative). */
  parkingIndoor?: number;
  parkingOutdoor?: number;
  parkingIndoorValue?: number;
  parkingOutdoorValue?: number;
  /** Travaux valorisants réalisés depuis l'achat (hors entretien courant), qui s'ajoutent à la base d'achat. */
  worksValue?: number;
  /** État général et situation: ajustent le prix au m² des comparables. */
  condition?: 'to_renovate' | 'to_refresh' | 'good' | 'renovated';
  situation?: 'noisy' | 'standard' | 'quiet_view';
}

export interface Comparable { price: number; areaM2: number }

/** Médiane et dispersion du prix au m² d'une liste de biens comparables saisis par l'utilisateur. */
export function comparablesStats(list: Comparable[]): { n: number; median: number; q1: number; q3: number; spread: number } | null {
  const v = list.filter((c) => c.price > 0 && c.areaM2 > 0).map((c) => c.price / c.areaM2).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const at = (p: number) => {
    const x = (v.length - 1) * p;
    const lo = Math.floor(x);
    return v[lo] + (v[Math.min(lo + 1, v.length - 1)] - v[lo]) * (x - lo);
  };
  const median = at(0.5);
  const q1 = at(0.25);
  const q3 = at(0.75);
  return { n: v.length, median, q1, q3, spread: v.length >= 3 ? (q3 - q1) / 2 / median : 0 };
}

/** Pondération des surfaces annexes par rapport à la surface habitable (usage courant, à ajuster selon la région). */
export const AREA_WEIGHTS = { terrace: 0.35, garden: 0.1, cellar: 0.25 };
export const CONDITION_FACTOR: Record<NonNullable<PropertyInput['condition']>, number> = { to_renovate: 0.85, to_refresh: 0.95, good: 1, renovated: 1.05 };
export const SITUATION_FACTOR: Record<NonNullable<PropertyInput['situation']>, number> = { noisy: 0.95, standard: 1, quiet_view: 1.05 };
/** Valeurs indicatives d'une place de parc, utilisées seulement si l'utilisateur n'en donne pas. */
export const PARKING_DEFAULT = { indoor: 35000, outdoor: 12000 };

/** Surface pondérée: habitable + fraction des balcons, jardin et annexes. */
export function weightedArea(i: PropertyInput): number {
  return (i.areaM2 ?? 0) + (i.terraceM2 ?? 0) * AREA_WEIGHTS.terrace + (i.gardenM2 ?? 0) * AREA_WEIGHTS.garden + (i.cellarM2 ?? 0) * AREA_WEIGHTS.cellar;
}

export function parkingValue(i: PropertyInput): { value: number; assumed: boolean } {
  const nIn = i.parkingIndoor ?? 0;
  const nOut = i.parkingOutdoor ?? 0;
  const assumed = (nIn > 0 && !i.parkingIndoorValue) || (nOut > 0 && !i.parkingOutdoorValue);
  return { value: nIn * (i.parkingIndoorValue ?? PARKING_DEFAULT.indoor) + nOut * (i.parkingOutdoorValue ?? PARKING_DEFAULT.outdoor), assumed };
}

export interface MethodResult {
  id: 'indexation' | 'estimation' | 'comparables' | 'fiscal' | 'rendement';
  label: string;
  value: number;
  /** Poids dans la valeur centrale. */
  weight: number;
  note: string;
}

export interface PropertyEstimate {
  low: number;
  central: number;
  high: number;
  methods: MethodResult[];
  certainty: 'low' | 'medium';
}

const DEFAULTS = { annualAppreciation: 0.02, fiscalRatio: 0.7, capRate: 0.035 };

export function estimateProperty(i: PropertyInput, now: Date = new Date()): PropertyEstimate | null {
  const methods: MethodResult[] = [];

  if (i.purchasePrice && i.purchasePrice > 0) {
    const works = i.worksValue && i.worksValue > 0 ? i.worksValue : 0;
    const base = i.purchasePrice + works;
    const withWorks = works ? `, travaux valorisants inclus (${Math.round(works).toLocaleString('de-CH')})` : '';
    if (i.indexSincePurchase && i.indexSincePurchase > 0) {
      methods.push({ id: 'indexation', label: 'Prix d’achat indexé', value: base * i.indexSincePurchase, weight: 0.5, note: `Indice fourni: ×${i.indexSincePurchase}${withWorks}` });
    } else if (i.purchaseYear) {
      const years = Math.max(0, now.getFullYear() - i.purchaseYear);
      const g = i.annualAppreciation ?? DEFAULTS.annualAppreciation;
      methods.push({ id: 'indexation', label: 'Prix d’achat indexé', value: base * Math.pow(1 + g, years), weight: 0.3, note: `${years} an${years > 1 ? 's' : ''} à ${(g * 100).toFixed(1)} % par an (hypothèse)${withWorks}` });
    }
  }
  if (i.ownerValue && i.ownerValue > 0) {
    const age = i.ownerValueYear ? Math.max(0, now.getFullYear() - i.ownerValueYear) : 0;
    const g = i.annualAppreciation ?? 0.01;
    methods.push({ id: 'estimation', label: 'Dernière estimation connue', value: i.ownerValue * Math.pow(1 + g, age), weight: 0.4, note: i.ownerValueYear ? `Estimation de ${i.ownerValueYear}, vieillie de ${age} an${age > 1 ? 's' : ''} à ${(g * 100).toFixed(1)} % par an (hypothèse prudente)` : 'Estimation fournie, non datée' });
  }
  if (i.areaM2 && i.pricePerM2 && i.areaM2 > 0 && i.pricePerM2 > 0) {
    const wa = weightedArea(i);
    const factor = (i.condition ? CONDITION_FACTOR[i.condition] : 1) * (i.situation ? SITUATION_FACTOR[i.situation] : 1);
    const park = parkingValue(i);
    const dwelling = wa * i.pricePerM2 * factor;
    const parts = [`${Math.round(wa * 10) / 10} m² pondérés (habitable ${i.areaM2}${wa !== i.areaM2 ? ' + annexes' : ''}) à ${Math.round(i.pricePerM2)} par m²`];
    if (factor !== 1) parts.push(`ajustement état et situation ${factor > 1 ? '+' : '−'}${Math.round(Math.abs(factor - 1) * 100)} %`);
    if (park.value > 0) parts.push(`places de parc ${Math.round(park.value).toLocaleString('de-CH')}${park.assumed ? ' (valeur indicative, à confirmer)' : ''}`);
    methods.push({ id: 'comparables', label: 'Biens comparables', value: dwelling + park.value, weight: 0.5, note: parts.join(', ') });
  }
  if (i.netRentAnnual && i.netRentAnnual > 0) {
    const cap = i.capRate ?? DEFAULTS.capRate;
    methods.push({ id: 'rendement', label: 'Capitalisation du loyer', value: i.netRentAnnual / cap, weight: 0.3, note: `Rendement net de ${(cap * 100).toFixed(1)} % (hypothèse)` });
  }
  if (i.fiscalValue && i.fiscalValue > 0) {
    const ratio = i.fiscalRatio ?? DEFAULTS.fiscalRatio;
    methods.push({ id: 'fiscal', label: 'Valeur fiscale relevée', value: i.fiscalValue / ratio, weight: 0.2, note: `La valeur fiscale vaut environ ${Math.round(ratio * 100)} % du marché (hypothèse, varie selon le canton)` });
  }
  if (methods.length === 0) return null;

  // Quand une méthode s'appuie sur le marché ou sur une estimation connue, les méthodes fondées sur une hypothèse
  // générique (hausse annuelle par défaut, rendement par défaut) pèsent peu et ne fixent plus la fourchette.
  const market = methods.some((m) => m.id === 'comparables');
  const anchored = market || methods.some((m) => m.id === 'estimation');
  const generic = (m: MethodResult) => (m.id === 'indexation' && !i.indexSincePurchase) || m.id === 'rendement';
  if (anchored) for (const m of methods) if (generic(m)) m.weight *= 0.3;
  // Des prix de marché observés l'emportent sur une estimation ancienne et sur les hypothèses génériques.
  if (market) {
    for (const m of methods) {
      if (m.id === 'comparables') m.weight = 0.7;
      else if (m.id === 'estimation') { m.weight = 0.05; m.note += '; poids réduit car des prix de marché sont disponibles'; }
      else if (generic(m)) m.weight = 0.03;
    }
  }
  const wSum = methods.reduce((a, m) => a + m.weight, 0);
  const central = methods.reduce((a, m) => a + m.value * m.weight, 0) / wSum;
  const values = (anchored ? methods.filter((m) => !generic(m) && !(market && m.id === 'estimation')) : methods).map((m) => m.value);
  // Une seule méthode: marge large. Plusieurs: la dispersion des méthodes, avec un minimum de 4 %.
  const margin = Math.max(values.length === 1 ? 0.12 : 0.04, i.comparablesSpread ?? 0);
  const low = Math.min(...values, central) * (1 - margin);
  const high = Math.max(...values, central) * (1 + margin);
  return { low, central, high, methods, certainty: methods.length >= 2 ? 'medium' : 'low' };
}

/** Valeur future en francs d'aujourd'hui, pour une hausse réelle annuelle donnée. */
export function projectValue(value: number, years: number, realAnnualGrowth: number): number {
  return value * Math.pow(Math.max(0, 1 + realAnnualGrowth), Math.max(0, years));
}

/** Reconstitue les données d'estimation d'un bien depuis les champs enregistrés (dont la liste de comparables). */
export function propertyInputFromData(d: Record<string, any>): PropertyInput {
  const num = (k: string) => (typeof d[k] === 'number' && Number.isFinite(d[k]) ? (d[k] as number) : undefined);
  const stats = Array.isArray(d.comparables) ? comparablesStats(d.comparables as Comparable[]) : null;
  const ppm2 = num('pricePerM2') ?? (stats && stats.n >= 2 ? Math.round(stats.median) : undefined);
  return {
    ownerValue: num('ownerValue') ?? (d.valueSource === 'owner_estimate' ? num('value') : undefined),
    ownerValueYear: num('ownerValueYear') ?? (/\b(20\d\d)\b/.exec(String(d.valueNote ?? ''))?.[1] ? Number(/\b(20\d\d)\b/.exec(String(d.valueNote))![1]) : undefined),
    purchasePrice: num('purchasePrice'), purchaseYear: num('purchaseYear'), worksValue: num('worksValue'), indexSincePurchase: num('indexSincePurchase'),
    fiscalValue: num('fiscalValue'), netRentAnnual: num('netRentAnnual'), areaM2: num('areaM2'), terraceM2: num('terraceM2'), gardenM2: num('gardenM2'), cellarM2: num('cellarM2'),
    pricePerM2: ppm2, comparablesSpread: num('pricePerM2') ? undefined : stats?.spread,
    parkingIndoor: num('parkingIndoor'), parkingOutdoor: num('parkingOutdoor'), parkingIndoorValue: num('parkingIndoorValue'), parkingOutdoorValue: num('parkingOutdoorValue'),
    condition: d.condition || undefined, situation: d.situation || undefined,
  };
}

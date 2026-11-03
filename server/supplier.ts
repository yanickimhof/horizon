import { normalizeLabel } from './statements';

/**
 * Un libellé bancaire dit « qui » et « pourquoi » dans un seul texte sale: nom, adresse, numéros, mention libre.
 * Le fournisseur est ce qu'une personne dirait à voix haute: « Migros », « CSS », « Intérêts hypothécaires, Osiris ».
 * Deux libellés du même fournisseur (autre magasin, autre adresse, autre numéro) donnent le même nom.
 */

const BRANDS: [RegExp, string][] = [
  [/\bcoop\b/i, 'Coop'],
  [/\bmigros\b|\bmigrolino\b/i, 'Migros'],
  [/\bdenner\b/i, 'Denner'],
  [/\baldi\b/i, 'Aldi'],
  [/\blidl\b/i, 'Lidl'],
  [/\bmanor\b/i, 'Manor'],
  [/\bvolg\b|\bspar\b/i, 'Épicerie de village'],
  [/parking|apcoa|parkingpay|parkpay/i, 'Parkings'],
  [/\bnotion\b/i, 'Notion'],
  [/apple\.com|\bapple\b/i, 'Apple'],
  [/\btesla\b/i, 'Tesla'],
  [/\bsalt\b/i, 'Salt'],
  [/swisscom/i, 'Swisscom'],
  [/sunrise/i, 'Sunrise'],
  [/romande energie/i, 'Romande Energie'],
  [/\bcss\b/i, 'CSS'],
  [/atupri/i, 'Atupri'],
  [/\baxa\b/i, 'AXA'],
  [/helsana/i, 'Helsana'],
  [/sanitas/i, 'Sanitas'],
  [/z[üu]rich versicherung|zurich insurance/i, 'Zurich Assurances'],
  [/\bsbb\b|\bcff\b/i, 'CFF'],
  [/booking\.com|\bbkg\b/i, 'Booking'],
  [/digitec|galaxus/i, 'Digitec Galaxus'],
  [/amazon/i, 'Amazon'],
  [/\bikea\b/i, 'IKEA'],
  [/hornbach/i, 'Hornbach'],
  [/\bjumbo\b/i, 'Jumbo'],
  [/\bfnac\b/i, 'Fnac'],
  [/\b(shell|avia|migrol|bp)\b/i, 'Carburant'],
  [/\btcs\b|touring club/i, 'TCS'],
  [/ca auto finance/i, 'CA Auto Finance'],
  [/\bpreply\b/i, 'Preply'],
  [/taxes pour|prix du paquet|tenue de compte|frais de compte|frais de carte/i, 'Frais bancaires'],
];

const LEGAL = /\b(s\.?a\.?r\.?l\.?|s\.?a\.?|ag|gmbh|inc\.?|ltd|llc|sagl|s\.?à\.?r\.?l\.?)(?=\s|$|,)/gi;
const CITY = /\b\d{4}\s+([A-Za-zÀ-ÿ'-]+(?:\s[A-Za-zÀ-ÿ'-]+)?)/;

/** Type d'une opération bancaire, d'après sa mention libre (intérêts, amortissement, leasing). */
function memoType(memo: string): string | null {
  const m = memo.toLowerCase();
  if (/amortis/.test(m)) return 'Amortissement hypothécaire';
  if (/int[ée]r[êe]ts?/.test(m) && /hypo|pr[êe]t/.test(m)) return 'Intérêts hypothécaires';
  if (/leasing/.test(m)) {
    const n = memo.match(/leasing\s*:?\s*(\d{4,})/i);
    return n ? `Leasing ${n[1]}` : 'Leasing';
  }
  if (/int[ée]r[êe]ts?/.test(m) && /compte|d[ée]bit/.test(m)) return 'Intérêts de compte';
  return null;
}

export interface Supplier {
  name: string;
  /** Texte libre après l'adresse, pour comprendre l'opération. */
  memo: string;
  self: boolean;
}

export function supplierOf(label: string, opts: { selfNames: string[]; bien?: string | null }): Supplier {
  let text = label
    .replace(/\s+Carte:.*$/i, '')
    .replace(/\[[A-Z]+\]/g, ' ')
    .replace(/\b\d{10,}\b/g, ' ')
    .replace(/^(?:d[ée]bit|cr[ée]dit|achat|paiement)\s+(?:twint\s+)?/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = text.split(',');
  const counterparty = parts[0].trim();
  const rest = parts.slice(1).join(',').trim();
  const cityMatch = rest.match(CITY) ?? text.match(CITY);
  const afterCity = cityMatch ? text.slice((text.indexOf(cityMatch[0]) >= 0 ? text.indexOf(cityMatch[0]) : 0) + cityMatch[0].length).replace(/^\s*CH\b/, '').trim() : rest;
  const memo = afterCity.replace(/\s+/g, ' ').trim();
  const cp = normalizeLabel(counterparty);
  const isSelf = /^(monsieur|madame)\b/.test(cp) || /&/.test(counterparty) || opts.selfNames.some((n) => n.length >= 3 && new RegExp(`\\b${n}\\b`).test(cp));

  const type = memoType(`${memo} ${rest}`);
  if (isSelf) {
    const base = type ?? (memo.length > 0 ? memo.slice(0, 40) : 'Virement personnel');
    return { name: opts.bien && !/\d{4,}/.test(base) ? `${base}, ${opts.bien}` : base, memo, self: true };
  }
  if (/^ppe\b/i.test(counterparty) && opts.bien) return { name: `Charges PPE, ${opts.bien}`, memo, self: false };
  if (type && /banque|raiffeisen|credit|crédit|ubs|bcv|postfinance|hypoth/i.test(counterparty + ' ' + rest) && type.startsWith('Int')) {
    return { name: opts.bien ? `${type}, ${opts.bien}` : type, memo, self: false };
  }

  const wholeForBrand = `${counterparty} ${rest}`;
  for (const [re, name] of BRANDS) if (re.test(counterparty) || (counterparty.length < 4 && re.test(wholeForBrand))) return { name, memo, self: false };

  // Nom nettoyé: sans forme juridique, sans numéro de magasin, sans la ville répétée dans l'adresse.
  let name = counterparty.replace(LEGAL, ' ').replace(/[-–]\s*\d+/g, ' ').replace(/\b\d{2,}\b/g, ' ').replace(/\([^)]*\)/g, ' ');
  const city = cityMatch?.[1] ?? rest.split(/\s+/).slice(0, 2).join(' ');
  for (const w of city.split(/\s+/).filter((x) => x.length > 3)) name = name.replace(new RegExp(`(?<!['’]|\\b(?:de|du|des|la|le|les|d|l)\\s)\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), ' ');
  name = name.replace(/\s+/g, ' ').trim();
  if (name.length < 2) name = counterparty;
  return { name: name.charAt(0).toUpperCase() + name.slice(1), memo, self: false };
}

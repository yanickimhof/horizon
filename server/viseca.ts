import { classify, type ParsedStatement, type Tx } from './statements';

/**
 * Factures de carte Visa émises par Viseca pour Banque Migros (et d'autres banques suisses): le texte du PDF suit un
 * format régulier, donc inutile de demander à un modèle de le lire. La lecture est exacte, gratuite, et reprend la
 * catégorie que la banque attribue à chaque achat. Le total de la facture sert de contrôle: si les lignes ne le
 * retrouvent pas, rien n'est enregistré.
 */

const num = (s: string): number => Number(s.replace(/['’\s]/g, ''));
const AMOUNT = /[\d'’]+\.\d{2}/;

/** Catégories de la banque (code commerçant) vers les catégories d'Horizon. L'ordre compte: la première règle gagne. */
const BANK_CATEGORIES: [RegExp, string][] = [
  [/restaurant|bistro|fast food|caf[ée]s?\b|bars?\b|traiteur|boulangeries?-p[âa]tisseries?/i, 'restaurants'],
  [/parkings?|garages?|redevances routi|station|carburant|p[ée]age|lavage|auto/i, 'vehicule'],
  [/supermarch|alimentation|surgel|boulang|boucher|[ée]picer|primeur|fromag|\bvins?\b|spiritueux/i, 'alimentation'],
  [/transports? publics|chemins? de fer|taxi|autobus|bus\b|trains?\b/i, 'transports'],
  [/agences? de voyage|h[ôo]tel|h[ée]bergement|a[ée]rien|location de voit|croisi|voyage/i, 'voyages'],
  [/chaussures|v[êe]tements|accessoires|mode\b|lingerie|bijou/i, 'vetements'],
  [/dentiste|orthodont|m[ée]dic|pharmac|h[ôo]pital|physio|chiropra|opticien|optique|sant[ée]|laboratoire/i, 'sante'],
  [/t[ée]l[ée]com|t[ée]l[ée]phon/i, 'telecom'],
  [/biens num[ée]riques|services it|informati|logiciel|programmation|streaming|abonnement|r[ée]seaux/i, 'abonnements'],
  [/bricolage|ameublement|meubles|jardin|pelouses|[ée]lectroniq|[ée]lectrom|grandes surfaces|d[ée]coration|quincaill|ordinateur|ventes? [ée]lectro|magasins? de mat[ée]riel/i, 'maison'],
  [/[ée]coles?|formation|enseignement|[ée]ducati/i, 'enfants'],
  [/divertissement|cin[ée]ma|sport|loisirs|mus[ée]e|jeux|fitness|spectacle|th[ée][âa]tre|parc/i, 'loisirs'],
  [/assurance/i, 'assurances'],
  [/bienfaisance|charit[ée]|dons?\b|organisations? (?:caritatives|religieuses)/i, 'dons'],
  [/cadeaux|souvenirs|fleur|d[ée]tail sp[ée]cialis[ée]s?|magasins? de d[ée]tail/i, 'quotidien'],
];

export function categoryFromBank(bank: string, label: string): string {
  // Quelques commerçants dont le code de la banque est trompeur.
  if (/tesla/i.test(label)) return 'vehicule';
  if (/booking\.com|airbnb/i.test(label)) return 'voyages';
  for (const [re, cat] of BANK_CATEGORIES) if (re.test(bank)) return cat;
  const c = classify(label, -1);
  return c.category === 'inconnu' ? 'quotidien' : c.category;
}

export interface VisecaBill {
  /** Montant total de la facture, tel qu'imprimé. */
  total: number | null;
  /** Somme des achats lus, nette des remboursements, sans le paiement de la facture précédente. */
  sum: number;
  reconciled: boolean | null;
  statements: ParsedStatement[];
  /** Précision sur une ligne déduite ou un petit écart accepté. */
  note?: string;
}

export function isVisecaBill(text: string): boolean {
  return /Viseca Payment Services/i.test(text) && /Montant total de la facture/i.test(text);
}

const STOP = /Total interm[ée]diaire|Total carte|Montant total de la facture|Report (?:total|de la carte)|Banque Migros SA|Recouvrement de la cr[ée]ance/;
const ENTRY = /(?=\b\d{2}\.\d{2}\.\d{2} \d{2}\.\d{2}\.\d{2} )/;

interface Entry {
  date: string;
  details: string;
  country: string;
  ccy?: string;
  foreign?: string;
  chf: number;
  credit: boolean;
  bank: string;
}

const AMT = /(?:\d{1,3}(?:['’]\d{3})+|\d+)\.\d{2}/g;
const FOREIGN = /\b([A-Z]{3}) ((?:\d{1,3}(?:['’]\d{3})+|\d+)\.\d{2}) ((?:\d{1,3}(?:['’]\d{3})+|\d+)\.\d{2})/;
const COUNTRIES = new Set(
  'CH FR DE IT ES PT GB AT NL BE US IE MY SG LU TH JP TR MA GR HR CY PL CZ HU SE NO DK FI CA AU AE HK CN ID VN PH MX BR MT SI SK RO BG IS LI MC AD ZA EG TN IL IN KR NZ LT LV EE UA RS ME AL MK BA GE AM QA SA CL AR PE CO CR DO JM BS UY TW KH LK NP MV MU SC KE TZ MG SN CI'.split(' '),
);

/**
 * Une opération: date, libellé, pays, éventuel montant en devise, montant en francs, catégorie de la banque.
 * L'ordre du texte extrait varie d'un PDF à l'autre (la catégorie peut précéder ou suivre le montant): on repère
 * les montants, puis le code du pays, et ce qui reste est la catégorie.
 */
function parseEntry(seg: string, carry: Set<number> = new Set()): Entry | null {
  const head = /^(\d{2})\.(\d{2})\.(\d{2}) \d{2}\.\d{2}\.\d{2} (.*)$/s.exec(seg);
  if (!head) return null;
  let body = head[4].replace(/Taux de conversion.*$/s, ' ').replace(/[•·]/g, ' ');
  // Le total reporté d'une page à l'autre peut se glisser dans la première ligne de la page suivante: on l'écarte.
  body = body.replace(new RegExp(AMT.source, 'g'), (m) => (carry.has(num(m)) ? ' ' : m));

  let ccy: string | undefined;
  let foreign: string | undefined;
  let chfText: string;
  let credit = false;
  const fx = FOREIGN.exec(body);
  if (fx) {
    ccy = fx[1];
    foreign = fx[2];
    chfText = fx[3];
    const end = (fx.index ?? 0) + fx[0].length;
    credit = /^\s*-/.test(body.slice(end));
    body = `${body.slice(0, fx.index)} ${body.slice(end).replace(/^\s*-/, ' ')}`;
  } else {
    const all = [...body.matchAll(AMT)];
    if (all.length === 0) {
      // Le montant s'est retrouvé ailleurs dans le texte extrait: la ligne est gardée, le montant se déduit du total.
      chfText = '';
    } else {
    // Un total reporté de la page précédente peut s'être glissé ici: il est toujours plus grand que l'achat lui-même.
    const m = all.reduce((a, b) => (num(b[0]) < num(a[0]) ? b : a));
    chfText = m[0];
    const end = (m.index ?? 0) + m[0].length;
    credit = /^\s*-/.test(body.slice(end));
    body = `${body.slice(0, m.index)} ${body.slice(end).replace(/^\s*-/, ' ')}`;
    }
  }
  body = body.replace(new RegExp(AMT.source, 'g'), ' ').replace(/\s+/g, ' ').trim();

  // Pays: premier mot de deux lettres qui est un code de pays (« VD CH »: VD est un canton, CH le pays).
  const tokens = [...body.matchAll(/(?:^|[\s-])([A-Z]{2})(?=\s|$)/g)];
  const hit = tokens.find((t) => COUNTRIES.has(t[1]));
  if (!hit) return null;
  const start = (hit.index ?? 0) + hit[0].length - 2;
  const details = body.slice(0, start).trim();
  const bank = body.slice(start + 2).trim();
  return { date: `20${head[3]}-${head[2]}-${head[1]}`, details, country: hit[1], ccy, foreign, chf: chfText ? num(chfText) : Number.NaN, credit, bank };
}

/** Le total est imprimé deux fois à la fin de la facture; l'ordre des montants voisins varie, on prend le plus répété. */
function totalOf(text: string): number | null {
  const i = text.search(/Montant total de la facture/i);
  if (i < 0) return null;
  const tail = text.slice(i, i + 600);
  const counts = new Map<number, number>();
  for (const m of tail.matchAll(AMT)) counts.set(num(m[0]), (counts.get(num(m[0])) ?? 0) + 1);
  if (counts.size === 0) return null;
  const best = [...counts.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0];
  return best[0];
}

export function parseVisecaBill(raw: string): VisecaBill | null {
  if (!isVisecaBill(raw)) return null;
  const text = raw.replace(/\s+/g, ' ');
  const total = totalOf(text);

  // Chaque page rappelle la carte courante: on suit les en-têtes de section dans l'ordre du texte.
  const headers = [...text.matchAll(/\d{4} \d{2}XX XXXX (\d{4}) Visa/g)].map((m) => ({ at: m.index ?? 0, last4: m[1] }));
  const cardAt = (pos: number): string => {
    let last4 = headers[0]?.last4 ?? '';
    for (const h of headers) if (h.at <= pos) last4 = h.last4;
    return last4 ? `Visa Basic Free ${last4}` : 'Carte Visa';
  };

  const carry = new Set<number>();
  for (const m of text.matchAll(/(?:Total interm[ée]diaire(?: de la carte)?|Report (?:total|de la carte)|Total carte[^\d]{0,60})\s*((?:\d{1,3}(?:['’]\d{3})+|\d+)\.\d{2})/g)) carry.add(num(m[1]));

  const byAccount = new Map<string, Tx[]>();
  const missing: Tx[] = [];
  let sum = 0;
  let offset = 0;
  for (const part of text.split(ENTRY)) {
    const at = offset;
    offset += part.length;
    const cut = part.search(STOP);
    const seg = (cut >= 0 ? part.slice(0, cut) : part).trim();
    if (!/^\d{2}\.\d{2}\.\d{2} \d{2}\.\d{2}\.\d{2} /.test(seg)) continue;
    const account = cardAt(at);
    const add = (tx: Tx) => byAccount.set(account, [...(byAccount.get(account) ?? []), tx]);

    const pay = /^(\d{2})\.(\d{2})\.(\d{2}) \d{2}\.\d{2}\.\d{2} Votre paiement - Merci ([\d'’]+\.\d{2})/.exec(seg);
    if (pay) {
      add({ account, date: `20${pay[3]}-${pay[2]}-${pay[1]}`, label: 'Votre paiement - Merci', amount: num(pay[4]), category: 'interne', source: 'regle', currency: 'CHF' });
      continue;
    }
    const e = parseEntry(seg, carry);
    if (!e) {
      // Une ligne qu'on ne sait pas lire fait échouer le contrôle du total plutôt que de passer inaperçue.
      sum += Number.NaN;
      continue;
    }
    const amount = e.credit ? e.chf : -e.chf;
    if (Number.isNaN(amount)) {
      const tx: Tx = { account, date: e.date, label: `${e.details} ${e.country}`.slice(0, 200), amount: 0, category: categoryFromBank(e.bank, e.details), source: 'banque', currency: 'CHF' };
      add(tx);
      missing.push(tx);
      continue;
    }
    const label = `${e.details} ${e.country}${e.ccy ? ` (${e.ccy} ${e.foreign})` : ''}`.slice(0, 200);
    add({ account, date: e.date, label, amount, category: categoryFromBank(e.bank, label), source: 'banque', currency: 'CHF' });
    sum += -amount;
  }

  let inferred = '';
  if (missing.length === 1 && total !== null && Number.isFinite(sum)) {
    const gap = Math.round((total - sum) * 100) / 100;
    if (gap > 0 && gap < 1000) {
      missing[0].amount = -gap;
      sum += gap;
      inferred = `montant de « ${missing[0].label} » déduit du total (${gap.toFixed(2)})`;
    }
  } else if (missing.length > 0) sum = Number.NaN;
  const statements = [...byAccount.entries()].map(([account, txs]) => ({ account, txs }));
  const count = statements.reduce((s, x) => s + x.txs.length, 0);
  if (count === 0) return null;
  const rounded = Number.isNaN(sum) ? Number.NaN : Math.round(sum * 100) / 100;
  const reconciled = Number.isNaN(rounded) ? false : total === null ? null : Math.abs(rounded - total) <= Math.max(0.05, total * 0.001);
  const gap = total === null || Number.isNaN(rounded) ? 0 : Math.round((rounded - total) * 100) / 100;
  const note = [inferred, reconciled && Math.abs(gap) > 0.05 ? `écart de ${gap.toFixed(2)} avec le total imprimé` : ''].filter(Boolean).join('; ');
  return { total, sum: rounded, reconciled, statements, note };
}

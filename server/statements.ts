import type { Snapshot } from '../src/engine/types';

/**
 * Analyse de relevés bancaires: lecture, classement par règles locales, détection des virements entre comptes,
 * moyennes mensuelles, récurrents, et écart avec les dépenses déjà connues d'Horizon.
 * Tout se fait ici, sur l'ordinateur. Seuls des libellés inconnus, sans montant, peuvent être envoyés à un modèle,
 * après accord (voir classifyUnknown dans api.ts).
 */

export const CATEGORIES: Record<string, string> = {
  interne: 'Virements entre comptes',
  revenu: 'Revenus',
  exceptionnel: 'Revenus exceptionnels (indemnité, vente, héritage)',
  doublon: 'Doublon de relevé',
  impots: 'Impôts',
  assurances: 'Assurances',
  logement: 'Immobilier: hypothèque, charges PPE, gérance',
  travaux: 'Travaux et rénovations',
  vehicule: 'Véhicules',
  quotidien: 'Vie courante, autre',
  alimentation: 'Alimentation',
  restaurants: 'Restaurants et cafés',
  abonnements: 'Abonnements et services numériques',
  telecom: 'Télécoms et hébergement',
  energie: 'Énergie, eau, chauffage',
  transports: 'Transports publics et taxis',
  voyages: 'Voyages et vacances',
  loisirs: 'Loisirs, sport, culture',
  vetements: 'Vêtements',
  maison: 'Maison, équipement, électronique',
  enfants: 'Enfants et études',
  dons: 'Cadeaux et dons',
  neobanque: 'Recharges Revolut et néobanques, détail manquant',
  carte: 'Cartes de crédit, détail manquant',
  epargne: 'Épargne et prévoyance',
  sante: 'Santé',
  famille: 'Transferts à la famille',
  banque: 'Frais bancaires',
  especes: 'Espèces et devises',
  autre: 'Autre',
  inconnu: 'À identifier',
};

export interface Tx {
  account: string;
  /** AAAA-MM-JJ */
  date: string;
  label: string;
  amount: number;
  category: string;
  source: 'regle' | 'paire' | 'ia' | 'memoire' | 'banque' | 'aucune';
  /** Devise de la ligne. Absente: franc suisse. */
  currency?: string;
}

export interface ParsedStatement {
  account: string;
  txs: Tx[];
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (c === ';' && !q) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

const DATE = /^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/;
export function isoDate(s: string): string | null {
  const m = DATE.exec(s);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${m[2]}-${m[1]}`;
}

const num = (s: string): number | null => {
  const t = s.replace(/[’']/g, '').replace(',', '.').trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
};

/** Règles par défaut, de la plus précise à la plus large. Le premier motif qui correspond l'emporte. */
const RULES: { category: string; re: RegExp; debitOnly?: boolean }[] = [
  { category: 'epargne', re: /parts?(?:\(s\))? sociales?(?:\(s\))?|soci[ée]tariat/i },
  { category: 'banque', re: /d[ée]bit des taxes|prix du paquet|taxe annuelle|tenue de compte|compartiment de coffre|frais de compte/i, debitOnly: true },
  { category: 'especes', re: /retrait au bancomat|retrait d.esp|bestellung bargeld|commande de devises|change de devises/i, debitOnly: true },
  { category: 'interne', re: /d[ée]p[oô]t au bancomat|distributeur automatique - versement/i },
  { category: 'interne', re: /hypoth[eè]ques?\s*:\s*chf/i },
  { category: 'interne', re: /^votre paiement\b.*merci/i },
  { category: 'epargne', re: /amortisation|roboforex|roboM\//i },
  { category: 'epargne', re: /3e? pilier|\b3a\b|pilier 3|libre passage|rachat|\bepl\b|fds? prev|fonds? de pr[ée]voyance|pr[ée]voyance/i },
  { category: 'impots', re: /office des imp|service des imp|etat de vaud|administration fiscale|acomptes? d.imp|imp[oô]ts?|^ville de |^commune d|steueramt/i },
  { category: 'assurances', re: /\bcss\b|\baxa\b|z[uü]rich (?:assurance|insurance|versicherung)|atupri|helsana|assura|sanitas|swica|allianz|mobili[èe]re|vaudoise|\btcs\b|\brega\b|protection juridique|assurance|versicherung|rechtsschutz|touring club|\bvz\b/i },
  { category: 'travaux', re: /serrurerie|menuiserie|[ée]lectricit[ée] g[ée]n|peinture|sanitaire|carrelage|toiture|jardinier|ma[çc]onnerie|charpent|isolation|chauffagiste|ferblanterie|vitrerie|[ée]tanch[ée]it[ée]|r[ée]novation/i, debitOnly: true },
  { category: 'logement', re: /hypoth|int[ée]r[êe]ts?\b|\bppe\b|copropri|g[ée]rance|naef|r[ée]gie|foncier|charges ppe|entretien|travaux/i, debitOnly: true },
  { category: 'carte', re: /d[ée]bit lsv|\blsv\b|viseca|cembra|mastercard|visa\b/i, debitOnly: true },
  { category: 'vehicule', re: /leasing|\bfca\b|garage|migrol|\bbp\b|shell|tamoil|avia|parking|ofrou|vignette|auto finance|\bamag\b|emil frey|service des automobiles/i, debitOnly: true },
  { category: 'sante', re: /dentiste|m[ée]decin|pharmac|h[ôo]pital|chuv|laboratoire|physio|clinic|dental|dentaire|orthodont|chiropract|ophtalm/i, debitOnly: true },
  { category: 'neobanque', re: /revolut|\bwise\b|\byuh\b|\bneon\b|\bn26\b/i, debitOnly: true },
  { category: 'abonnements', re: /netflix|spotify|disney|apple\.com|itunes|icloud|google\s?(one|play|storage|workspace)|youtube|amazon\s?prime|anthropic|claude\.ai|openai|chatgpt|adobe|microsoft|dropbox|playstation|steam|dazn|teleboy|zattoo|notion|github|1password|nordvpn|proton|canva|zoom|slack|linkedin|substack|audible|kindle|serafe|billag/i, debitOnly: true },
  { category: 'telecom', re: /swisscom|sunrise|\bsalt\b|\bupc\b|quickline|wingo|yallo|lebara|m-budget mobile|infomaniak|\bovh\b|gandi|namecheap|digital ?ocean/i, debitOnly: true },
  { category: 'energie', re: /romande [ée]nergie|services industriels|\bsig\b|\bekz\b|groupe e\b|[ée]lectricit|chauffage|mazout|holdigaz/i, debitOnly: true },
  { category: 'transports', re: /\bsbb\b|\bcff\b|\btl\b|\btpg\b|\bbls\b|postauto|uber(?! eats)|\btaxi\b|\bbolt\b|publibike|mobility|abonnement g[ée]n[ée]ral|flibco|flixbus/i, debitOnly: true },
  { category: 'voyages', re: /booking\.com|airbnb|h[ôo]tel|easyjet|swiss international|lufthansa|edelweiss|ryanair|expedia|tripadvisor|sncf|hertz|sixt|avis budget|eurostar|trainline|skyscanner|voyage/i, debitOnly: true },
  { category: 'restaurants', re: /restaurant|caf[ée](?![a-zà-ÿ])|brasserie|pizz|mcdonald|burger|kebab|sushi|starbucks|uber eats|just\s?eat|eat\.ch|smood|bistro|tea ?room|glacier/i, debitOnly: true },
  { category: 'alimentation', re: /\bcoop\b|migros(?! bank)|denner|aldi|lidl|volg|\bspar\b|boulang|boucher|primeur|fromag|picard|k kiosk|kiosk|caviste/i, debitOnly: true },
  { category: 'vetements', re: /h&m|zara|c&a|pkz|zalando|decathlon|v[êe]tement|chaussure|ochsner|mango|uniqlo|globus/i, debitOnly: true },
  { category: 'maison', re: /ikea|jumbo|hornbach|bauhaus|microspot|interdiscount|mediamarkt|\bfust\b|conforama|pfister|livique|brico|leroy merlin|digitec|galaxus|amazon|ali ?express|temu|brack|apple store/i, debitOnly: true },
  { category: 'loisirs', re: /intersport|cin[ée]ma|path[ée]|ticketcorner|fitness|gym\b|piscine|golf|skipass|mus[ée]e|th[ée][âa]tre|concert|bowling|escalade|swisspass|eventfrog|petzi/i, debitOnly: true },
  { category: 'enfants', re: /garderie|cr[èe]che|[ée]cole|jouets|toys|b[ée]b[ée]/i, debitOnly: true },
  { category: 'dons', re: /\bdon\b|fondation|croix-rouge|unicef|caritas|\bwwf\b|greenpeace|paraplég|cadeau|fleurs?\b/i, debitOnly: true },
  { category: 'voyages', re: /\s(?:IT|FR|DE|ES|PT|GB|AT|NL|US|BE|GR|HR|MY|SG|TH|JP|MA|TR)\s*(?:\(.*\))?$/, debitOnly: true },
  { category: 'quotidien', re: /twint|coop|migros|denner|aldi|lidl|manor|bancomat|retrait|restaurant|boulang|\bsbb\b|\bcff\b|\btl\b|\btpg\b/i, debitOnly: true },
  { category: 'famille', re: /^transfert\b/i, debitOnly: true },
];

export function classify(label: string, amount: number): { category: string; source: Tx['source'] } {
  for (const r of RULES) {
    if (r.debitOnly && amount > 0) continue;
    if (r.re.test(label)) return { category: r.category, source: 'regle' };
  }
  if (amount > 0) return { category: 'revenu', source: 'regle' };
  return { category: 'inconnu', source: 'aucune' };
}

/** Lit un relevé au format Migros: deux colonnes (date, libellé, montant, valeur) ou six (date, bénéficiaire, message, référence, montant, valeur). */
/**
 * Relevé Raiffeisen: IBAN;Booked At;Text;Credit/Debit Amount;Balance;Valuta Date. Les lignes de détail (adresse, motif)
 * ont une première colonne vide et complètent le libellé de la ligne précédente.
 */
/** Relevé ISO 20022 (camt.053), le format standard des banques suisses. */
function parseCamt(fileName: string, xml: string): ParsedStatement {
  const iban = /<IBAN>([^<]+)<\/IBAN>/.exec(xml)?.[1]?.replace(/\s/g, '') ?? '';
  const account = iban ? `Compte ${iban.slice(-4)}` : fileName.replace(/\.[a-z]+$/i, '');
  const txs: Tx[] = [];
  for (const m of xml.matchAll(/<Ntry>([\s\S]*?)<\/Ntry>/g)) {
    const e = m[1];
    const amt = /<Amt[^>]*Ccy="([A-Z]{3})"[^>]*>([\d.]+)<\/Amt>/.exec(e);
    const date = /<BookgDt>[\s\S]*?<(?:Dt|DtTm)>(\d{4}-\d{2}-\d{2})/.exec(e)?.[1];
    if (!amt || !date) continue;
    const credit = /<CdtDbtInd>CRDT<\/CdtDbtInd>/.test(e);
    const parts = [...e.matchAll(/<(?:Nm|Ustrd|AddtlNtryInf)>([^<]+)<\/(?:Nm|Ustrd|AddtlNtryInf)>/g)].map((x) => x[1].trim()).filter(Boolean);
    const label = [...new Set(parts)].join(' ') || 'Opération';
    const amount = (credit ? 1 : -1) * Number(amt[2]);
    const c = classify(label, amount);
    txs.push({ account, date, label, amount, category: c.category, source: c.source, currency: amt[1] });
  }
  return { account, txs };
}

function parseRaiffeisen(fileName: string, text: string): ParsedStatement {
  let account = fileName.replace(/\.[a-z]+$/i, '');
  const rows: { date: string; label: string; amount: number }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const c = splitCsv(raw);
    if (/^IBAN$/i.test(c[0] ?? '')) continue;
    if (c[0] && /^\d{4}-\d{2}-\d{2}/.test(c[1] ?? '')) {
      account = `Raiffeisen ${c[0].replace(/\s/g, '').slice(-4)}`;
      const amount = num(c[3] ?? '');
      if (amount === null || amount === 0) continue;
      rows.push({ date: c[1].slice(0, 10), label: c[2] ?? '', amount });
    } else if (!c[0] && rows.length > 0 && (c[2] ?? '').trim()) {
      rows[rows.length - 1].label += ` ${c[2].trim()}`;
    }
  }
  const txs: Tx[] = rows.map((r) => {
    const cl = classify(r.label, r.amount);
    return { account, date: r.date, label: r.label, amount: r.amount, category: cl.category, source: cl.source };
  });
  return { account, txs };
}

export function parseStatement(fileName: string, text: string): ParsedStatement {
  if (/^\s*<\?xml/i.test(text) && /camt\.05[234]/i.test(text.slice(0, 2000))) return parseCamt(fileName, text);
  if (/^\s*"?IBAN"?;\s*"?Booked At/i.test(text.slice(0, 300))) return parseRaiffeisen(fileName, text);
  const lines = text.split(/\r?\n/);
  let account = fileName.replace(/\.[a-z]+$/i, '');
  const txs: Tx[] = [];
  for (const raw of lines) {
    const desc = /^\s*"?Description\s*:\s*([^;"]+)/i.exec(raw);
    if (desc) {
      account = desc[1].trim();
      continue;
    }
    const cells = splitCsv(raw);
    const date = isoDate(cells[0] ?? '');
    if (!date) continue;
    let label: string;
    let amount: number | null;
    if (cells.length >= 5) {
      label = [cells[1], cells[2]].filter(Boolean).join(' ');
      amount = num(cells[4]);
    } else {
      label = cells[1] ?? '';
      amount = num(cells[2] ?? '');
    }
    if (amount === null) continue;
    const c = classify(label, amount);
    txs.push({ account, date, label, amount, category: c.category, source: c.source });
  }
  return { account, txs };
}

const dayNumber = (iso: string): number => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86_400_000);

/** Un débit et un crédit de même montant sur deux comptes, à trois jours d'écart au plus: virement entre comptes. */
export function pairInternalTransfers(txs: Tx[]): number {
  const credits = txs.filter((t) => t.amount > 0);
  const used = new Set<Tx>();
  let n = 0;
  for (const d of txs.filter((t) => t.amount < 0).sort((a, b) => a.date.localeCompare(b.date))) {
    const c = credits.find((x) => !used.has(x) && x.account !== d.account && Math.abs(x.amount + d.amount) < 0.005 && Math.abs(dayNumber(x.date) - dayNumber(d.date)) <= 3);
    if (!c) continue;
    used.add(c);
    d.category = 'interne';
    d.source = 'paire';
    c.category = 'interne';
    c.source = 'paire';
    n++;
  }
  return n;
}

/**
 * Signature d'un paiement: libellé réduit et montant. C'est ce que l'utilisateur classe une fois pour toutes
 * (par exemple « Paiement 1644.95 » = impôts), et qui est ensuite appliqué à chaque relevé.
 */
export const signatureKey = (label: string, amount: number): string => `${normalizeLabel(label)}|${Math.abs(amount).toFixed(2)}`;

/** Émetteur d'une ligne: le nom avant la première virgule, sans chiffres ni références. */
export const payeeName = (label: string): string => normalizeLabel(label.split(',')[0]).slice(0, 30).trim();
/** Clé de mémoire pour tous les montants d'un même émetteur. */
export const payeeKey = (label: string): string => `payee:${payeeName(label)}`;
/** Des libellés trop génériques pour mémoriser un émetteur (« Paiement », « Virement »...). */
export const isGenericPayee = (label: string): boolean => payeeName(label).length < 4 || /^(paiement|virement|transfert|retrait|achat|d[ée]bit|cr[ée]dit|entr[ée]e|ordre|e-banking|twint|facture)\b/.test(payeeName(label)) && payeeName(label).split(' ').length <= 2;

/** Applique les classements mémorisés. La décision de l'utilisateur l'emporte sur les règles. */
export function applySignatures(txs: Tx[], memory: Record<string, string>): number {
  let n = 0;
  for (const t of txs) {
    // Le classement exact (même libellé, même montant) passe avant celui de l'émetteur (tous les montants).
    const c = memory[signatureKey(t.label, t.amount)] ?? memory[payeeKey(t.label)];
    if (c && c in CATEGORIES && c !== 'inconnu') {
      t.category = c;
      t.source = 'memoire';
      n++;
    }
  }
  return n;
}

/** Libellé réduit à ce qui identifie le commerçant: sans chiffres longs ni références. */
export function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/\d{4,}/g, '').replace(/[+]?\d[\d ]{6,}/g, '').replace(/\s+/g, ' ').trim();
}

export const HORIZON_GROUPS: { key: string; label: string; stmt: string[]; horizon: (c: string) => boolean }[] = [
  { key: 'assurances', label: 'Assurances', stmt: ['assurances'], horizon: (c) => c === 'insurance' },
  { key: 'impots', label: 'Impôts', stmt: ['impots'], horizon: (c) => c === 'tax' },
  { key: 'logement', label: 'Immobilier', stmt: ['logement', 'travaux'], horizon: (c) => c === 'housing' },
  { key: 'vehicule', label: 'Véhicules', stmt: ['vehicule'], horizon: (c) => c === 'transport' },
  { key: 'vie', label: 'Vie courante, santé, famille, autre', stmt: ['quotidien', 'alimentation', 'restaurants', 'abonnements', 'telecom', 'energie', 'transports', 'voyages', 'loisirs', 'vetements', 'maison', 'enfants', 'dons', 'neobanque', 'carte', 'sante', 'famille', 'banque', 'especes', 'autre', 'inconnu'], horizon: (c) => !['insurance', 'tax', 'housing', 'transport'].includes(c) },
];

export interface Report {
  accounts: { name: string; count: number; from: string; to: string }[];
  from: string;
  to: string;
  months: number;
  categories: { key: string; label: string; total: number; monthly: number; count: number }[];
  income: { total: number; monthly: number };
  internal: { count: number; total: number };
  recurring: { key: string; label: string; amount: number; months: number; category: string }[];
  unknown: { count: number; total: number; samples: { key: string; label: string; amount: number; count: number; total: number }[] };
  vsHorizon: { key: string; label: string; statements: number; horizon: number; gap: number }[];
  ai: { used: boolean; labels: number; costChf: number; note?: string };
}

/** Fenêtre de douze mois se terminant à la dernière date du relevé. */
function windowOf(txs: Tx[]): { from: string; to: string; months: number } {
  const to = txs.reduce((m, t) => (t.date > m ? t.date : m), '0000-00-00');
  const end = new Date(to + 'T00:00:00Z');
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));
  const from = start.toISOString().slice(0, 10);
  const first = txs.reduce((m, t) => (t.date < m ? t.date : m), '9999-99-99');
  const real = first > from ? first : from;
  const a = new Date(real + 'T00:00:00Z');
  const months = Math.max(1, Math.min(12, (end.getUTCFullYear() - a.getUTCFullYear()) * 12 + end.getUTCMonth() - a.getUTCMonth() + 1));
  return { from: real, to, months };
}

export function buildReport(statements: ParsedStatement[], snapshot: Snapshot | null, ai: Report['ai'] = { used: false, labels: 0, costChf: 0 }): Report {
  const all = statements.flatMap((s) => s.txs);
  if (all.length === 0) {
    return { accounts: [], from: '', to: '', months: 0, categories: [], income: { total: 0, monthly: 0 }, internal: { count: 0, total: 0 }, recurring: [], unknown: { count: 0, total: 0, samples: [] }, vsHorizon: [], ai };
  }
  const w = windowOf(all);
  const txs = all.filter((t) => t.date >= w.from);
  const byCat = new Map<string, { total: number; count: number }>();
  let income = 0;
  let internalTotal = 0;
  let internalCount = 0;
  for (const t of txs) {
    if (t.category === 'interne') {
      if (t.amount < 0) {
        internalTotal += -t.amount;
        internalCount++;
      }
      continue;
    }
    if (t.amount > 0) {
      income += t.amount;
      continue;
    }
    const e = byCat.get(t.category) ?? { total: 0, count: 0 };
    e.total += -t.amount;
    e.count++;
    byCat.set(t.category, e);
  }
  const categories = [...byCat.entries()]
    .map(([key, v]) => ({ key, label: CATEGORIES[key] ?? key, total: v.total, monthly: v.total / w.months, count: v.count }))
    .sort((a, b) => b.total - a.total);

  // Récurrents: même libellé et même montant dans au moins trois mois différents.
  const rec = new Map<string, { label: string; amount: number; months: Set<string>; category: string }>();
  for (const t of txs) {
    if (t.amount >= 0 || t.category === 'interne') continue;
    const k = `${normalizeLabel(t.label)}|${(-t.amount).toFixed(2)}`;
    const e = rec.get(k) ?? { label: t.label, amount: -t.amount, months: new Set<string>(), category: t.category };
    e.months.add(t.date.slice(0, 7));
    rec.set(k, e);
  }
  const recurring = [...rec.values()]
    .filter((r) => r.months.size >= 3)
    .map((r) => ({ key: signatureKey(r.label, r.amount), label: r.label, amount: r.amount, months: r.months.size, category: r.category }))
    .sort((a, b) => b.amount * b.months - a.amount * a.months)
    .slice(0, 15);

  const unk = new Map<string, { label: string; amount: number; count: number; total: number }>();
  for (const t of txs) {
    if (t.category !== 'inconnu' || t.amount >= 0) continue;
    const k = signatureKey(t.label, t.amount);
    const e = unk.get(k) ?? { label: t.label, amount: -t.amount, count: 0, total: 0 };
    e.count++;
    e.total += -t.amount;
    unk.set(k, e);
  }
  const unknownList = [...unk.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.total - a.total);

  const horizonByGroup = (g: (typeof HORIZON_GROUPS)[number]): number =>
    snapshot ? snapshot.expenses.filter((e) => !e.lump && g.horizon(e.category)).reduce((s, e) => s + e.monthly, 0) : 0;
  const vsHorizon = HORIZON_GROUPS.map((g) => {
    const stmt = g.stmt.reduce((s, k) => s + (byCat.get(k)?.total ?? 0), 0) / w.months;
    const hz = horizonByGroup(g);
    return { key: g.key, label: g.label, statements: stmt, horizon: hz, gap: stmt - hz };
  });

  const accounts = statements.map((s) => ({
    name: s.account,
    count: s.txs.length,
    from: s.txs.reduce((m, t) => (t.date < m ? t.date : m), '9999-99-99'),
    to: s.txs.reduce((m, t) => (t.date > m ? t.date : m), '0000-00-00'),
  }));

  return {
    accounts,
    from: w.from,
    to: w.to,
    months: w.months,
    categories,
    income: { total: income, monthly: income / w.months },
    internal: { count: internalCount, total: internalTotal },
    recurring,
    unknown: { count: unknownList.reduce((s, u) => s + u.count, 0), total: unknownList.reduce((s, u) => s + u.total, 0), samples: unknownList.slice(0, 10) },
    vsHorizon,
    ai,
  };
}

/** Extrait de la réponse d'un modèle un objet JSON {numéro: catégorie}, en ignorant tout le reste. */
export function parseAiCategories(text: string, n: number): Record<number, string> {
  const out: Record<number, string> = {};
  const accept = (k: string, v: unknown) => {
    const i = Number(k);
    if (Number.isInteger(i) && i >= 1 && i <= n && typeof v === 'string' && v in CATEGORIES && !['interne', 'inconnu', 'doublon', 'exceptionnel', 'revenu'].includes(v)) out[i] = v;
  };
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0) return out;
  try {
    const obj = JSON.parse(text.slice(a, b + 1)) as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) accept(k, v);
  } catch {
    // Réponse coupée ou mal formée: on garde les paires complètes.
    for (const m of text.matchAll(/"(\d+)"\s*:\s*"([a-z]+)"/g)) accept(m[1], m[2]);
  }
  return out;
}

export const AI_CATEGORY_HELP = Object.entries(CATEGORIES)
  .filter(([k]) => k !== 'interne' && k !== 'inconnu' && k !== 'revenu')
  .map(([k, v]) => `${k}: ${v}`)
  .join('; ');

/**
 * Reconnaissance du pays, de l'année et du type d'un document, à partir de son
 * chemin et de son texte. Heuristique et prudente: sans indice net, on ne devine pas.
 * Ces métadonnées servent à repérer les années manquantes et à orienter les réponses
 * (par exemple, comparer des déclarations d'impôts de plusieurs années).
 */
export type DocType = 'tax-return' | 'payslip' | 'bank' | 'pension' | 'mortgage' | 'insurance' | 'valuation' | 'crypto' | 'other';
export type Country = 'CH' | 'US' | 'FR' | 'DE' | 'UK' | 'other';

export interface DocMeta {
  year?: number;
  country?: Country;
  type?: DocType;
}

const THIS_YEAR = new Date().getFullYear();

const TYPE_RULES: [DocType, RegExp][] = [
  ['tax-return', /d[ée]claration\s+d.imp[oô]t|taxation|avis\s+de\s+taxation|steuererkl[äa]rung|steuerveranlagung|\b1040\b|tax\s+(return|assessment)|\bform\s*1040|\bw-?2\b|\b1099\b|\bk-?1\b/i],
  ['payslip', /fiche\s+de\s+(salaire|paie)|certificat\s+de\s+salaire|lohnausweis|payslip|pay\s*stub/i],
  ['pension', /certificat\s+de\s+pr[ée]voyance|\blpp\b|\b3a\b|\b3e\s+pilier|vorsorge|pensionskasse|\b401\s?\(?k\)?|\bira\b|roth/i],
  ['mortgage', /hypoth[èe]que|mortgage|hypothek|d[ée]compte\s+d.int[ée]r[êe]ts|\bsaron\b/i],
  ['valuation', /estimation|expertise|valeur\s+v[ée]nale|valuation|sch[äa]tzung|gutachten/i],
  ['insurance', /police\s+d.assurance|\blamal\b|prime\s+d.assurance|insurance|versicherung|assurance/i],
  ['crypto', /wallet|coinbase|binance|kraken|\bbitcoin\b|\bethereum\b|ledger\s+nano/i],
  ['bank', /relev[ée]\s+(de\s+compte|bancaire)|extrait\s+de\s+compte|bank\s+statement|account\s+statement|kontoauszug|\biban\b|\bstatement\b/i],
];

const COUNTRY_RULES: [Country, RegExp][] = [
  ['US', /\birs\b|internal\s+revenue|\b1040\b|\bw-?2\b|\b1099\b|\b401\s?\(?k\)?|\bira\b|\broth\b|\bfbar\b|\bssn\b|\bsocial\s+security\b|\b(usa|united\s+states|états-unis)\b|(^|[\\/])us([\\/ _.-]|$)/i],
  ['CH', /\bavs\b|\blpp\b|\b3a\b|\bcanton\b|steuer|imp[oô]ts?\s+(f[ée]d[ée]raux|cantonaux)|\bchf\b|suisse|schweiz|switzerland|\b(vaud|gen[èe]ve|zurich|fribourg|valais|berne|neuch[âa]tel)\b|(^|[\\/])ch([\\/ _.-]|$)/i],
  ['FR', /\bdgfip\b|imp[oô]ts\.gouv|\burssaf\b|r[ée]publique\s+fran[çc]aise|\bfrance\b/i],
  ['DE', /\bfinanzamt\b|\bdeutschland\b|\bsteuer-id\b/i],
  ['UK', /\bhmrc\b|united\s+kingdom|\bp60\b|self\s+assessment/i],
];

/** Année la plus plausible, privilégiant le nom du fichier, puis un libellé de période dans le texte. */
function inferYear(path: string, text: string): number | undefined {
  const ok = (y: number) => y >= 1990 && y <= THIS_YEAR + 1;
  const fromName = [...path.matchAll(/(?<!\d)(19[9]\d|20[0-4]\d)(?!\d)/g)].map((m) => Number(m[1])).filter(ok);
  if (fromName.length) return fromName[fromName.length - 1];
  const labelled = /(?:p[ée]riode\s+fiscale|ann[ée]e\s+fiscale|steuerperiode|tax\s+year|exercice|taxation\s+(?:de\s+l.ann[ée]e\s+)?)[^\d]{0,15}(19[9]\d|20[0-4]\d)/i.exec(text);
  if (labelled && ok(Number(labelled[1]))) return Number(labelled[1]);
  return undefined;
}

export function inferMeta(relPath: string, text = ''): DocMeta {
  const head = text.slice(0, 4000); // les premières pages suffisent à reconnaître un document
  const hay = `${relPath}\n${head}`;
  const meta: DocMeta = {};
  const year = inferYear(relPath, head);
  if (year) meta.year = year;
  for (const [t, re] of TYPE_RULES) if (re.test(hay)) { meta.type = t; break; }
  // Un indice de pays dans le chemin (dossier "US", "CH") prime sur le texte.
  const pathCountry = COUNTRY_RULES.find(([, re]) => re.test(relPath))?.[0];
  const textCountry = COUNTRY_RULES.find(([, re]) => re.test(head))?.[0];
  const country = pathCountry ?? textCountry;
  if (country) meta.country = country;
  return meta;
}

export const TYPE_LABELS: Record<DocType, string> = {
  'tax-return': 'Déclaration ou taxation',
  payslip: 'Salaire',
  bank: 'Relevé bancaire',
  pension: 'Prévoyance',
  mortgage: 'Hypothèque',
  insurance: 'Assurance',
  valuation: 'Estimation',
  crypto: 'Crypto',
  other: 'Autre',
};

import { readFileSync } from 'node:fs';
import type { Ledger } from './ledger';
import { claude } from './usage';
import { EgressBlocked, getTerms } from './egress';
import { restoreDeep } from '../src/core/pseudonym';
import { validateData } from '../src/core/schema';
import type { FactKind } from '../src/core/types';
import type { ManifestEntry } from './intake';

/**
 * Lecture d'un document déjà masqué par un modèle (Haiku): il en tire des faits à valider, jamais des faits confirmés.
 * Ce qui part: le texte masqué (noms, adresses, IBAN, numéros remplacés), tronqué. Les montants restent, car ils sont l'objet.
 * Ce qui revient est restauré localement (jetons remplacés par les vrais noms), puis déposé dans « À valider ».
 */
const MAX_CHARS = 14_000;
const KINDS: FactKind[] = ['household', 'asset', 'liability', 'income', 'expense', 'goal'];

export interface Proposal {
  kind: FactKind | 'note';
  key: string;
  data: Record<string, unknown>;
  excerpt?: string;
  text?: string;
}

const HINT: Record<string, string> = {
  'tax-return': 'Déclaration ou taxation d’impôts. Ne propose PAS de faits. Propose une seule note (kind "note") qui commence par « Année fiscale AAAA: » (la période fiscale concernée, pas la date du document) et résume: revenu imposable, fortune imposable, impôt cantonal et communal, impôt fédéral direct, solde à payer ou acomptes. Précise s’il s’agit d’une déclaration, d’une décision de taxation ou d’un avis d’acomptes.',
  payslip: 'Fiche de salaire. Propose un revenu (income) net mensuel, stable false, et le bonus s’il est indiqué.',
  bank: 'Relevé bancaire. Propose les soldes de comptes (asset, class cash) et les charges fixes récurrentes évidentes (expense).',
  pension: 'Document de prévoyance. Propose l’avoir (asset, class pension, account lpp ou 3a), la cotisation d’épargne par mois (contribution), les rentes projetées (income, startAge).',
  mortgage: 'Hypothèque. Propose chaque dette (liability): balance, rate, variable true ou false, et l’amortissement annuel (amortization) s’il existe.',
  insurance: 'Assurance. Propose la prime (expense) avec sa fréquence, ou la valeur de rachat (asset) pour une assurance vie.',
  valuation: 'Estimation immobilière. Propose la valeur du bien (asset, class real_estate, subtype rental ou home).',
  crypto: 'Cryptomonnaies. Propose un actif (asset, class crypto) par monnaie, avec symbol et quantity.',
};

const SYSTEM = `Tu lis un document financier suisse déjà anonymisé (les noms, adresses et numéros sont remplacés par des jetons comme [PERSONNE_1]).
Tu proposes des faits pour une application de patrimoine. Réponds uniquement par un tableau JSON, sans texte autour, de 25 éléments au plus.
Chaque élément: {"kind": "asset|liability|income|expense|household|goal|note", "key": "type:identifiant-en-minuscules", "data": {...}, "excerpt": "citation courte"}.
Champs de data selon kind (montants en CHF, nombres purs, sans apostrophes):
- asset: label, class (cash|securities|crypto|real_estate|pension|business|other), value, currency, subtype, account (lpp|3a|401k), contribution (par mois, prévoyance).
- liability: label, balance, rate (0.0154 pour 1,54 %), variable (true|false), securedBy (clé du bien si connue).
- income: label, amount, frequency (monthly|annual), stable (true|false), startAge (rente future).
- expense: label, category, amount, frequency (monthly|annual), essential (true|false).
- note: seulement {"text": "..."} dans data.
Règles: ne propose que ce qui est écrit dans le document. Les montants fixés à la signature d’un contrat (prix d’achat, financement initial, valeur à la livraison) ne sont pas des soldes ni des valeurs actuelles: ne les propose pas comme asset ou liability, sauf si le document date de moins d’un an. Pour un leasing, propose uniquement la mensualité (expense) et une note avec la durée, la valeur résiduelle et la date de fin. Pour une assurance, propose la prime (expense). Un fait déjà évident dans un autre fait du même document n’est pas répété. N'invente aucun chiffre. Omets les champs inconnus. L'excerpt reprend au plus 100 caractères du document, sans nom ni numéro de compte. Si le document ne contient rien d'utile, réponds [].`;

/** Extrait un tableau JSON d'une réponse, même entourée de texte ou de balises de code. */
export function parseProposals(text: string): Proposal[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: Proposal[] = [];
  for (const it of raw.slice(0, 25)) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const data = o.data && typeof o.data === 'object' && !Array.isArray(o.data) ? (o.data as Record<string, unknown>) : {};
    const excerpt = typeof o.excerpt === 'string' ? o.excerpt.slice(0, 160) : undefined;
    if (o.kind === 'note') {
      const text = typeof data.text === 'string' ? data.text.trim() : '';
      if (text) out.push({ kind: 'note', key: 'note', data, text, excerpt });
      continue;
    }
    if (!KINDS.includes(o.kind as FactKind) || typeof o.key !== 'string' || !o.key.includes(':')) continue;
    const kind = o.kind as FactKind;
    if (validateData(kind, data).length > 0) continue;
    out.push({ kind, key: o.key.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '-'), data, excerpt });
  }
  return out;
}

export type Llm = (system: string, user: string) => Promise<{ text: string; costChf: number }>;

const defaultLlm = (l: Ledger): Llm => async (system, user) => {
  const r = await claude(l, {
    purpose: 'analysis',
    model: process.env.HORIZON_ANALYSIS_MODEL ?? 'claude-haiku-5-5',
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 3000,
    summary: 'Lecture d’un document masqué pour proposer des faits',
  });
  return { text: r.text, costChf: r.costChf };
};

export interface ExtractResult {
  proposed: number;
  notes: number;
  costChf: number;
  note: string;
}

/** Lit un document masqué et dépose des propositions. N'écrit jamais un fait confirmé. */
export async function extractFacts(l: Ledger, entry: ManifestEntry, llm: Llm = defaultLlm(l)): Promise<ExtractResult> {
  if (entry.status !== 'extracted' || !entry.extractedPath) return { proposed: 0, notes: 0, costChf: 0, note: 'Rien à lire.' };
  const text = readFileSync(entry.extractedPath, 'utf8').slice(0, MAX_CHARS);
  const hint = entry.meta?.type ? (HINT[entry.meta.type] ?? '') : '';
  const user = `Date du jour: ${new Date().toISOString().slice(0, 10)}\n${hint ? `Type de document: ${hint}\n` : ''}${entry.meta?.year ? `Année du document: ${entry.meta.year}\n` : ''}\n---\n${text}`;
  try {
    const r = await llm(SYSTEM, user);
    const terms = getTerms(l);
    const proposals = restoreDeep(parseProposals(r.text), terms);
    let proposed = 0;
    let notes = 0;
    for (const p of proposals) {
      if (p.kind === 'note') {
        l.addNote(p.text ?? "", []);
        notes++;
        continue;
      }
      l.propose({
        kind: p.kind,
        key: p.key,
        data: p.data,
        status: 'proposed',
        origin: 'document',
        confidence: 0.6,
        sourceId: entry.sourceId ?? null,
        excerpt: p.excerpt ?? null,
        why: `Lu dans un document importé (${entry.meta?.type ?? 'type inconnu'}${entry.meta?.year ? `, ${entry.meta.year}` : ''})`,
      });
      proposed++;
    }
    return { proposed, notes, costChf: r.costChf, note: `${proposed} fait${proposed > 1 ? 's' : ''} proposé${proposed > 1 ? 's' : ''}${notes ? `, ${notes} note${notes > 1 ? 's' : ''}` : ''}.` };
  } catch (e) {
    if (e instanceof EgressBlocked) return { proposed: 0, notes: 0, costChf: 0, note: e.reason };
    return { proposed: 0, notes: 0, costChf: 0, note: e instanceof Error ? e.message : String(e) };
  }
}

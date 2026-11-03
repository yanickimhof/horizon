/**
 * Pseudonymisation réversible, entièrement locale.
 *
 * Les termes sensibles (noms de personnes, employeur, adresses) sont remplacés par
 * des jetons stables AVANT tout envoi à un modèle, puis restaurés localement dans
 * la réponse. Le modèle ne voit jamais le terme, l'utilisateur ne voit jamais le jeton.
 * Chaque terme garde un numéro permanent : supprimer un terme ne renumérote pas les autres.
 */
export type TermKind = 'personne' | 'employeur' | 'adresse' | 'autre';

export interface Term {
  term: string;
  kind: TermKind;
  /** Numéro permanent au sein de son type. */
  n: number;
}

export const tokenOf = (t: Term): string => `[${t.kind.toUpperCase()}_${t.n}]`;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Ajoute un terme avec un numéro neuf. Ignore les doublons et les termes trop courts. */
export function addTerm(terms: Term[], term: string, kind: TermKind): Term[] {
  const clean = term.trim();
  if (clean.length < 2) return terms;
  if (terms.some((t) => t.term.toLowerCase() === clean.toLowerCase())) return terms;
  const n = Math.max(0, ...terms.filter((t) => t.kind === kind).map((t) => t.n)) + 1;
  return [...terms, { term: clean, kind, n }];
}

/**
 * Remplace en une seule passe (le plus long d'abord, sans toucher à l'intérieur d'un
 * mot), pour qu'un jeton ne soit jamais re-remplacé.
 */
export function pseudonymize(text: string, terms: Term[]): { text: string; count: number } {
  const live = terms.filter((t) => t.term.trim().length >= 2).sort((a, b) => b.term.length - a.term.length);
  if (live.length === 0) return { text, count: 0 };
  const byLower = new Map(live.map((t) => [t.term.toLowerCase(), t]));
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${live.map((t) => esc(t.term)).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  let count = 0;
  const out = text.replace(re, (m) => {
    const t = byLower.get(m.toLowerCase());
    if (!t) return m;
    count++;
    return tokenOf(t);
  });
  return { text: out, count };
}

export function restore(text: string, terms: Term[]): string {
  let out = text;
  for (const t of terms) out = out.split(tokenOf(t)).join(t.term);
  return out;
}

/** Restaure tous les textes d'une structure (propositions de faits reçues avec des jetons). */
export function restoreDeep<T>(value: T, terms: Term[]): T {
  if (typeof value === 'string') return restore(value, terms) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => restoreDeep(v, terms)) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restoreDeep(v, terms)])) as T;
  }
  return value;
}

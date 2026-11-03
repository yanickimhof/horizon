import type { Ledger } from './ledger';

/**
 * Recherche dans les documents de l'utilisateur, entièrement locale (SQLite FTS5).
 * Seuls les textes DÉJÀ MASQUÉS (identifiants retirés, noms remplacés par des jetons)
 * sont indexés: l'index ne contient jamais le brut.
 */

/** Découpe en passages d'environ `size` caractères, en respectant les paragraphes. */
export function chunkText(text: string, size = 900): string[] {
  const paras = text.split(/\n\s*\n/).map((p) => p.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  const flush = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = '';
  };
  for (const p of paras) {
    if (p.length > size) {
      flush();
      for (let i = 0; i < p.length; i += size) out.push(p.slice(i, i + size));
      continue;
    }
    if (cur.length + p.length + 2 > size) flush();
    cur += (cur ? '\n\n' : '') + p;
  }
  flush();
  return out;
}

const STOP = new Set(
  ('le la les un une des du de et en au aux ce ces cette que qui quoi dans sur pour par avec sans est sont ete etre ai as a ont mon ma mes ton ta tes son sa ses nos vos leur leurs ' +
    'je tu il elle on nous vous ils elles me te se y ne pas plus moins comment pourquoi quand quel quelle quels quelles combien donc mais ou ' +
    'the and for with that this from have has are was were what when how why which who not you your').split(' '),
);

/** Requête FTS5 sûre: mots utiles entre guillemets, avec préfixe, reliés par OR. Jamais de syntaxe libre de l'utilisateur. */
export function toMatch(query: string): string {
  const words = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
  return [...new Set(words)]
    .slice(0, 12)
    .map((w) => `"${w}"*`)
    .join(' OR ');
}

export interface Passage {
  sourceId: string;
  source: string;
  year?: number;
  country?: string;
  type?: string;
  text: string;
}

/**
 * Passages les plus pertinents pour une question, au plus `perSource` par document pour
 * ne pas laisser un seul fichier monopoliser la réponse (utile pour comparer plusieurs années).
 */
export function retrieve(l: Ledger, query: string, k = 6, perSource = 2): Passage[] {
  const match = toMatch(query);
  if (!match) return [];
  const hits = l.searchChunks(match, k * 4);
  const sources = new Map(l.sources().map((s) => [s.id, s]));
  const used = new Map<string, number>();
  const out: Passage[] = [];
  for (const h of hits) {
    const n = used.get(h.sourceId) ?? 0;
    if (n >= perSource) continue;
    used.set(h.sourceId, n + 1);
    const s = sources.get(h.sourceId);
    out.push({ sourceId: h.sourceId, source: s?.name ?? 'document', year: s?.meta?.year, country: s?.meta?.country, type: s?.meta?.type, text: h.text });
    if (out.length >= k) break;
  }
  return out;
}

export function formatPassages(ps: Passage[]): string {
  if (ps.length === 0) return 'Aucun extrait de document ne correspond à la question.';
  return ps
    .map((p, i) => `[${i + 1}] ${p.source}${p.year ? ` (${p.year}` : ' ('}${p.country ? `, ${p.country}` : ''}${p.type ? `, ${p.type}` : ''})\n${p.text}`)
    .join('\n\n');
}

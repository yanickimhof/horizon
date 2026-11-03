import type { TermKind } from './pseudonym';

/**
 * Détection locale des noms et adresses d'un document, pour les masquer sans que l'utilisateur ait à les saisir.
 * Les règles sont volontairement prudentes: mieux vaut manquer un nom isolé que masquer des mots ordinaires.
 * - Personnes: ce qui suit « Monsieur », « Madame », « Mme », « M. » (nom complet, puis chaque mot séparément,
 *   car un même nom s'écrit « Alex EXEMPLE », « Exemple Alex » ou « EXEMPLE »).
 * - Adresses: rue, avenue, chemin, allée... suivie d'un numéro.
 * Les noms du foyer saisis par l'utilisateur et les termes ajoutés à la main complètent cette détection.
 */
export interface Found {
  term: string;
  kind: TermKind;
}

const TITLE = /\b(?:Monsieur|Madame|Mme|Mr|M\.)\s+([\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+){0,2})/gu;
const STREET = /\b((?:Rue|Avenue|Av\.?|Allée|Allee|Chemin|Ch\.?|Route|Rte\.?|Place|Boulevard|Bd\.?|Impasse|Quai|Passage)\s+(?:(?:de la|du|des|de|d['’])\s*)?[\p{L}'’.\- ]{2,40}?\s+\d{1,4}[a-z]?)(?=[\s,.]|$)/gu;
/** Mots qui suivent parfois un titre sans être un nom. */
const NOT_NAMES = new Set(['le', 'la', 'les', 'du', 'de', 'des', 'et', 'ou', 'pour', 'sur', 'par', 'avec', 'sans', 'dans', 'en', 'au', 'aux']);

export function detectTerms(text: string): Found[] {
  const out: Found[] = [];
  const push = (term: string, kind: TermKind) => {
    const clean = term.trim().replace(/\s+/g, ' ');
    if (clean.length >= 3 && !out.some((f) => f.kind === kind && f.term.toLowerCase() === clean.toLowerCase())) out.push({ term: clean, kind });
  };
  for (const m of text.matchAll(TITLE)) {
    const full = m[1].trim();
    push(full, 'personne');
    for (const part of full.split(/\s+/)) if (part.length >= 3 && !NOT_NAMES.has(part.toLowerCase())) push(part, 'personne');
  }
  for (const m of text.matchAll(STREET)) push(m[1], 'adresse');
  return out;
}

import type { Ledger } from './ledger';
import { EgressBlocked, getTerms } from './egress';
import { claude } from './usage';
import { pseudonymize } from '../src/core/pseudonym';
import { AI_CATEGORY_HELP, normalizeLabel, parseAiCategories, type Report, type Tx } from './statements';

const MAX_LABELS = 40;

/**
 * Demande à un modèle (Haiku) de classer les libellés que les règles locales ne reconnaissent pas.
 * Ce qui part: des libellés réduits, numérotés, noms remplacés par des jetons. Jamais de montant ni de date.
 */
export async function classifyUnknown(l: Ledger, txs: Tx[]): Promise<Report['ai']> {
  const groups = new Map<string, Tx[]>();
  for (const t of txs) {
    if (t.category !== 'inconnu' || t.amount >= 0) continue;
    const k = normalizeLabel(t.label);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const keys = [...groups.keys()].slice(0, MAX_LABELS);
  if (keys.length === 0) return { used: false, labels: 0, costChf: 0, note: 'Aucun libellé à identifier.' };
  const terms = getTerms(l);
  const list = keys.map((k, i) => `${i + 1}. ${pseudonymize(k, terms).text}`).join('\n');
  const system =
    'Tu classes des libellés de relevés bancaires suisses (en français). ' +
    'Pour chaque ligne numérotée, choisis la catégorie la plus probable. ' +
    'Réponds uniquement par un objet JSON de la forme {"1":"catégorie","2":"catégorie"}, sans texte autour. ' +
    'Si tu ne peux pas décider, omets le numéro. Catégories: ' +
    AI_CATEGORY_HELP +
    '.';
  try {
    const r = await claude(l, {
      purpose: 'analysis',
      model: process.env.HORIZON_ANALYSIS_MODEL ?? 'claude-haiku-5-5',
      system,
      messages: [{ role: 'user', content: list }],
      maxTokens: 1500,
      summary: `Classement de ${keys.length} libellés de relevés (sans montants ni dates)`,
    });
    const cats = parseAiCategories(r.text, keys.length);
    for (const [i, cat] of Object.entries(cats)) {
      for (const t of groups.get(keys[Number(i) - 1]) ?? []) {
        t.category = cat;
        t.source = 'ia';
      }
    }
    return { used: true, labels: keys.length, costChf: r.costChf, note: `${Object.keys(cats).length} libellés classés sur ${keys.length}.` };
  } catch (e) {
    if (e instanceof EgressBlocked) return { used: false, labels: keys.length, costChf: 0, note: e.reason };
    return { used: false, labels: keys.length, costChf: 0, note: e instanceof Error ? e.message : String(e) };
  }
}

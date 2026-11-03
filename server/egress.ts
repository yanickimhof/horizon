import { createHash } from 'node:crypto';
import type { Ledger } from './ledger';
import { restoreDeep, type Term } from '../src/core/pseudonym';

/**
 * Point de sortie UNIQUE. Aucun autre fichier du projet ne doit appeler fetch vers
 * l'extérieur : tout passe par guardedFetch, qui applique la politique et journalise.
 *
 * Politique :
 * - local    (défaut) : aucun envoi vers l'extérieur, jamais.
 * - assisted          : envoi possible, mais seulement après un accord explicite et révocable.
 * - HORIZON_PRIVACY=local dans l'environnement impose "local" quoi que dise l'interface.
 * - Les destinations sur cet ordinateur (modèle local) ne sont pas concernées.
 */
export type Mode = 'local' | 'assisted';
/** coach: question à un modèle. market: cours publics (devises, cryptos), requête GET sans donnée personnelle. */
export type Purpose = 'coach' | 'market' | 'analysis';

export class EgressBlocked extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

export const envLocked = (): boolean => process.env.HORIZON_PRIVACY === 'local';

export function privacyMode(l: Ledger): Mode {
  if (envLocked()) return 'local';
  return l.getSetting('privacy.mode') === 'assisted' ? 'assisted' : 'local';
}

/** coachDocs: autorise l'envoi d'extraits de documents (qui contiennent des montants) au coach en ligne. */
export type Consent = Purpose | 'coachDocs';

export function consentGranted(l: Ledger, purpose: Consent): string | undefined {
  return l.getSetting(`consent.${purpose}`) || undefined;
}

export function getTerms(l: Ledger): Term[] {
  try {
    return JSON.parse(l.getSetting('vault.terms') ?? '[]') as Term[];
  } catch {
    return [];
  }
}

export function setTerms(l: Ledger, terms: Term[]): void {
  l.setSetting('vault.terms', JSON.stringify(terms));
}

const isLocalHost = (url: string): boolean => {
  const h = new URL(url).hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
};

export interface OutboundRequest {
  purpose: Purpose;
  url: string;
  /** Un GET n'a pas de corps: seul l'URL (donc la liste demandée) est journalisée par empreinte. */
  init: RequestInit & { body?: string };
  /** Description lisible de ce qui part, sans le contenu. */
  summary: string;
}

export async function guardedFetch(l: Ledger, req: OutboundRequest, doFetch: typeof fetch = fetch): Promise<Response> {
  if (isLocalHost(req.url)) return doFetch(req.url, req.init);

  const destination = new URL(req.url).host;
  const payload = req.init.body ?? req.url;
  const bytes = Buffer.byteLength(payload);
  const sha256 = createHash('sha256').update(payload).digest('hex');
  const base = { destination, purpose: req.purpose, bytes, sha256, summary: req.summary };

  const mode = privacyMode(l);
  // Les cours publics sont une lecture sans donnée personnelle: ils ne dépendent que de leur propre accord,
  // pas du mode "assisté" (réservé au coach en ligne). L'environnement verrouillé bloque tout.
  const marketOnly = req.purpose === 'market' && !envLocked();
  if (mode === 'local' && !marketOnly) {
    l.logEgress({ ...base, allowed: false, reason: envLocked() ? 'Mode local imposé par l’environnement' : 'Mode local' });
    throw new EgressBlocked('Mode local: aucun envoi vers l’extérieur.');
  }
  if (!consentGranted(l, req.purpose)) {
    l.logEgress({ ...base, allowed: false, reason: 'Accord manquant' });
    throw new EgressBlocked('Accord manquant: autorise l’envoi dans l’onglet Confidentialité.');
  }
  l.logEgress({ ...base, allowed: true });
  const { body, ...rest } = req.init;
  return doFetch(req.url, (rest.method ?? 'GET').toUpperCase() === 'GET' ? rest : { ...rest, body });
}

/** Restaure les termes dans une réponse ou une proposition reçue avec des jetons. */
export const restoreLocal = <T>(value: T, l: Ledger): T => restoreDeep(value, getTerms(l));

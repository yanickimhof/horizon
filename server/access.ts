import type { IncomingMessage } from 'node:http';

/**
 * Garde d'accès. Horizon n'a pas de mot de passe: il contient des données financières, donc
 * l'accès est limité par construction, avant toute route.
 *
 * Règles (toutes doivent passer):
 * 1. La connexion vient de CET ordinateur (loopback). Le serveur n'écoute que sur 127.0.0.1;
 *    Tailscale Serve relaie les appareils du réseau vers ce port local, en y ajoutant l'identité.
 * 2. Le nom d'hôte demandé est local ou en .ts.net (anti DNS rebinding).
 * 3. Une écriture exige du JSON et, si elle porte une Origin, la même origine que l'hôte
 *    (une page web tierce ne peut pas écrire dans Horizon depuis ton navigateur).
 * 4. Un appel relayé par Tailscale porte l'identité de l'utilisateur: elle doit figurer dans
 *    HORIZON_ALLOWED_LOGIN. Sans cette variable, tout accès distant est refusé (fermé par défaut).
 *
 * Ne jamais utiliser `tailscale funnel`: il publierait Horizon sur Internet.
 */
export interface AccessDecision {
  ok: boolean;
  status: number;
  reason?: string;
  /** Appel venant d'un autre appareil via Tailscale (pas du Mac lui-même). */
  remote: boolean;
  login?: string;
}

type Req = Pick<IncomingMessage, 'headers' | 'socket' | 'method'>;

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|([a-z0-9-]+\.)+ts\.net)$/i;

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const hostname = (hostHeader: string): string => hostHeader.replace(/:\d+$/, '').trim();

export function allowedLogins(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.HORIZON_ALLOWED_LOGIN ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function decide(req: Req, env: NodeJS.ProcessEnv = process.env): AccessDecision {
  const deny = (status: number, reason: string, remote = true, login?: string): AccessDecision => ({ ok: false, status, reason, remote, login });

  if (!LOOPBACK.has(req.socket?.remoteAddress ?? '')) {
    return deny(403, 'Connexion directe refusée: Horizon n’accepte que cet ordinateur et Tailscale Serve.');
  }

  const host = first(req.headers.host);
  if (!host || !LOCAL_HOST.test(hostname(host))) return deny(403, 'Nom d’hôte refusé.');

  const method = (req.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const ct = first(req.headers['content-type']) ?? '';
    if (!ct.toLowerCase().startsWith('application/json')) return deny(415, 'Les écritures doivent être au format JSON.');
    const origin = first(req.headers.origin);
    if (origin) {
      let originHost = '';
      try {
        originHost = new URL(origin).hostname;
      } catch {
        return deny(403, 'Origine invalide.');
      }
      if (originHost.toLowerCase() !== hostname(host).toLowerCase()) return deny(403, 'Origine refusée.');
    }
  }

  const login = first(req.headers['tailscale-user-login'])?.trim().toLowerCase();
  if (!login) return { ok: true, status: 200, remote: false };

  const allowed = allowedLogins(env);
  if (allowed.length === 0) return deny(403, 'Accès distant non configuré (HORIZON_ALLOWED_LOGIN).', true, login);
  if (!allowed.includes(login)) return deny(403, `Compte non autorisé: ${login}`, true, login);
  return { ok: true, status: 200, remote: true, login };
}

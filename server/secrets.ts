import { execFileSync } from 'node:child_process';

/**
 * Clé d'API Anthropic. On la cherche d'abord dans la variable d'environnement, puis dans le
 * trousseau macOS (service « horizon-anthropic », voir scripts/set-key.sh). Elle n'est jamais
 * écrite dans un fichier ni journalisée. Une clé absente est cherchée de nouveau toutes les 30 secondes,
 * pour qu'une clé ajoutée soit prise en compte sans redémarrer.
 */
const SERVICE = 'horizon-anthropic';
let found: string | null = null;
let checkedAt = 0;

export function anthropicKey(now: number = Date.now()): string | null {
  const env = process.env.ANTHROPIC_API_KEY;
  if (env) return env;
  if (found) return found;
  if (process.platform !== 'darwin' || now - checkedAt < 30_000) return null;
  checkedAt = now;
  try {
    const out = execFileSync('/usr/bin/security', ['find-generic-password', '-s', SERVICE, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
    found = out || null;
  } catch {
    found = null;
  }
  return found;
}

export const hasAnthropicKey = (): boolean => anthropicKey() !== null;

import { existsSync } from 'node:fs';

/**
 * Lit le fichier .env à la racine (jamais versionné) et place ses variables dans l'environnement du serveur.
 * Une variable déjà définie dans l'environnement garde sa valeur. Absent, le fichier est simplement ignoré.
 */
export function loadDotEnv(path = '.env'): boolean {
  if (!existsSync(path)) return false;
  try {
    process.loadEnvFile(path);
    return true;
  } catch {
    return false;
  }
}

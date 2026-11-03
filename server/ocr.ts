import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Reconnaissance de texte pour les scans (PDF sans texte, photos de documents).
 * Entièrement locale: un petit programme Swift s'appuie sur le framework Vision de macOS. Il est compilé
 * une seule fois dans data/.cache. Ailleurs que sur macOS, ou sans les outils de compilation, la fonction
 * renvoie null et le document reste « à lire visuellement ».
 */
const SRC = resolve('scripts/ocr.swift');
const BIN = resolve('data/.cache/ocr');

let compiled: string | null | undefined;

function ensureBinary(): string | null {
  if (compiled !== undefined) return compiled;
  if (process.platform !== 'darwin' || !existsSync(SRC)) return (compiled = null);
  try {
    if (!existsSync(BIN) || statSync(BIN).mtimeMs < statSync(SRC).mtimeMs) {
      mkdirSync(dirname(BIN), { recursive: true });
      execFileSync('swiftc', ['-O', SRC, '-o', BIN], { stdio: 'ignore', timeout: 5 * 60_000 });
    }
    return (compiled = BIN);
  } catch {
    return (compiled = null);
  }
}

/** Retire les marqueurs de page et les lignes vides du texte reconnu. */
export function cleanOcr(raw: string): string {
  return raw
    .split('\n')
    .filter((l) => !/^=== PAGE \d+$/.test(l))
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const ocrAvailable = (): boolean => ensureBinary() !== null;

/** Texte reconnu, ou null si l'OCR est indisponible ou ne trouve presque rien. */
export function ocrFile(path: string, maxPages = 12): string | null {
  const bin = ensureBinary();
  if (!bin) return null;
  try {
    const out = execFileSync(bin, [path, String(maxPages)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 5 * 60_000, stdio: ['ignore', 'pipe', 'ignore'] });
    const text = cleanOcr(out);
    return text.replace(/\s/g, '').length >= 30 ? text : null;
  } catch {
    return null;
  }
}

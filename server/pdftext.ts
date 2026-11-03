import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Texte intégré d'un PDF, lu avec PDFKit (macOS). C'est la couche texte du fichier: exacte, contrairement à une
 * reconnaissance optique qui confond des chiffres. Sans macOS ou sans compilateur Swift, renvoie null.
 */
const SRC = resolve('scripts/pdftext.swift');
const BIN = resolve('data/.cache/pdftext');
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

export function pdfTextLayer(path: string, maxPages = 40): string | null {
  const bin = ensureBinary();
  if (!bin) return null;
  try {
    const out = execFileSync(bin, [path, String(maxPages)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 2 * 60_000, stdio: ['ignore', 'pipe', 'ignore'] });
    const text = out.trim();
    return text.replace(/\s/g, '').length >= 50 ? text : null;
  } catch {
    return null;
  }
}

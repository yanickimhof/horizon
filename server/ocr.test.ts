import { describe, expect, it } from 'vitest';
import { cleanOcr } from './ocr';

describe('reconnaissance de texte', () => {
  it('retire les marqueurs de page et compacte les lignes vides', () => {
    const raw = '=== PAGE 1\nAvoir de vieillesse   \n\n\n\n173\'693.75\n=== PAGE 2\nFin\n';
    expect(cleanOcr(raw)).toBe("Avoir de vieillesse\n\n173'693.75\nFin");
  });
});

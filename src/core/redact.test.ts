import { describe, expect, it } from 'vitest';
import { redact } from './redact';

describe('masquage', () => {
  it('masque AVS, IBAN, carte valide, email et téléphone', () => {
    const src = [
      'N° AVS 756.1234.5678.97',
      'IBAN CH93 0076 2011 6238 5295 7',
      'Carte 4111 1111 1111 1111',
      'contact: jean.dupont@example.ch',
      'Tél. 021 123 45 67',
    ].join('\n');
    const { text, counts } = redact(src);
    expect(text).not.toMatch(/756\.1234/);
    expect(text).not.toMatch(/CH93/);
    expect(text).not.toMatch(/4111/);
    expect(text).not.toMatch(/example\.ch/);
    expect(text).not.toMatch(/123 45 67/);
    expect(counts).toEqual({ avs: 1, iban: 1, carte: 1, email: 1, tel: 1 });
  });

  it('conserve les montants et les dates', () => {
    const src = 'Solde au 31.12.2025: CHF 1\'245\'300.50, taux 1.85 %, paiement 2024-03-15 de 3450.00';
    const { text, counts } = redact(src);
    expect(text).toBe(src);
    expect(counts).toEqual({});
  });

  it('ne masque pas un nombre de 16 chiffres qui n est pas une carte', () => {
    const { text, counts } = redact('Référence 1234 5678 9012 3456');
    expect(text).toContain('1234 5678 9012 3456');
    expect(counts.carte).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { incomeTax, wealthTax } from './tax';

describe('impôts', () => {
  it('retrouve l’impôt sur la fortune de la taxation 2025 à quelques pour cent près', () => {
    // Fortune imposable de 180 000: impôt cantonal de 329,30 à 155 %, soit un impôt de base d'environ 212, puis la commune (72,5 %).
    expect(wealthTax(180_000)).toBeGreaterThan(440);
    expect(wealthTax(180_000)).toBeLessThan(540);
  });

  it('suit le barème officiel aux points connus', () => {
    expect(wealthTax(1_000_000)).toBeCloseTo(2_737.3 * 2.275, 0);
    expect(wealthTax(2_000_000)).toBeCloseTo(6_127.3 * 2.275, 0);
  });

  it('continue au taux marginal au-delà du barème', () => {
    const d = wealthTax(3_000_000) - wealthTax(2_000_000);
    expect(d).toBeCloseTo(1_000_000 * 0.00339 * 2.275, 0);
  });

  it('est nul sans fortune et croît avec elle', () => {
    expect(wealthTax(0)).toBe(0);
    expect(wealthTax(-5)).toBe(0);
    expect(wealthTax(1_500_000)).toBeGreaterThan(wealthTax(1_000_000));
  });

  it('retrouve l’impôt sur le revenu des taxations', () => {
    expect(incomeTax(164_900)).toBeGreaterThan(34_000);
    expect(incomeTax(164_900)).toBeLessThan(37_000);
    expect(incomeTax(87_600)).toBeGreaterThan(15_000);
    expect(incomeTax(87_600)).toBeLessThan(17_500);
    expect(incomeTax(0)).toBe(0);
  });
});

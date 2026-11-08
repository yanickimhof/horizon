import { describe, expect, it } from 'vitest';
import { treasury } from './treasury';
import type { Snapshot } from './types';

const base = (over: Partial<Snapshot> = {}): Snapshot => ({
  asOf: '2026-11-08',
  base: 'CHF',
  rates: {} as Snapshot['rates'],
  household: { name: 'T', birthYear: 1975, adults: 2, children: 0, owner: true, retirementAge: 65 },
  assets: [{ key: 'asset:c', label: 'Compte', class: 'cash', value: 120000, currency: 'CHF', valueNative: 120000, fx: 1, region: 'CH', real: false, liquidityMonths: 0, haircut: 0, certainty: 'confirmed' }],
  liabilities: [],
  incomes: [
    { key: 'income:foyer', label: 'Salaire', monthly: 11000, stable: false, certainty: 'confirmed' },
    { key: 'income:bonus-x', label: 'Bonus net', monthly: 1400, stable: false, certainty: 'confirmed' },
    { key: 'income:loc-imp-0', label: 'Loyers A', monthly: 2000, stable: true, certainty: 'confirmed' },
    { key: 'income:rente', label: 'Rente future', monthly: 3000, stable: true, startMonth: 120, certainty: 'confirmed' },
  ],
  expenses: [
    { key: 'expense:courantes', label: 'Courantes', category: 'lifestyle', monthly: 4400, essential: true, certainty: 'confirmed' },
    { key: 'expense:impots-avances', label: 'Impôts avances', category: 'tax', monthly: 1650, essential: true, certainty: 'confirmed' },
    { key: 'expense:impots-solde', label: 'Impôts solde', category: 'tax', monthly: 1300, essential: true, certainty: 'confirmed' },
    { key: 'expense:guin-amort', label: 'Amortissement Guinguette', category: 'housing', monthly: 250, essential: true, certainty: 'confirmed' },
    { key: 'expense:x', label: 'Ponctuelle', category: 'other', monthly: 9999, essential: false, lump: { month: 2, amount: 5000 }, certainty: 'confirmed' },
  ],
  goals: [],
  ...over,
});

describe('treasury', () => {
  it('ne compte ni les flux futurs ni les ponctuels', () => {
    const t = treasury(base(), null);
    expect(t.salary).toBe(11000);
    expect(t.bonus).toBe(1400);
    expect(t.rents).toBe(2000);
    expect(t.other).toBe(0);
    expect(t.fixed).toBe(4400 + 1650 + 250);
    expect(t.taxSolde).toBe(1300);
    expect(t.amortization).toBe(250);
  });

  it('donne le salaire net minimal du cas prudent', () => {
    const t = treasury(base(), null);
    const p = t.scenarios[2];
    expect(t.breakEvenSalary).toBe(p.outflow - (2000 * 0.9));
    expect(p.income - 11000 + t.breakEvenSalary - p.outflow).toBeCloseTo(0, 6);
  });

  it('classe favorable >= central >= prudent', () => {
    const [f, c, p] = treasury(base(), null).scenarios;
    expect(f.margin).toBeGreaterThan(c.margin);
    expect(c.margin).toBeGreaterThan(p.margin);
    expect(c.margin).toBe(11000 + 1400 + 2000 - (6300 + 1300));
  });

  it('donne les mois de réserve seulement si la marge est négative', () => {
    const snap = base({ expenses: [{ key: 'expense:courantes', label: 'Courantes', category: 'lifestyle', monthly: 20000, essential: true, certainty: 'confirmed' }] });
    const [f, c, p] = treasury(snap, null).scenarios;
    expect(f.reserveMonths).toBe(Math.floor(120000 / (20000 - (11000 + 1400 + 2000))));
    expect(c.reserveMonths).toBe(f.reserveMonths);
    expect(p.reserveMonths).toBe(Math.floor(120000 / (20000 - (11000 + 1800))));
    expect(treasury(base(), null).scenarios[0].reserveMonths).toBeNull();
  });

  it('relève l’écart de charges locatives observé au-delà du modèle', () => {
    const months = Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, partial: false, spend: 5000, immo: { Orion: { loyers: 650, charges: 2000 }, Osiris: { loyers: 0, charges: 3000 } } }));
    const t = treasury(base(), { months, homes: [] });
    expect(t.rentalGap).toBe(24000);
    expect(t.observed?.spendMonthly).toBe(5000);
  });
});

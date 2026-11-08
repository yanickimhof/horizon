import { describe, expect, it } from 'vitest';
import { bienName, portfolio } from './biens';
import type { Snapshot } from './types';

const asset = (key: string, label: string, value: number, subtype = 'rental') => ({ key, label, class: 'real_estate' as const, value, currency: 'CHF', valueNative: value, fx: 1, region: 'CH', real: true, liquidityMonths: 12, haircut: 0.05, subtype, certainty: 'confirmed' as const });
const snap = {
  asOf: '2026-11-08',
  base: 'CHF',
  rates: {},
  household: { name: 'T', birthYear: 1975, adults: 2, children: 0, owner: true, retirementAge: 65 },
  assets: [asset('asset:p', 'PPE Les Peupliers', 1300000), asset('asset:r', 'Résidence principale (PPE Osiris)', 1350000, 'home')],
  liabilities: [
    { key: 'liability:1', label: 'Hyp Peupliers', balance: 587000, currency: 'CHF', balanceNative: 587000, fx: 1, rate: 0.00818, variable: true, securedBy: 'asset:p', certainty: 'confirmed' },
    { key: 'liability:2', label: 'Hyp Osiris 1er rang', balance: 450000, currency: 'CHF', balanceNative: 450000, fx: 1, rate: 0.0213, variable: false, securedBy: 'asset:r', certainty: 'confirmed' },
  ],
  incomes: [{ key: 'income:loc-imp-0', label: 'Loyers Les Peupliers', monthly: 2200, stable: true, certainty: 'confirmed' }],
  expenses: [],
  goals: [],
} as unknown as Snapshot;
const facts = [
  { key: 'asset:p', status: 'confirmed', validTo: null, data: { estimateLow: 1190000, estimateHigh: 1450000, grossRent2025: 34640, commune: 'Lausanne' } },
  { key: 'liability:2', status: 'confirmed', validTo: null, data: { note: 'Fixe jusqu’au 30.9.2028' } },
];

describe('bienName', () => {
  it('extrait le nom court', () => {
    expect(bienName('PPE Les Peupliers')).toBe('Peupliers');
    expect(bienName('PPE Guinguette (studio)')).toBe('Guinguette');
    expect(bienName('Résidence principale (PPE Osiris)')).toBe('Osiris');
  });
});

describe('portfolio', () => {
  const p = portfolio(snap, facts, null);
  const peup = p.biens.find((b) => b.name === 'Peupliers')!;
  it('calcule levier, rendement et fourchette', () => {
    expect(peup.debt).toBe(587000);
    expect(peup.ltv).toBeCloseTo(0.4515, 3);
    expect(peup.ltvLow).toBeCloseTo(587000 / 1190000, 4);
    expect(peup.rent).toBe(26400);
    expect(peup.netYield).toBeCloseTo(26400 / 1300000, 5);
    expect(peup.grossYield).toBeCloseTo(34640 / 1300000, 5);
    expect(peup.ranged).toBe(true);
    expect(peup.rateShock).toBeCloseTo(5870, 5);
  });
  it('place la résidence en dernier et relève la prochaine échéance fixe', () => {
    expect(p.biens[p.biens.length - 1].home).toBe(true);
    expect(p.nextFixed?.date).toBe('2028-09-30');
    expect(p.variableDebt).toBe(587000);
  });
});

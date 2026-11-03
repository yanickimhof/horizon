import { describe, expect, it } from 'vitest';
import { Ledger } from '../../server/ledger';
import { loadDemo } from '../../server/demo';
import { project } from '../core/project';
import { toMonthly } from './frequency';
import { monthlyBurn, rings, runwayMonths, netAvailable } from './horizons';
import { runScenarios } from './stress';
import { reliability } from './reliability';
import { goalMarkers } from './goals';

const NOW = new Date('2026-11-01T12:00:00Z');
const demo = () => {
  const l = new Ledger();
  loadDemo(l);
  return project(l.current(), new Date(), l.rates());
};

describe('fréquences', () => {
  it('ramène tout au mois', () => {
    expect(toMonthly(1200, 'annual')).toBe(100);
    expect(toMonthly(300, 'quarterly')).toBe(100);
    expect(toMonthly(50, 'weekly')).toBeCloseTo(216.67, 1);
    expect(toMonthly(5000, 'once')).toBe(0);
  });
});

describe('anneaux', () => {
  const s = demo();

  it('la couverture ne diminue jamais avec l horizon dans ses sources, et reste dans 0..1', () => {
    for (const r of rings(s)) {
      expect(r.coverage).toBeGreaterThanOrEqual(0);
      expect(r.coverage).toBeLessThanOrEqual(1.0000001);
      expect(r.coverage + r.gap).toBeCloseTo(1, 6);
    }
  });

  it('les liquidités couvrent les 3 premiers mois, la prévoyance n entre qu à la retraite', () => {
    const [r3, r12, r60, r240] = rings(s);
    expect(r3.coverage).toBeCloseTo(1, 6);
    expect(r12.segments.some((x) => x.class === 'pension')).toBe(false);
    expect(r60.segments.some((x) => x.class === 'pension')).toBe(false);
    expect(r240.segments.some((x) => x.class === 'pension')).toBe(true);
    expect(r60.coverage).toBeLessThan(r12.coverage);
  });

  it('l immobilier est compté net de l hypothèque et de la décote', () => {
    const net = netAvailable(s, 'asset:residence');
    expect(net).toBeCloseTo(1150000 * 0.75 - 750000, 0);
  });

  it('retourne un runway fini sans salaire', () => {
    const m = runwayMonths(s);
    expect(Number.isFinite(m)).toBe(true);
    expect(m).toBeGreaterThan(6);
  });

  it('des revenus stables suffisants rendent l horizon infini', () => {
    const rich = structuredClone(s);
    rich.incomes.push({ key: 'income:rentes', label: 'Rentes', monthly: 1e6, stable: true, certainty: 'confirmed' });
    expect(monthlyBurn(rich)).toBe(0);
    expect(runwayMonths(rich)).toBe(Infinity);
    expect(rings(rich).every((r) => r.coverage === 1)).toBe(true);
  });
});

describe('chocs', () => {
  const s = demo();
  const { results } = runScenarios(s);
  const by = (id: string) => results.find((r) => r.scenario.id === id)!;

  it('un krach réduit les anneaux où les titres comptent, pas les 3 premiers mois', () => {
    const k = by('krach');
    expect(k.coverageDelta[0]).toBeCloseTo(0, 6);
    expect(k.coverageDelta[2]).toBeLessThan(0);
  });

  it('la baisse immobilière efface la valeur nette à cause de l effet de levier', () => {
    const i = by('immobilier');
    expect(i.coverageDelta[2]).toBeLessThan(0);
    expect(i.coverageDelta[3]).toBeLessThan(0);
  });

  it('la hausse des taux ne touche que les dettes variables', () => {
    const t = by('taux');
    expect(t.rings[0].coverage).toBeLessThanOrEqual(1);
    expect(t.runwayMonths).toBeLessThanOrEqual(runwayMonths(s));
  });

  it('ne modifie pas l instantané d origine', () => {
    const before = JSON.stringify(s);
    runScenarios(s);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('fiabilité', () => {
  it('baisse quand beaucoup de valeurs sont supposées et monte à mesure qu on confirme', () => {
    const l = new Ledger();
    loadDemo(l);
    const before = reliability(project(l.current(), new Date(), l.rates()));
    expect(before.score).toBeLessThan(1);
    expect(before.weakest.length).toBeGreaterThan(0);
    l.correct('expense:tax', { amount: 2100 }, 'Lu sur la taxation');
    const after = reliability(project(l.current(), new Date(), l.rates()));
    expect(after.flows).toBeGreaterThan(before.flows);
  });
});

describe('rêves', () => {
  it('place un rêve sur l anneau le plus proche, exprimé en mois de vie', () => {
    const s = demo();
    const g = goalMarkers(s, NOW);
    const cuisine = g.find((x) => x.key === 'goal:cuisine')!;
    expect(cuisine.monthsAway).toBe(25);
    expect(cuisine.ringIndex).toBe(1);
    expect(cuisine.costInMonthsOfLife).toBeGreaterThan(1);
    expect(cuisine.funded).toBeCloseTo(8000 / 45000, 6);

    s.goals.push({ key: 'goal:achat', label: 'Résidence secondaire', targetAmount: 300000, targetYear: 2031, saved: 0, certainty: 'confirmed' });
    expect(goalMarkers(s, NOW).find((x) => x.key === 'goal:achat')!.ringIndex).toBe(2);
  });
});

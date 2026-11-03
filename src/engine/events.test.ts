import { describe, expect, it } from 'vitest';
import { Ledger } from '../../server/ledger';
import { project } from '../core/project';
import { validateData } from '../core/schema';
import type { FactDraft } from '../core/types';
import { LIFE_EVENTS } from './events';
import { monthlyExpenses, rings, runwayMonths, demandCurve } from './horizons';
import { DEFAULT_ASSUMPTIONS } from './assumptions';
import { upcoming } from './upcoming';
import { summarize } from './summary';

const YEAR = new Date().getFullYear();
const ev = (id: string) => LIFE_EVENTS.find((e) => e.id === id)!;

const draft = (key: string, kind: FactDraft['kind'], data: Record<string, unknown>): FactDraft => ({
  kind, key, data, status: 'confirmed', origin: 'user', confidence: 1, sourceId: null, excerpt: null, why: null,
});

function build(extra: FactDraft[] = []) {
  const l = new Ledger();
  l.confirmNew(draft('household', 'household', { birthYear: YEAR - 45, adults: 2, children: 1, owner: false, retirementAge: 65 }));
  l.confirmNew(draft('asset:cash', 'asset', { label: 'Épargne', class: 'cash', value: 300000, currency: 'CHF' }));
  l.confirmNew(draft('expense:vie', 'expense', { label: 'Vie courante', category: 'other', amount: 5000, frequency: 'monthly', essential: true }));
  for (const d of extra) l.confirmNew(d);
  return project(l.current(), new Date(), l.rates());
}

describe('situations de vie: fenêtres de temps', () => {
  it('des études futures n entrent pas dans les dépenses d aujourd hui', () => {
    const study = ev('study').build({ label: 'Études', amount: '2000', startYear: String(YEAR + 2), endYear: String(YEAR + 5) });
    const s = build([study]);
    const e = s.expenses.find((x) => x.label === 'Études')!;
    expect(e.startMonth).toBeGreaterThan(12);
    expect(e.endMonth).toBeGreaterThan(e.startMonth!);
    expect(monthlyExpenses(s)).toBe(5000);
    expect(summarize(s).expenses).toBe(5000);
  });

  it('une dépense déjà commencée est active, une terminée ne l est plus', () => {
    const running = draft('expense:r', 'expense', { label: 'En cours', category: 'other', amount: 1000, frequency: 'monthly', essential: true, startYear: YEAR - 1, endYear: YEAR + 1 });
    const over = draft('expense:o', 'expense', { label: 'Finie', category: 'other', amount: 1000, frequency: 'monthly', essential: true, startYear: YEAR - 5, endYear: YEAR - 2 });
    const s = build([running, over]);
    expect(s.expenses.find((x) => x.label === 'En cours')!.startMonth).toBeUndefined();
    expect(monthlyExpenses(s)).toBe(6000);
    expect(s.expenses.find((x) => x.label === 'Finie')!.endMonth).toBeLessThan(0);
  });

  it('une dépense ponctuelle devient un montant daté, pas une charge mensuelle', () => {
    const s = build([ev('one-off').build({ label: 'Toiture', amount: '40000', startYear: String(YEAR + 1) })]);
    const e = s.expenses.find((x) => x.label === 'Toiture')!;
    expect(e.monthly).toBe(0);
    expect(e.lump!.amount).toBe(40000);
    expect(e.lump!.month).toBeGreaterThan(0);
    expect(monthlyExpenses(s)).toBe(5000);
  });

  it('une dépense ponctuelle passée ne pèse plus', () => {
    const s = build([ev('one-off').build({ label: 'Passée', amount: '40000', startYear: String(YEAR - 2) })]);
    expect(s.expenses.find((x) => x.label === 'Passée')!.lump!.amount).toBe(0);
  });
});

describe('situations de vie: effet sur les anneaux', () => {
  it('des études dans 2 ans creusent l anneau de 5 ans, pas ceux de 3 mois et 1 an', () => {
    const before = rings(build());
    const after = rings(build([ev('study').build({ label: 'Études', amount: '3000', startYear: String(YEAR + 2), endYear: String(YEAR + 5) })]));
    expect(after[0].coverage).toBeCloseTo(before[0].coverage, 9);
    expect(after[1].coverage).toBeCloseTo(before[1].coverage, 9);
    expect(after[2].coverage).toBeLessThan(before[2].coverage);
  });

  it('une grosse dépense dans l année creuse l anneau de 1 an', () => {
    const before = rings(build());
    const after = rings(build([ev('one-off').build({ label: 'Travaux', amount: '400000', startYear: String(YEAR + 1) })]));
    expect(after[0].coverage).toBeCloseTo(before[0].coverage, 9);
    expect(after[1].coverage).toBeLessThan(before[1].coverage);
  });

  it('une rente qui démarre avant l horizon de 20 ans améliore cet anneau et la tenue', () => {
    const none = build();
    const withRente = build([ev('retirement-income').build({ label: 'Rente AVS', amount: '3000', startAge: '60', currency: 'CHF' })]);
    expect(withRente.incomes.find((i) => i.label === 'Rente AVS')!.startMonth).toBeGreaterThan(100);
    expect(rings(withRente)[3].coverage).toBeGreaterThan(rings(none)[3].coverage);
    expect(runwayMonths(withRente)).toBeGreaterThanOrEqual(runwayMonths(none));
  });

  it('une rente qui démarre après l horizon n a aucun effet sur cet horizon', () => {
    const none = build();
    const late = build([ev('retirement-income').build({ label: 'Rente tardive', amount: '3000', startAge: '70' })]);
    expect(rings(late)[3].coverage).toBeCloseTo(rings(none)[3].coverage, 9);
  });

  it('la demande cumulée suit exactement les fenêtres', () => {
    const s = build([ev('one-off').build({ label: 'Toiture', amount: '10000', startYear: String(YEAR + 1) })]);
    const cum = demandCurve(s, { ...DEFAULT_ASSUMPTIONS, expenseGrowth: 0 }, 36);
    expect(cum[0]).toBe(0);
    expect(cum[12]).toBeGreaterThan(5000 * 12 - 1);
    expect(cum[36]).toBeCloseTo(5000 * 36 + 10000, 0);
  });
});

describe('à venir', () => {
  it('liste les événements par date, sans montant: poids relatifs', () => {
    const s = build([
      ev('one-off').build({ label: 'Travaux', amount: '20000', startYear: String(YEAR + 1) }),
      ev('study').build({ label: 'Études', amount: '2500', startYear: String(YEAR + 3), endYear: String(YEAR + 6) }),
      ev('retirement-income').build({ label: 'Rente', amount: '2500', startAge: '65' }),
    ]);
    const u = upcoming(s);
    expect(u.map((x) => x.inMonths)).toEqual([...u.map((x) => x.inMonths)].sort((a, b) => a - b));
    const travaux = u.find((x) => x.label === 'Travaux')!;
    expect(travaux.kind).toBe('lump');
    expect(travaux.weight).toBeCloseTo(4, 6); // 20 000 pour 5 000 par mois: 4 mois de vie
    expect(u.find((x) => x.label === 'Études' && x.kind === 'start')).toBeDefined();
    expect(u.find((x) => x.label === 'Études' && x.kind === 'end')).toBeDefined();
    expect(u.find((x) => x.label === 'Rente')!.kind).toBe('income-start');
  });
});

describe('modèles de situations de vie', () => {
  it('chaque modèle produit un fait valide pour le moteur', () => {
    for (const def of LIFE_EVENTS) {
      const d = def.build({ label: 'Test', amount: '1000', startYear: String(YEAR + 1), endYear: String(YEAR + 3), startAge: '65' });
      expect(validateData(d.kind, d.data)).toEqual([]);
      expect(def.fields.every((f) => f.id && f.label)).toBe(true);
    }
  });

  it('aucun modèle n invente un montant: sans saisie, zéro', () => {
    for (const def of LIFE_EVENTS) expect(def.build({}).data.amount).toBe(0);
  });
});

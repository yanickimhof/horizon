import { describe, expect, it } from 'vitest';
import { Ledger } from './ledger';
import { project } from '../src/core/project';
import { loadDemo } from './demo';
import type { FactDraft } from '../src/core/types';

const draft = (over: Partial<FactDraft> = {}): FactDraft => ({
  kind: 'expense',
  key: 'expense:test',
  data: { label: 'Test', amount: 100, frequency: 'monthly' },
  status: 'assumed',
  origin: 'default',
  confidence: 0.3,
  sourceId: null,
  excerpt: null,
  why: 'test',
  ...over,
});

describe('ledger', () => {
  it('une valeur supposée ne remplace jamais un fait confirmé', () => {
    const l = new Ledger();
    l.confirmNew(draft({ status: 'confirmed', origin: 'user', data: { label: 'Test', amount: 250, frequency: 'monthly' } }));
    expect(l.assume(draft())).toBeNull();
    expect(l.currentOf('expense:test')?.data.amount).toBe(250);
  });

  it('une valeur supposée peut être remplacée par une autre valeur supposée', () => {
    const l = new Ledger();
    l.assume(draft());
    l.assume(draft({ data: { label: 'Test', amount: 120, frequency: 'monthly' } }));
    expect(l.currentOf('expense:test')?.data.amount).toBe(120);
    expect(l.history('expense:test').map((f) => f.status)).toEqual(['superseded', 'assumed']);
  });

  it('une proposition reste hors des calculs jusqu à confirmation, puis la correction est appliquée', () => {
    const l = new Ledger();
    l.assume(draft());
    const p = l.propose(draft({ status: 'proposed', origin: 'document', data: { label: 'Test', amount: 99, frequency: 'monthly' } }));
    expect(l.inbox()).toHaveLength(1);
    expect(project(l.current(), new Date(), l.rates()).expenses[0].monthly).toBe(100);

    l.confirm(p.id, { amount: 105 });
    expect(l.inbox()).toHaveLength(0);
    const s = project(l.current(), new Date(), l.rates());
    expect(s.expenses[0].monthly).toBe(105);
    expect(s.expenses[0].certainty).toBe('confirmed');
  });

  it('une correction conserve l historique', () => {
    const l = new Ledger();
    l.assume(draft());
    l.correct('expense:test', { amount: 80 }, 'lu sur la facture');
    const h = l.history('expense:test');
    expect(h).toHaveLength(2);
    expect(h[0].status).toBe('superseded');
    expect(h[1].origin).toBe('user');
  });

  it('refuse un fait inexploitable par le moteur', () => {
    const l = new Ledger();
    expect(() => l.assume(draft({ data: { label: 'Test', amount: 'beaucoup', frequency: 'monthly' } }))).toThrow(/nombre/);
    expect(() => l.assume(draft({ data: { label: 'Test', amount: 10, frequency: 'souvent' } }))).toThrow(/frequency/);
  });

  it('accepte des champs libres sans les perdre', () => {
    const l = new Ledger();
    l.confirmNew(draft({ status: 'confirmed', origin: 'user', data: { label: 'Test', amount: 10, frequency: 'monthly', carte: 'Visa', commentaire: 'à renégocier' } }));
    expect(l.currentOf('expense:test')?.data.commentaire).toBe('à renégocier');
  });

  it('mémorise les notes de contexte', () => {
    const l = new Ledger();
    loadDemo(l);
    expect(l.notes()[0].text).toMatch(/déménager/);
  });
});

describe('retrait d une ligne', () => {
  it('sort la ligne des calculs sans rien effacer', () => {
    const l = new Ledger();
    l.confirmNew({ kind: 'expense', key: 'expense:test', data: { label: 'Test', amount: 100, frequency: 'monthly' }, status: 'confirmed', origin: 'user', confidence: 1, sourceId: null, excerpt: null, why: null });
    expect(l.current().some((f) => f.key === 'expense:test')).toBe(true);
    expect(l.retire('expense:test')).toBe(true);
    expect(l.current().some((f) => f.key === 'expense:test')).toBe(false);
    expect(l.history('expense:test')).toHaveLength(1);
    expect(l.retire('expense:inconnue')).toBe(false);
  });
});

describe('notes modifiables', () => {
  it('modifie et supprime une note', () => {
    const l = new Ledger();
    const n = l.addNote('déménagement 2032');
    l.updateNote(n.id, 'déménagement 2034');
    expect(l.notes()[0].text).toBe('déménagement 2034');
    l.deleteNote(n.id);
    expect(l.notes()).toHaveLength(0);
  });
});

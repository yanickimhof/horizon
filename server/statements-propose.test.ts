import { describe, expect, it } from 'vitest';
import { Ledger } from './ledger';
import { proposeGap } from './statements-propose';

const confirmed = (key: string, data: Record<string, unknown>) => ({
  kind: 'expense' as const,
  key,
  data,
  status: 'confirmed' as const,
  origin: 'user' as const,
  confidence: 1,
  sourceId: null,
  excerpt: null,
  why: 'test',
});

describe('écart relevés / Horizon', () => {
  it('propose de relever la plus grosse ligne du groupe, sans rien confirmer', () => {
    const l = new Ledger(':memory:');
    l.confirmNew(confirmed('expense:courantes', { label: 'Dépenses courantes', category: 'lifestyle', amount: 3000, frequency: 'monthly', essential: true }));
    l.confirmNew(confirmed('expense:petit', { label: 'Petit', category: 'lifestyle', amount: 100, frequency: 'monthly', essential: true }));
    const r = proposeGap(l, { key: 'vie', statements: 3500, horizon: 3100 });
    expect(r.proposed).toBe(1);
    const inbox = l.inbox();
    expect(inbox).toHaveLength(1);
    expect(inbox[0].key).toBe('expense:courantes');
    expect(inbox[0].data.amount).toBe(3400);
    expect(l.current().find((f) => f.key === 'expense:courantes')!.data.amount).toBe(3000);
  });

  it('respecte une fréquence annuelle', () => {
    const l = new Ledger(':memory:');
    l.confirmNew(confirmed('expense:assurance', { label: 'Assurance', category: 'insurance', amount: 1200, frequency: 'annual', essential: true }));
    proposeGap(l, { key: 'assurances', statements: 150, horizon: 100 });
    expect(l.inbox()[0].data.amount).toBe(1800);
  });

  it('crée une ligne quand le groupe est vide, et ignore un écart négatif', () => {
    const l = new Ledger(':memory:');
    expect(proposeGap(l, { key: 'vehicule', statements: 200, horizon: 0 }).proposed).toBe(1);
    expect(l.inbox()[0].key).toBe('expense:releves-vehicule');
    expect(proposeGap(l, { key: 'vehicule', statements: 50, horizon: 300 }).proposed).toBe(0);
  });
});

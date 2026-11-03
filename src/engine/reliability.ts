import type { Snapshot } from './types';

/**
 * Fiabilité des données, 0 à 1 : part pondérée (par montant) de ce qui est
 * confirmé plutôt que supposé. Flux et stocks sont pesés séparément puis
 * moyennés, car un loyer annuel et un solde de compte n'ont pas la même échelle.
 */
export function reliability(s: Snapshot): { score: number; flows: number; stocks: number; weakest: string[] } {
  const part = (items: { w: number; ok: boolean }[]): number => {
    const total = items.reduce((a, i) => a + i.w, 0);
    if (total <= 0) return 1;
    return items.filter((i) => i.ok).reduce((a, i) => a + i.w, 0) / total;
  };
  const flows = [
    ...s.expenses.map((e) => ({ w: e.monthly, ok: e.certainty === 'confirmed' })),
    ...s.incomes.map((i) => ({ w: i.monthly, ok: i.certainty === 'confirmed' })),
  ];
  const stocks = [
    ...s.assets.map((a) => ({ w: a.value, ok: a.certainty === 'confirmed' })),
    ...s.liabilities.map((l) => ({ w: l.balance, ok: l.certainty === 'confirmed' })),
  ];
  const f = part(flows);
  const st = part(stocks);

  const weakest = [
    ...s.expenses.filter((e) => e.certainty === 'assumed').map((e) => ({ label: e.label, w: e.monthly * 12 })),
    ...s.incomes.filter((i) => i.certainty === 'assumed').map((i) => ({ label: i.label, w: i.monthly * 12 })),
    ...s.assets.filter((a) => a.certainty === 'assumed').map((a) => ({ label: a.label, w: a.value })),
    ...s.liabilities.filter((l) => l.certainty === 'assumed').map((l) => ({ label: l.label, w: l.balance })),
  ]
    .sort((a, b) => b.w - a.w)
    .slice(0, 3)
    .map((x) => x.label);

  return { score: (f + st) / 2, flows: f, stocks: st, weakest };
}

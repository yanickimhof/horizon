import { describe, expect, it } from 'vitest';
import { milaView } from './mila';
import { Ledger } from './ledger';
import { init } from './budget';

describe('milaView', () => {
  it('sépare loyer, école, repas, poche et virements, sans doublons', () => {
    const l = new Ledger(':memory:');
    init(l);
    let n = 0;
    const raw = l.raw.prepare("INSERT INTO budget_txs (id, account, date, amount, currency, label, category, source, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'test', '2026-11-08')");
    const ins = { run: (...a: (string | number)[]) => raw.run(String(n++), ...a) };
    ins.run('A', '2026-09-01', -450, 'CHF', 'Fondation du Balcon du Jura', 'enfants');
    ins.run('A', '2026-09-02', -90, 'CHF', 'Mila Imhof, Allée des Prés', 'famille');
    ins.run('A', '2026-09-03', -50, 'CHF', 'Transfert Mila Imhof', 'famille');
    ins.run('A', '2026-09-03', -50, 'CHF', 'Transfert Mila Imhof', 'doublon');
    ins.run('V', '2026-09-04', -8, 'CHF', 'Coop Pronto, Yverdon-les-B CH', 'alimentation');
    ins.run('V', '2026-09-05', -20, 'CHF', 'Migros Lausanne', 'alimentation');
    ins.run('A', '2026-09-06', -100, 'CHF', 'Débit TWINT Cataropro SA', 'enfants');
    const v = milaView(l, new Date('2026-11-08'));
    expect(v.totals).toEqual({ loyer: 450, ecole: 100, nourriture: 8, poche: 90, virement: 50 });
    expect(v.surPlaceMensuel).toBe(108);
  });
});

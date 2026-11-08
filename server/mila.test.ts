import { describe, expect, it } from 'vitest';
import { milaView } from './mila';
import { Ledger } from './ledger';
import { init } from './budget';

describe('milaView', () => {
  it('sépare ce que la famille paie et son compte, sans double compte', () => {
    const l = new Ledger(':memory:');
    init(l);
    let n = 0;
    const raw = l.raw.prepare("INSERT INTO budget_txs (id, account, date, amount, currency, label, category, source, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'test', '2026-11-08')");
    const ins = { run: (...a: (string | number)[]) => raw.run(String(n++), ...a) };
    ins.run('A', '2026-09-01', -450, 'CHF', 'Fondation du Balcon du Jura', 'enfants');
    ins.run('A', '2026-07-31', -450, 'CHF', 'Fondation du Balcon du Jura', 'enfants');
    ins.run('A', '2026-09-02', -90, 'CHF', 'Mila Imhof, Allée des Prés du Record', 'famille');
    ins.run('A', '2026-02-03', -50, 'CHF', 'Transfert Mila Imhof', 'famille');
    ins.run('A', '2026-08-17', -500, 'CHF', 'Transfert Mila Imhof Budget CPNV.', 'famille');
    ins.run('A', '2026-09-03', -50, 'CHF', 'Transfert Mila Imhof', 'doublon');
    ins.run('V', '2026-09-04', -8, 'CHF', 'Coop Pronto, Yverdon-les-B CH', 'alimentation');
    ins.run('V', '2026-08-07', -30, 'CHF', 'Boulangerie, Yverdon-les-B CH', 'restaurants');
    ins.run('V', '2026-09-05', -20, 'CHF', 'Migros Lausanne', 'alimentation');
    ins.run('A', '2026-09-06', -100, 'CHF', 'Débit TWINT Cataropro SA', 'enfants');
    ins.run('A', '2026-07-10', -344.96, 'CHF', 'Débit TWINT Cataropro SA', 'enfants');
    ins.run('V', '2026-03-16', -100, 'CHF', 'Payot Libraire SA, Lausanne CH', 'quotidien');
    l.raw.exec('CREATE TABLE IF NOT EXISTS mila_compte (id TEXT PRIMARY KEY, date TEXT NOT NULL, amount REAL NOT NULL, label TEXT NOT NULL)');
    const acc = l.raw.prepare('INSERT INTO mila_compte (id, date, amount, label) VALUES (?, ?, ?, ?)');
    acc.run('1', '2026-08-10', 50, 'Transfert Imhof Yanick');
    acc.run('2', '2026-08-17', 500, 'Transfert Imhof Yanick');
    acc.run('3', '2026-09-10', -30, 'Migros M Ste-Croix');
    acc.run('4', '2026-09-11', -20, 'Burger King Lausanne');
    acc.run('6', '2026-09-13', -6, 'Pharmacie Sun Store 1210');
    acc.run('5', '2026-09-12', 10, 'Crédit TWINT Cavin, Ana');
    const v = milaView(l, new Date('2026-11-08'));
    const fam = Object.fromEntries(v.famille.couts.map((x) => [x.key, x.total]));
    // Avant le 17 août: seul le CPNV compte (fournitures); ni loyer, ni repas, ni Payot Lausanne.
    expect(fam).toEqual({ loyer: 450, ecole: 444.96, nourriture: 8 });
    expect(v.famille.epargne[0].total).toBe(90);
    // Le virement du 17 août finance son compte: il n'est pas compté deux fois.
    expect(v.famille.financement[0].total).toBe(500);
    expect(v.compte?.totalEntrees).toBe(500);
    expect(v.compte?.totalSorties).toBe(36);
    expect(v.compte?.hors).toBe(20);
    expect(v.compte?.solde).toBe(35.76 + 50 + 500 - 30 - 20 + 10 - 6);
    expect(v.cout.total).toBe(902.96 + 36);
  });
});

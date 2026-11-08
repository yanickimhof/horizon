import { describe, expect, it } from 'vitest';
import { Ledger } from './ledger';
import { addEstimate, budgetView, kindOf, labelTransactions, removeEstimate, storeStatements } from './budget';
import { classify, parseStatement, type ParsedStatement } from './statements';

const stmt = (account: string, rows: [string, string, number, string?][]): ParsedStatement => ({
  account,
  txs: rows.map(([date, label, amount, ccy]) => ({ account, date, label, amount, category: amount > 0 ? 'revenu' : 'inconnu', source: 'aucune' as const, ...(ccy ? { currency: ccy } : {}) })),
});

describe('relevé Raiffeisen', () => {
  it('lit les lignes de détail comme une suite du libellé', () => {
    const csv = [
      'IBAN;Booked At;Text;Credit/Debit Amount;Balance;Valuta Date',
      'CH9300762011623852957;2024-02-01 00:00:00.0;E-banking Ordre à RCH Zentralverwaltung;-189.8;272.84;2024-02-01 00:00:00.0',
      ';;Raiffeisenplatz 9001 St. Gallen Bestellung Bargeld JPY 30000.00 CHF 189.80;;;',
      'CH9300762011623852957;2024-02-12 00:00:00.0;Crédit Exemple Alex;1000;1272.84;2024-02-12 00:00:00.0',
    ].join('\n');
    const s = parseStatement('Konto.csv', csv);
    expect(s.txs).toHaveLength(2);
    expect(s.txs[0].date).toBe('2024-02-01');
    expect(s.txs[0].amount).toBe(-189.8);
    expect(s.txs[0].label).toContain('Bestellung Bargeld');
    expect(s.account).toContain('2957');
  });
});

describe('base de transactions', () => {
  it('n’enregistre qu’une fois une ligne, même si les exports se recouvrent', () => {
    const l = new Ledger(':memory:');
    const a = stmt('Salaire', [['2026-09-05', 'Migros', -50], ['2026-09-06', 'Coop', -30], ['2026-09-06', 'Coop', -30]]);
    expect(storeStatements(l, [a], 'sept.csv')).toMatchObject({ added: 3, skipped: 0 });
    // Un second export recoupe le premier: deux lignes identiques le même jour restent deux lignes.
    const b = stmt('Salaire', [['2026-09-06', 'Coop', -30], ['2026-09-06', 'Coop', -30], ['2026-09-07', 'Denner', -20]]);
    const r = storeStatements(l, [b], 'sept-oct.csv');
    expect(r.added).toBe(1);
    expect(r.skipped).toBe(2);
    expect(budgetView(l).count).toBe(4);
  });

  it('déduit un solde de décompte en notre faveur des charges du bien, sans le compter en loyer', () => {
    const l = new Ledger(':memory:');
    const a = stmt('Salaire', [['2026-09-10', 'Facture Orion', -500], ['2026-09-20', 'Solde decompte 2025 Orion', 200]]);
    storeStatements(l, [a]);
    // Le classement automatique est celui des relevés; ici on fixe la catégorie comme le ferait une règle de l'utilisateur.
    l.raw.prepare("UPDATE budget_txs SET category = 'logement', bien = 'Orion'").run();
    const m = budgetView(l, new Date('2026-10-15')).months.find((x) => x.month === '2026-09')!;
    expect(m.immo.Orion).toEqual({ loyers: 0, charges: 300 });
  });

  it('ne compte pas un virement entre deux comptes comme une dépense', () => {
    const l = new Ledger(':memory:');
    storeStatements(l, [stmt('Salaire', [['2026-09-10', 'Ordre permanent', -1000]]), stmt('Loyer', [['2026-09-10', 'Versement reçu', 1000]]), stmt('Salaire', [['2026-09-12', 'Migros', -80]])]);
    const m = budgetView(l, new Date('2026-10-15')).months.find((x) => x.month === '2026-09')!;
    expect(m.spend).toBeCloseTo(80, 5);
    expect(m.income).toBe(0);
  });

  it('ne compte pas deux fois une carte dont le détail est présent', () => {
    const l = new Ledger(':memory:');
    const compte = stmt('Salaire', [['2026-09-20', 'Débit LSV Visa', -500]]);
    compte.txs[0].category = 'carte';
    const carte = stmt('Carte Visa', [['2026-09-03', 'Restaurant', -200], ['2026-09-04', 'Essence', -300]]);
    carte.txs.forEach((t) => (t.category = 'quotidien'));
    storeStatements(l, [compte, carte]);
    const m = budgetView(l, new Date('2026-10-15')).months.find((x) => x.month === '2026-09')!;
    expect(m.spend).toBeCloseTo(500, 5);
    expect(kindOf('Carte Visa')).toBe('card');
  });

  it('convertit les devises étrangères et mémorise un classement', () => {
    const l = new Ledger(':memory:');
    storeStatements(l, [stmt('Compte USD', [['2026-09-02', 'Zork Corp', -100, 'USD']]), stmt('Salaire', [['2026-09-03', 'Boutique X', -40]])]);
    const view = budgetView(l, new Date('2026-10-15'));
    expect(view.currencies).toEqual(['CHF', 'USD']);
    expect(view.unknown.count).toBe(2);
    expect(labelTransactions(l, 'boutique x|40.00', 'quotidien')).toBe(1);
    expect(budgetView(l, new Date('2026-10-15')).unknown.count).toBe(1);
  });
});

describe('classement des lignes bancaires courantes', () => {
  it('reconnaît espèces, frais bancaires, parts sociales et dépôts', () => {
    expect(classify('Retrait au Bancomat BR Morges 15.06.2026 No carte Visa Debit', -2000).category).toBe('especes');
    expect(classify('Prix du paquet Raiffeisen Member 01.10.2026', -9).category).toBe('banque');
    expect(classify('Taxe annuelle Visa Debit Card', -50).category).toBe('banque');
    expect(classify('Souscription 100 Part(s) sociale(s)', -20000).category).toBe('epargne');
    expect(classify('Dépot au Bancomat BR Morges', 200).category).toBe('interne');
    expect(classify('E-banking Ordre à RCH Zentralverwaltung Bestellung Bargeld JPY', -189.8).category).toBe('especes');
  });
});

describe('catégories standard', () => {
  it('range les achats courants dans des catégories parlantes', () => {
    const cat = (label: string) => classify(label, -20).category;
    expect(cat('COOP Morges')).toBe('alimentation');
    expect(cat('Restaurant Le Lac')).toBe('restaurants');
    expect(cat('NETFLIX.COM')).toBe('abonnements');
    expect(cat('Anthropic Claude Pro')).toBe('abonnements');
    expect(cat('Swisscom (Suisse) SA')).toBe('telecom');
    expect(cat('SBB CFF FFS')).toBe('transports');
    expect(cat('Booking.com')).toBe('voyages');
    expect(cat('IKEA Aubonne')).toBe('maison');
    expect(cat('Revolut top-up')).toBe('neobanque');
    expect(cat('Migros Bank virement')).not.toBe('alimentation');
  });
});

describe('dépenses connues hors relevés', () => {
  it('ajoute une estimation chaque mois, sauf quand une ligne réelle la couvre', () => {
    const l = new Ledger(':memory:');
    storeStatements(l, [stmt('Salaire', [['2026-08-10', 'Coop', -100], ['2026-09-10', 'Netflix', -20], ['2026-09-11', 'Coop', -100]])]);
    addEstimate(l, { label: 'Netflix', amount: 20, currency: 'CHF', per: 'month', category: 'abonnements' });
    const view = budgetView(l, new Date('2026-10-15'));
    const aug = view.months.find((m) => m.month === '2026-08')!;
    const sep = view.months.find((m) => m.month === '2026-09')!;
    expect(aug.estimated).toBeCloseTo(20, 5);
    expect(aug.spend).toBeCloseTo(120, 5);
    expect(sep.estimated).toBe(0);
    removeEstimate(l, view.estimates[0].id);
    expect(budgetView(l, new Date('2026-10-15')).estimates).toHaveLength(0);
  });

  it('convertit une estimation annuelle en USD', () => {
    const l = new Ledger(':memory:');
    storeStatements(l, [stmt('Salaire', [['2026-09-10', 'Coop', -100]])]);
    addEstimate(l, { label: 'Claude Pro', amount: 240, currency: 'USD', per: 'year', category: 'abonnements' });
    const sep = budgetView(l, new Date('2026-10-15')).months[0];
    expect(sep.estimated).toBeGreaterThan(10);
    expect(sep.estimated).toBeLessThan(25);
  });
});

describe('même compte lu deux fois', () => {
  it('ne compte qu’une fois les lignes d’un export CSV et du PDF du même relevé', () => {
    const l = new Ledger(':memory:');
    const dates = ['2026-09-01', '2026-09-03', '2026-09-05', '2026-09-08', '2026-09-10', '2026-09-12'];
    const csv = stmt('BM_Salaire', dates.map((d, i) => [d, `Achat commerce ${i}, Morges CH, détail`, -(10 + i)] as [string, string, number]));
    const pdf = stmt('Salaire', dates.map((d, i) => [d.replace(/-0(\d)$/, (_m, x) => `-0${Math.min(9, Number(x) + 1)}`), `Commerce ${i}`, -(10 + i)] as [string, string, number]));
    storeStatements(l, [csv]);
    storeStatements(l, [pdf]);
    const m = budgetView(l, new Date('2026-10-15')).months.find((x) => x.month === '2026-09')!;
    expect(m.spend).toBeCloseTo(10 + 11 + 12 + 13 + 14 + 15, 5);
  });

  it('garde un compte différent dont les montants ne correspondent pas', () => {
    const l = new Ledger(':memory:');
    const dates = ['2026-09-01', '2026-09-03', '2026-09-05', '2026-09-08', '2026-09-10', '2026-09-12'];
    storeStatements(l, [stmt('Compte A', dates.map((d, i) => [d, `A ${i}`, -(10 + i)] as [string, string, number])), stmt('Compte B', dates.map((d, i) => [d, `B ${i}`, -(100 + i)] as [string, string, number]))]);
    const m = budgetView(l, new Date('2026-10-15')).months.find((x) => x.month === '2026-09')!;
    expect(m.spend).toBeGreaterThan(600);
  });
});

describe('virements dans la famille', () => {
  it('traite un virement vers soi comme interne et un virement vers un enfant comme une dépense (virement vers un enfant)', () => {
    const l = new Ledger(':memory:');
    l.confirmNew({ kind: 'household', key: 'household', data: { name: 'Alex', members: [{ name: 'Alex', role: 'adult' }, { name: 'Sam', role: 'adult' }, { name: 'Léa', role: 'child' }] }, status: 'confirmed', origin: 'user', confidence: 1, sourceId: null, excerpt: null, why: 'test' });
    storeStatements(l, [stmt('Salaire', [['2026-09-05', 'Alex Exemple, Rue des Exemples 1, 1110 Morges', -1850], ['2026-09-06', 'Sam Exemple, Rue des Exemples 1', -300], ['2026-09-07', 'Léa Exemple, Rue des Exemples 1, 1110 Morges', -90], ['2026-09-08', 'Coop', -50]])]);
    const m = budgetView(l, new Date('2026-10-15')).months.find((x) => x.month === '2026-09')!;
    expect(m.byCategory.famille).toBeCloseTo(90, 5);
    expect(m.spend).toBeCloseTo(140, 5);
  });
});

describe('revenus exceptionnels automatiques', () => {
  it('repère seul un versement très au-dessus de l’habitude et un gros versement unique', () => {
    const l = new Ledger(':memory:');
    const sal = ['2026-03-25', '2026-04-25', '2026-05-25', '2026-06-25', '2026-07-25'].map((d) => [d, 'ACME SARL, Route 1, 1000 Lausanne', 9000] as [string, string, number]);
    storeStatements(l, [stmt('Salaire', [...sal, ['2026-08-25', 'ACME SARL, Route 1, 1000 Lausanne', 60000], ['2026-08-10', 'Vente Garage SA, Rue 2', 20000], ['2026-08-11', 'Coop', -50]])]);
    const view = budgetView(l, new Date('2026-10-15'));
    const aug = view.months.find((m) => m.month === '2026-08')!;
    expect(aug.income).toBe(0);
    expect(view.months.find((m) => m.month === '2026-07')!.income).toBe(9000);
  });

  it('respecte le choix de l’utilisateur', () => {
    const l = new Ledger(':memory:');
    const sal = ['2026-03-25', '2026-04-25', '2026-05-25', '2026-06-25'].map((d) => [d, 'ACME SARL, Route 1', 9000] as [string, string, number]);
    storeStatements(l, [stmt('Salaire', [...sal, ['2026-07-25', 'ACME SARL, Route 1', 40000]])]);
    labelTransactions(l, 'acme sarl, route 1|40000.00', 'revenu');
    expect(budgetView(l, new Date('2026-10-15')).months.find((m) => m.month === '2026-07')!.income).toBe(40000);
  });

  it('compte les petites lignes inconnues comme Autre sans les demander', () => {
    const l = new Ledger(':memory:');
    storeStatements(l, [stmt('Salaire', [['2026-09-03', 'Boutique X', -9], ['2026-09-04', 'Gros truc inconnu', -200]])]);
    const view = budgetView(l, new Date('2026-10-15'));
    expect(view.unknownSamples).toHaveLength(1);
    expect(view.months[0].byCategory.autre).toBeCloseTo(9, 5);
  });
});

describe('remboursements et épargne nette', () => {
  it('range un remboursement de la PPE ou d’un achat en ligne dans la dépense, pas dans le revenu', () => {
    expect(classify('PPE OSIRIS BATIMENT 7A, CHEMIN DU CREPON, 1040 ECHALLENS, [IBAN] FA 261167 Du 16.07.2026', 55.9).category).toBe('maison');
    expect(classify('Crédit TWINT Digitec Galaxus 0400004412241202', 55.9).category).toBe('maison');
    expect(classify('Salaire ACME SARL', 5000).category).toBe('revenu');
  });

  it('déduit de l’épargne un remboursement de 3e pilier', () => {
    const l = new Ledger(':memory:');
    storeStatements(l, [stmt('Salaire', [['2026-03-05', 'VZ 3e pilier versement', -7258], ['2026-09-05', 'VZ 3e pilier remboursement', 3910]])]);
    const view = budgetView(l, new Date('2026-10-15'));
    expect(view.months.find((m) => m.month === '2026-03')!.saved).toBe(7258);
    expect(view.months.find((m) => m.month === '2026-09')!.saved).toBe(-3910);
  });
});

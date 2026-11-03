import { describe, expect, it } from 'vitest';
import { Ledger } from './ledger';
import { budgetView, labelTransactions, storeStatements } from './budget';
import { loadDemoBudget } from './demo-budget';
import { classify, isGenericPayee, signatureKey, type ParsedStatement } from './statements';

const stmt = (account: string, rows: [string, string, number][]): ParsedStatement => ({
  account,
  txs: rows.map(([date, label, amount]) => ({ account, date, label, amount, category: amount > 0 ? 'revenu' : 'inconnu', source: 'aucune' as const })),
});
const cat = (l: Ledger, label: string): string => (l.raw.prepare('SELECT category FROM budget_txs WHERE label LIKE ?').get(`%${label}%`) as { category: string }).category;

describe('revenus exceptionnels: on compare des mois, pas des lignes', () => {
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];

  it('un loyer versé en retard ou en deux fois n’est pas exceptionnel', () => {
    const l = new Ledger(':memory:');
    const rows: [string, string, number][] = months.map((m) => [`${m}-20`, 'REGIE EXEMPLE SA, Lausanne Versement disponible', 5300]);
    rows.push(['2026-06-03', 'REGIE EXEMPLE SA, Lausanne Versement disponible', 10600]);
    storeStatements(l, [stmt('Loyer', rows)], 'loyer.csv');
    expect(budgetView(l).months.reduce((s, m) => s + m.exceptional, 0)).toBe(0);
  });

  it('un premier salaire chez un nouvel employeur n’est pas exceptionnel', () => {
    const l = new Ledger(':memory:');
    storeStatements(l, [stmt('Salaire', [['2026-10-23', 'NOUVEL EMPLOYEUR SA, Lausanne Salaire', 5529]])], 's.csv');
    expect(cat(l, 'NOUVEL EMPLOYEUR')).toBe('revenu');
  });

  it('une indemnité de départ très supérieure au salaire habituel est mise à part', () => {
    const l = new Ledger(':memory:');
    const rows: [string, string, number][] = months.map((m) => [`${m}-25`, 'ANCIEN EMPLOYEUR SA, Lausanne Paiement de salaire', 9848]);
    rows.push(['2026-06-25', 'ANCIEN EMPLOYEUR SA, Lausanne Paiement de salaire', 105300]);
    storeStatements(l, [stmt('Salaire', rows)], 'salaire.csv');
    expect(budgetView(l).months.find((m) => m.month === '2026-06')?.exceptional).toBe(105300);
  });
});

describe('motifs suisses courants', () => {
  it.each([
    ['CA Auto Finance Suisse SA, Schlieren', 'vehicule'],
    ['VZ VersicherungsPool AG, Zürich', 'assurances'],
    ['HD Clinics SA, Lausanne', 'sante'],
    ['Ville de Vevey, Rue du Lac 2', 'impots'],
    ['SERAFE AG, Pfäffikon', 'abonnements'],
    ['Fondation du Balcon du Jura, p.a. Fiduciaire Jaques SA', 'dons'],
  ])('%s est classé en %s', (label, expected) => {
    expect(classify(label, -100).category).toBe(expected);
  });
});

describe('doublon entre deux exports: la ligne gardée prend le libellé le plus complet', () => {
  it('« Paiement » devient le nom du bénéficiaire', () => {
    const l = new Ledger(':memory:');
    const dates = ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30', '2026-04-06', '2026-04-13'];
    const full = dates.map((d, i): [string, string, number] => [d, i === 6 ? 'Etat de Vaud - Impôts, 1014 Lausanne Adm cant' : `Coop Morges ${i}`, -(40 + i * 7)]);
    const poor = dates.map((d, i): [string, string, number] => [d, i === 6 ? 'Paiement' : `Coop Morges ${i}`, -(40 + i * 7)]);
    storeStatements(l, [stmt('Compte complet', full), stmt('Compte pauvre', poor)], 'x.csv');
    const rows = l.raw.prepare("SELECT account, label, category FROM budget_txs WHERE amount = -82 AND category <> 'doublon'").all() as { account: string; label: string; category: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('impots');
  });
});

describe('mémoire par émetteur', () => {
  it('classer une ligne d’un émetteur classe tous ses montants, passés et futurs', () => {
    const l = new Ledger(':memory:');
    storeStatements(l, [stmt('Compte', [['2026-03-01', 'Atelier Exemple SARL, Facture 12', -86], ['2026-04-02', 'Atelier Exemple SARL, Facture 19', -240], ['2026-04-03', 'Paiement', -50]])], 'a.csv');
    const key = signatureKey('Atelier Exemple SARL, Facture 12', -86);
    expect(labelTransactions(l, key, 'loisirs', 'payee')).toBe(2);
    expect(cat(l, 'Facture 19')).toBe('loisirs');
    // Un futur import du même émetteur est classé sans rien demander.
    storeStatements(l, [stmt('Compte', [['2026-05-05', 'Atelier Exemple SARL, Facture 27', -310]])], 'b.csv');
    expect(cat(l, 'Facture 27')).toBe('loisirs');
  });

  it('ne mémorise jamais un libellé générique comme « Paiement »', () => {
    const l = new Ledger(':memory:');
    storeStatements(l, [stmt('Compte', [['2026-03-01', 'Paiement', -50], ['2026-03-02', 'Paiement', -80]])], 'a.csv');
    expect(labelTransactions(l, signatureKey('Paiement', -50), 'loisirs', 'payee')).toBe(1);
    expect(isGenericPayee('Paiement')).toBe(true);
  });
});

describe('démonstration', () => {
  it('le budget fictif est rempli, sans donnée personnelle, avec un domicile et un bien loué', () => {
    const l = new Ledger(':memory:');
    loadDemoBudget(l);
    const v = budgetView(l);
    expect(v.count).toBeGreaterThan(1000);
    expect(v.homes).toEqual(['Domicile']);
    const immo = v.months.flatMap((m) => Object.keys(m.immo));
    expect(immo).toContain('Studio');
    expect(JSON.stringify(v)).not.toMatch(/imhof|yanick/i);
  });

  it('« Café » est reconnu comme un restaurant (une lettre accentuée ne casse pas la limite de mot)', () => {
    expect(classify('Café du Marché CH', -23).category).toBe('restaurants');
  });
});

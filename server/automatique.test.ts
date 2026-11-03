import { describe, expect, it } from 'vitest';
import { Ledger } from './ledger';
import { budgetView, labelTransactions, setBiens, storeStatements } from './budget';
import { loadDemoBudget } from './demo-budget';
import { recurringView } from './recurring';
import { supplierOf } from './supplier';
import { decomptesView, parseDecompte } from './decompte';
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

describe('biens saisis par l’utilisateur', () => {
  it('rattache les lignes au bien, avec période, et défait le rattachement quand la règle disparaît', () => {
    const l = new Ledger(':memory:');
    storeStatements(l, [stmt('Compte', [['2026-03-05', 'Régie du Lac, Loyer studio', 1200], ['2026-09-05', 'Régie du Lac, Loyer studio', 1300], ['2026-03-09', 'Menuiserie Dupont, Facture 12', -800]])], 'c.csv');
    const bien = (label: string, date: string) => (l.raw.prepare('SELECT bien FROM budget_txs WHERE label LIKE ? AND date = ?').get(`%${label}%`, date) as { bien: string | null }).bien;
    setBiens(l, [{ re: 'Régie du Lac', bien: 'Studio', to: '2026-06-30' }, { re: 'Régie du Lac', bien: 'Appartement', from: '2026-07-01', home: true }, { re: 'Menuiserie Dupont', bien: 'Studio' }]);
    expect(bien('Régie', '2026-03-05')).toBe('Studio');
    expect(bien('Régie', '2026-09-05')).toBe('Appartement');
    expect(budgetView(l).homes).toEqual(['Appartement']);
    setBiens(l, []);
    expect(bien('Régie', '2026-03-05')).toBeNull();
    expect(() => setBiens(l, [{ re: '(', bien: 'X' }])).toThrow(/Motif invalide/);
  });
});

describe('versements de loyer en bloc', () => {
  it('sont répartis selon la répartition détaillée du même émetteur', () => {
    const l = new Ledger(':memory:');
    storeStatements(l, [stmt('Loyer', [['2026-01-20', 'REGIE EXEMPLE SA, Lausanne Loyer studio', 1000], ['2026-01-20', 'REGIE EXEMPLE SA, Lausanne Loyer villa', 3000], ['2025-12-09', 'REGIE EXEMPLE SA, Lausanne Versement disponible', 4000]])], 'l.csv');
    setBiens(l, [{ re: 'studio', bien: 'Studio' }, { re: 'villa', bien: 'Villa' }]);
    const v = budgetView(l, new Date('2026-03-01'));
    const dec = v.months.find((m) => m.month === '2025-12')!;
    expect(Math.round(dec.immo.Studio.loyers)).toBe(1000);
    expect(Math.round(dec.immo.Villa.loyers)).toBe(3000);
    expect(dec.immo['Non réparti']).toBeUndefined();
  });
});

describe('ce qui revient, le quotidien, l’exceptionnel', () => {
  const months = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(2024, 9 + i, 5);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  it('sépare un abonnement, un commerçant et une grosse dépense, et compare à l’année précédente', () => {
    const l = new Ledger(':memory:');
    const rows: [string, string, number][] = [];
    months.forEach((m, i) => {
      rows.push([`${m}-05`, 'Salt Mobile SA, Avenue de Malley 2 Facture', i < 12 ? -90 : -110]);
      rows.push([`${m}-10`, 'Coop-1115 Echallens, Echallens CH', -120 - (i % 3) * 40]);
      rows.push([`${m}-18`, 'Coop-1115 Echallens, Echallens CH', -80]);
    });
    rows.push(['2026-03-12', 'Garage Exemple SA, Lausanne Réparation', -2400]);
    storeStatements(l, [stmt('Compte', rows)], 'c.csv');
    l.raw.exec("UPDATE budget_txs SET category = 'telecom' WHERE label LIKE 'Salt%'");
    l.raw.exec("UPDATE budget_txs SET category = 'alimentation' WHERE label LIKE 'Coop%'");
    l.raw.exec("UPDATE budget_txs SET category = 'vehicule' WHERE label LIKE 'Garage%'");
    const v = recurringView(l, new Date('2026-10-15'));
    const salt = v.recurring.find((r) => r.label.startsWith('Salt'))!;
    expect(salt.cadence).toBe('mensuel');
    expect(Math.round(salt.perYear)).toBe(1320);
    expect(salt.lever).toBe(true);
    expect(salt.trend).toBeCloseTo(110 / 90 - 1, 2);
    expect(v.recurring.some((r) => r.label.startsWith('Coop'))).toBe(false);
    expect(v.merchants[0].label).toMatch(/Coop/);
    expect(v.oneOffs[0]).toMatchObject({ amount: 2400 });
    expect(Math.round(v.totals.recurring + v.totals.daily + v.totals.exceptional)).toBe(Math.round(v.recurring.reduce((t, r) => t + r.perYear, 0) + v.merchants.reduce((t, m) => t + m.total, 0) + 2400));
  });
});

describe('un fournisseur se dit comme on le dit', () => {
  const me = { selfNames: ['alex'] };
  it('regroupe les magasins, adresses et numéros d’un même fournisseur', () => {
    expect(supplierOf('Migros M Echallens, Echallens CH', me).name).toBe('Migros');
    expect(supplierOf('Migros M Lausanne, Lausanne CH', me).name).toBe('Migros');
    expect(supplierOf('Coop-1115 Echallen, Echallens CH', me).name).toBe('Coop');
    expect(supplierOf('CSS Kranken-Versicherung AG, Tribschenstrasse 21, 6005 Luzern', me).name).toBe('CSS');
    expect(supplierOf('CSS Kranken-Versicherung AG Hauptsitz, 6002 Luzern', me).name).toBe('CSS');
    expect(supplierOf('Débit TWINT Parkingpay-TWINT 0400003359081185', me).name).toBe('Parkings');
    expect(supplierOf('APCOA Parking Montbenon, Lausanne CH', me).name).toBe('Parkings');
    expect(supplierOf('NOTION LABS, [TEL] IE', me).name).toBe('Notion');
    expect(supplierOf('ALIEXPRESS.COM, [TEL] IE', me).name).toBe('AliExpress');
    expect(supplierOf('HOTEL DES RASSES SA, 1452 Les Rasses', me).name).toBe('Hotel des Rasses');
    expect(supplierOf('NG DENTAL SURGERY, Lausanne CH', me).name).toBe('NG Dental Surgery');
    expect(supplierOf('Www.aliexpress.com, Dublin', me).name).toBe('AliExpress');
    expect(supplierOf('BOULANGERIE DU MARCHE.CH, Lausanne CH', me).name).toBe('Boulangerie du Marche');
    expect(supplierOf("Commune d'Echallens, 1040 Echallens", me).name).toBe("Commune d'Echallens");
    expect(supplierOf('Débit des taxes pour la tenue de compte', me).name).toBe('Frais bancaires');
  });
  it('lit la mention libre quand le bénéficiaire est soi-même', () => {
    expect(supplierOf("Monsieur Alex Exemple &, Madame Sam Exemple, 1040 Echallens Débit d'intérêts Hypothèque SARON 70.232.040", { ...me, bien: 'Osiris' }).name).toBe('Intérêts hypothécaires, Osiris');
    expect(supplierOf('Alex Exemple, Rue des Exemples 1, 1004 Lausanne Leasing: 504008 Leasing order no: [NUMERO]', me).name).toBe('Leasing 504008');
    expect(supplierOf('Alex Exemple, Rue des Exemples 1, 1040 Echallens Belastung der Amortisation auf Prêt hypoth. taux fix', { ...me, bien: 'Osiris' }).name).toBe('Amortissement hypothécaire, Osiris');
  });
  it('nomme les charges de copropriété par bien', () => {
    expect(supplierOf('PPE OSIRIS 7 A, p.a. Gérance SA, 1040 Echallens', { ...me, bien: 'Osiris' }).name).toBe('Charges PPE, Osiris');
  });
});

describe('noms de fournisseurs choisis', () => {
  it('un nom choisi remplace la lecture automatique et regroupe les variantes', () => {
    const l = new Ledger(':memory:');
    const rows: [string, string, number][] = [];
    for (let i = 1; i <= 8; i++) {
      const m = String(i).padStart(2, '0');
      rows.push([`2026-${m}-02`, 'Transfert Léa Exemple', -90], [`2026-${m}-12`, 'Léa Exemple, Rue des Exemples 1, 1040 Echallens', -0.5 * 0 - 1]);
    }
    storeStatements(l, [stmt('Compte', rows)], 'c.csv');
    l.raw.exec("UPDATE budget_txs SET category = 'famille'");
    l.setSetting('budget.fournisseurs', JSON.stringify([{ re: 'l[ée]a exemple', name: 'Argent de poche, Léa' }]));
    const v = recurringView(l, new Date('2026-10-15'));
    expect(v.recurring.map((r) => r.label)).toContain('Argent de poche, Léa');
  });
});

describe('décompte annuel de copropriété', () => {
  const doc = "Gérance SA Décompte de copropriété du 01.04.2025 au 31.03.2026 présente un solde en votre faveur de Fr. -555.25. Ce montant sera viré. PPE Les Cèdres 7A - Charges fiscales - Exercice du 01.04.2025 au 31.03.2026 Nous détaillons les frais déductibles fiscalement relatifs à votre part de copropriété. Recettes de buanderie -46.55 Conciergerie 731.60 Electricité 214.00 Honoraires d'administration 871.85 Frais parcelle 2104 - strate 3 647.45 Assurances 467.90 TOTAL 2886.25 Nous demeurons à votre disposition.";
  it('lit les rubriques et le total', () => {
    const [d] = parseDecompte(doc);
    expect(d.from).toBe('2025-04-01');
    expect(d.lines.map((x) => x.label)).toEqual(['Recettes de buanderie', 'Conciergerie', 'Electricité', "Honoraires d'administration", 'Frais parcelle 2104 - strate 3', 'Assurances']);
    expect(d.total).toBe(2886.25);
    expect(d.lines.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(d.total, 2);
  });
  it('rapproche le décompte des versements à la PPE et du solde', () => {
    const l = new Ledger(':memory:');
    l.raw.prepare("INSERT INTO sources (id, kind, name, added_at) VALUES ('s1', 'doc', 'decompte.pdf', '2026-06-01')").run();
    l.indexChunks('s1', [doc]);
    storeStatements(l, [stmt('Compte', [['2025-07-01', 'PPE LES CEDRES 7 A, p.a. Gérance SA, 1040 Echallens', -2000], ['2026-01-05', 'PPE LES CEDRES 7 A, p.a. Gérance SA, 1040 Echallens', -2000], ['2026-04-10', 'PPE LES CEDRES 7 A, p.a. Gérance SA, 1040 Echallens', -2000], ['2026-06-12', 'PPE LES CEDRES 7 A, p.a. Gérance SA, 1040 Echallens', -1444.75]])], 'c.csv');
    setBiens(l, [{ re: 'c[èe]dres', bien: 'Cèdres' }]);
    const [d] = decomptesView(l);
    expect(d.bien).toBe('Cèdres');
    expect(d.paid).toBe(4000);
    expect(d.solde).toBeCloseTo(555.25, 2);
    expect(d.settled).toBe('2026-06-12');
  });
});

describe('remboursements', () => {
  it('viennent en déduction du fournisseur concerné', () => {
    const l = new Ledger(':memory:');
    const rows: [string, string, number][] = [];
    for (let i = 1; i <= 6; i++) rows.push([`2026-0${i}-05`, 'Assurance Exemple AG, Lausanne Prime', -500]);
    rows.push(['2026-03-20', 'Assurance Exemple AG, Lausanne Remboursement', 300]);
    storeStatements(l, [stmt('Compte', rows)], 'c.csv');
    l.raw.exec("UPDATE budget_txs SET category = 'assurances'");
    const v = recurringView(l, new Date('2026-08-15'), '2026');
    const a = v.recurring.find((r) => r.label.startsWith('Assurance'))!;
    expect(Math.round(a.perYear)).toBe(2700);
  });
});

describe('quotidien, exceptionnel et immobilier ne se recoupent pas', () => {
  it('range un travail dans l’immobilier, un impôt et une grosse dépense dans l’exceptionnel, le reste dans le quotidien', () => {
    const l = new Ledger(':memory:');
    const rows: [string, string, number][] = [];
    for (let i = 1; i <= 6; i++) rows.push([`2026-0${i}-04`, 'Epicerie Exemple, Echallens CH', -90]);
    rows.push(['2026-02-10', 'Epicerie Exemple, Echallens CH', -1200]);
    rows.push(['2026-03-15', 'Artisan Exemple SA, 1040 Echallens Facture', -2000]);
    rows.push(['2026-04-20', 'Etat de Vaud Impôts, 1014 Lausanne Acompte', -800]);
    rows.push(['2026-05-02', 'Magasin de meubles Exemple, Lausanne CH', -450]);
    storeStatements(l, [stmt('Compte', rows)], 'c.csv');
    l.raw.exec("UPDATE budget_txs SET category = 'alimentation' WHERE label LIKE 'Epicerie%'");
    l.raw.exec("UPDATE budget_txs SET category = 'travaux', bien = 'Villa' WHERE label LIKE 'Artisan%'");
    l.raw.exec("UPDATE budget_txs SET category = 'impots' WHERE label LIKE 'Etat de Vaud%'");
    l.raw.exec("UPDATE budget_txs SET category = 'maison' WHERE label LIKE 'Magasin%'");
    const v = recurringView(l, new Date('2026-08-15'), '2026');
    expect(v.works.map((w) => w.amount)).toEqual([2000]);
    expect(v.oneOffs.map((o) => o.category).sort()).toEqual(['alimentation', 'impots', 'maison']);
    expect(v.merchants.find((m) => m.label.startsWith('Epicerie'))!.total).toBe(540);
    expect(v.totals.works).toBe(2000);
  });
});

describe('assurance maladie: prime et participations aux soins', () => {
  it('sépare la prime qui revient des petits paiements variables et des remboursements', () => {
    const l = new Ledger(':memory:');
    const rows: [string, string, number][] = [];
    for (let i = 1; i <= 8; i++) {
      const m = String(i).padStart(2, '0');
      rows.push([`2026-${m}-02`, 'Assurance Santé Exemple, Berne Prime', -1000]);
      rows.push([`2026-${m}-12`, 'Assurance Santé Exemple, Berne Facture', -(20 + i * 7)]);
    }
    rows.push(['2026-05-20', 'Assurance Santé Exemple, Berne Remboursement', 120]);
    storeStatements(l, [stmt('Compte', rows)], 'c.csv');
    l.raw.exec("UPDATE budget_txs SET category = 'assurances'");
    const v = recurringView(l, new Date('2026-10-15'), '2026');
    const prime = v.recurring.find((r) => r.label === 'Assurance Santé Exemple')!;
    expect(Math.round(prime.perYear)).toBe(8000);
    expect(v.merchants.some((m) => /participations aux soins/.test(m.label))).toBe(true);
  });
});

describe('versement éclaté', () => {
  it('compte le dernier salaire dans les gains et met le reste hors habituel', () => {
    const l = new Ledger(':memory:');
    const rows: [string, string, number][] = [];
    for (let i = 1; i <= 9; i++) rows.push([`2025-0${i}-25`, 'EMPLOYEUR EXEMPLE SARL, Lausanne Salaire', 9000]);
    rows.push(['2025-11-25', 'EMPLOYEUR EXEMPLE SARL, Lausanne Solde de tout compte', 100000]);
    storeStatements(l, [stmt('Compte', rows)], 'c.csv');
    l.raw.exec("UPDATE budget_txs SET category = 'revenu' WHERE date < '2025-11-01'; UPDATE budget_txs SET category = 'exceptionnel' WHERE date >= '2025-11-01'");
    l.setSetting('budget.eclats', JSON.stringify([{ re: 'solde de tout compte', date: '2025-11-25', parts: [{ label: 'Salaire de novembre', amount: 9000 }, { label: 'Plan social et bonus', once: true }] }]));
    const v = recurringView(l, new Date('2026-02-15'), '2025');
    expect(Math.round(v.income)).toBe(90000);
    expect(Math.round(v.incomeOnce)).toBe(91000);
    expect(v.incomeBy.map((x) => x.label)).toContain('Salaire de novembre');
  });
});

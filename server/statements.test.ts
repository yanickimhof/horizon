import { describe, expect, it } from 'vitest';
import { applySignatures, buildReport, classify, pairInternalTransfers, parseAiCategories, parseStatement, signatureKey } from './statements';

const SALAIRE = `Relevé de compte jusqu'au: 01.11.2026 ;;;
N° de compte: 1;;;
Description: Salaire;;;
Solde: CHF 1000;;;
;;;
Date;Libellé;Montant;Valeur
05.10.26;Ordre permanent;-1850.00;05.10.26
03.10.26;Débit LSV;-3000.00;03.10.26
02.10.26;Débit TWINT Boulangerie Dupont 04000050;-12.50;02.10.26
01.10.26;Paiement de salaire ACME SA;5000.00;01.10.26
05.09.26;Ordre permanent;-1850.00;05.09.26
03.09.26;Débit LSV;-2800.00;03.09.26
05.08.26;Ordre permanent;-1850.00;05.08.26
03.08.26;Débit LSV;-3100.00;03.08.26
`;
const LOYER = `Description: Loyer;;;
Date;Bénéficiaire;Message;Référence;Montant;Valeur
"05.10.2026";"REGIE EXEMPLE SA, LUTRY";"Versement disponible Lot A";;"650.00";"05.10.2026"
"05.10.2026";"AXA Assurances";"Prime mensuelle";;"-262.40";"05.10.2026"
"05.09.2026";"AXA Assurances";"Prime mensuelle";;"-262.40";"05.09.2026"
"05.08.2026";"AXA Assurances";"Prime mensuelle";;"-262.40";"05.08.2026"
"06.10.2026";"Compte Salaire";"Virement";;"1850.00";"06.10.2026"
`;

describe('relevés bancaires', () => {
  it('lit les deux formats et le nom du compte', () => {
    const a = parseStatement('s.csv', SALAIRE);
    const b = parseStatement('l.csv', LOYER);
    expect(a.account).toBe('Salaire');
    expect(a.txs).toHaveLength(8);
    expect(b.account).toBe('Loyer');
    expect(b.txs[0]).toMatchObject({ date: '2026-10-05', amount: 650 });
    expect(b.txs[1].label).toContain('AXA');
  });

  it('classe par règles et laisse l’inconnu à identifier', () => {
    expect(classify('AXA Assurances Prime', -262.4).category).toBe('assurances');
    expect(classify('Débit TWINT Boulangerie', -12).category).toBe('alimentation');
    expect(classify('Débit LSV', -3000).category).toBe('carte');
    expect(classify('Ordre permanent', -1850).category).toBe('inconnu');
    expect(classify('Paiement de salaire ACME SA', 5000).category).toBe('revenu');
    expect(classify('Paiement 3e pilier VZ', -7258).category).toBe('epargne');
  });

  it('détecte un virement entre comptes', () => {
    const a = parseStatement('s.csv', SALAIRE);
    const b = parseStatement('l.csv', LOYER);
    const n = pairInternalTransfers([...a.txs, ...b.txs]);
    expect(n).toBe(1);
    expect(a.txs[0].category).toBe('interne');
    expect(b.txs[4].category).toBe('interne');
  });

  it('calcule moyennes, récurrents et écart avec Horizon', () => {
    const a = parseStatement('s.csv', SALAIRE);
    const b = parseStatement('l.csv', LOYER);
    pairInternalTransfers([...a.txs, ...b.txs]);
    const snap = { expenses: [{ key: 'e', label: 'AXA', category: 'insurance', monthly: 262.4, essential: true, certainty: 'confirmed' }] } as never;
    const r = buildReport([a, b], snap);
    expect(r.months).toBe(3);
    const ass = r.categories.find((c) => c.key === 'assurances')!;
    expect(ass.monthly).toBeCloseTo(262.4, 5);
    expect(r.recurring.some((x) => x.label.includes('AXA') && x.months === 3)).toBe(true);
    expect(r.unknown.samples[0].label).toBe('Ordre permanent');
    const vs = r.vsHorizon.find((x) => x.key === 'assurances')!;
    expect(vs.gap).toBeCloseTo(0, 5);
    // Le virement interne n'est ni revenu ni dépense.
    expect(r.internal.count).toBe(1);
  });

  it('mémorise un classement par signature et l’applique aux relevés suivants', () => {
    const a = parseStatement('s.csv', SALAIRE);
    const memory = { [signatureKey('Ordre permanent', -1850)]: 'logement' };
    expect(applySignatures(a.txs, memory)).toBe(3);
    const r = buildReport([a], null);
    expect(r.categories.find((c) => c.key === 'logement')?.monthly).toBeCloseTo(1850, 5);
    expect(r.unknown.samples.every((u) => u.label !== 'Ordre permanent')).toBe(true);
  });

  it('lit la réponse d’un modèle même entourée de texte, et refuse les catégories inventées', () => {
    const out = parseAiCategories('Voici: {"1":"quotidien","2":"nimportequoi","3":"interne","9":"sante"} fin', 3);
    expect(out).toEqual({ 1: 'quotidien' });
  });

  it('garde les paires complètes d’une réponse coupée', () => {
    const out = parseAiCategories('{"1":"maison","2":"assurances","3":"sa', 5);
    expect(out).toEqual({ 1: 'maison', 2: 'assurances' });
  });
});

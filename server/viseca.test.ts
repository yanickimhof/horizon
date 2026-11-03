import { describe, expect, it } from 'vitest';
import { parseVisecaBill } from './viseca';

const BILL =
  "Banque Migros SA Recouvrement de la créance par Viseca Payment Services SA, Page 1/1 Facture du 24.07.2026 Limite globale CHF 10'000 " +
  "Date Date de valeur Détails Monnaie Montant Montant en CHF 24.06.26 Montant total dernier relevé 2'934.95 " +
  "24.06.26 25.06.26 Votre paiement - Merci 2'934.95 -4435 92XX XXXX 7476 Visa Basic Free, [PERSONNE_1] Limite de carte CHF 10'000 " +
  "24.06.26 26.06.26 Le Skipper S.a r.l., St-Sulpice VD CH  51.10Restaurants, bistros " +
  "30.06.26 01.07.26 Hornbach Baumarkt Etoy 75, Etoy CH  354.10Magasins bricolage et constr. " +
  "03.07.26 25.06.26 Hornbach Baumarkt Etoy 75, Etoy CH  354.10 -Magasins bricolage et constr. " +
  "18.07.26 20.07.26 Tesla Inc., Milan IT EUR 25.62 24.40Taux de conversion 0.9521336 du 18.07.26 CHF 24.40 " +
  "04.07.26 06.07.26 NOTION LABS, INC., NOTION.SO US USD 23.35 19.45Services IT, programmation" +
  "Total intermédiaire de la carte 94.95Total intermédiaire 94.95 " +
  "Montant total de la facture en notre faveur 94.95 Le montant dû est débité de votre compte.";

describe('facture de carte Viseca', () => {
  const bill = parseVisecaBill(BILL);

  it('retrouve le total de la facture avec les lignes lues', () => {
    expect(bill?.total).toBe(94.95);
    expect(bill?.sum).toBe(94.95);
    expect(bill?.reconciled).toBe(true);
  });

  it('lit chaque ligne avec sa date, son montant et un remboursement en positif', () => {
    const txs = bill?.statements.flatMap((s) => s.txs) ?? [];
    expect(txs).toHaveLength(6);
    expect(bill?.statements[0].account).toBe('Visa Basic Free 7476');
    const hornbach = txs.filter((t) => /Hornbach/.test(t.label));
    expect(hornbach.map((t) => t.amount).sort((a, b) => a - b)).toEqual([-354.1, 354.1]);
    expect(txs.find((t) => /Skipper/.test(t.label))).toMatchObject({ date: '2026-06-24', amount: -51.1, category: 'restaurants' });
  });

  it('garde le montant en francs pour un achat en devise, et la catégorie de la banque', () => {
    const txs = bill?.statements.flatMap((s) => s.txs) ?? [];
    expect(txs.find((t) => /Tesla/.test(t.label))).toMatchObject({ amount: -24.4, category: 'vehicule' });
    expect(txs.find((t) => /NOTION/.test(t.label))).toMatchObject({ amount: -19.45, category: 'abonnements' });
    expect(txs.find((t) => /Hornbach/.test(t.label))?.category).toBe('maison');
  });

  it('classe le paiement de la facture précédente comme un virement interne', () => {
    const txs = bill?.statements.flatMap((s) => s.txs) ?? [];
    expect(txs.find((t) => /Votre paiement/.test(t.label))).toMatchObject({ amount: 2934.95, category: 'interne' });
  });

  it('refuse un total qui ne colle pas', () => {
    const bad = parseVisecaBill(BILL.replace('en notre faveur 94.95', 'en notre faveur 120.00'));
    expect(bad?.reconciled).toBe(false);
  });

  it('ignore un texte qui n’est pas une facture de carte', () => {
    expect(parseVisecaBill('Relevé de compte du 01.01.2026')).toBeNull();
  });
});

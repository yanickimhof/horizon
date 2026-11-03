import { describe, expect, it } from 'vitest';
import { COACH_IDEAS, COACH_RULES, buildCoachSystem } from './coach';

describe('consignes du coach', () => {
  const sys = buildCoachSystem('Foyer: test');

  it('impose la structure prudente pour les questions de situation', () => {
    for (const must of ['Ce que montrent tes données', 'Pistes à explorer', 'Selon le scénario', 'À vérifier avec un professionnel agréé', 'Ce qu’il me manque']) {
      expect(sys).toContain(must);
    }
  });

  it('interdit le conseil en placement personnalisé et les promesses de rendement', () => {
    expect(sys).toMatch(/ne donnes pas de conseil en placement personnalisé/);
    expect(sys).toMatch(/Ne recommande jamais un produit/);
    expect(sys).toMatch(/ne promets aucun rendement/);
  });

  it('exige l honnêteté: supposé contre confirmé, ignorance, pas de fausse précision', () => {
    expect(sys).toMatch(/confirmé de ce qui est supposé/);
    expect(sys).toMatch(/quand tu ne sais pas/);
    expect(sys).toMatch(/fausse précision/);
  });

  it('rappelle que les règles fiscales varient et peuvent être périmées', () => {
    expect(sys).toMatch(/varient selon le pays, le canton, l’année/);
    expect(sys).toMatch(/ne plus être à jour/);
  });

  it('protège la confidentialité: aucun montant, citations seulement des extraits reçus', () => {
    expect(sys).toMatch(/aucun montant en francs/);
    expect(sys).toMatch(/Ne cite jamais un extrait que tu n’as pas reçu/);
  });

  it('n ajoute la section des extraits que s il y en a', () => {
    expect(sys).not.toContain('EXTRAITS DE DOCUMENTS');
    expect(buildCoachSystem('ctx', '[1] doc\ntexte')).toContain('EXTRAITS DE DOCUMENTS');
  });

  it('prend en compte la détresse financière avec calme', () => {
    expect(COACH_RULES.join(' ')).toMatch(/détresse financière/);
  });

  it('les questions suggérées ne poussent aucun produit', () => {
    expect(COACH_IDEAS.join(' ')).not.toMatch(/acheter|vendre|ETF|bitcoin|action/i);
    expect(COACH_IDEAS.length).toBeGreaterThanOrEqual(3);
  });
});

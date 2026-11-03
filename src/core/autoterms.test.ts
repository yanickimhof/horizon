import { describe, expect, it } from 'vitest';
import { detectTerms } from './autoterms';
import { redact } from './redact';
import { pseudonymize, addTerm, type Term } from './pseudonym';

describe('détection des noms et adresses', () => {
  it('repère les noms après un titre et chaque mot du nom', () => {
    const found = detectTerms('Monsieur\nAlex EXEMPLE\nRue des Exemples 1\n1110 Morges\nMadame Dupont habite ici');
    const names = found.filter((f) => f.kind === 'personne').map((f) => f.term.toLowerCase());
    expect(names).toContain('dupont');
    expect(names).not.toContain('habite');
  });

  it('repère une adresse avec son numéro', () => {
    const found = detectTerms('Domicile: Rue des Exemples 1, 1110 Morges. Chemin de la Crétaux 33 à Gland.');
    const streets = found.filter((f) => f.kind === 'adresse').map((f) => f.term);
    expect(streets).toContain('Rue des Exemples 1');
    expect(streets.some((s) => s.startsWith('Chemin de la Crétaux 33'))).toBe(true);
  });

  it('repère les abréviations sans point', () => {
    const found = detectTerms('Preneur: Monsieur Dupont, Av de la Tilleuls 52, 1004 Lausanne');
    expect(found.some((f) => f.kind === 'adresse' && f.term.includes('Tilleuls 52'))).toBe(true);
  });

  it('ne masque pas des mots ordinaires', () => {
    expect(detectTerms('Le salaire annuel de base est de 150000. Total des cotisations.')).toEqual([]);
  });

  it('remplace noms et adresses par des jetons, en gardant les montants', () => {
    const text = 'Monsieur Dupont Jean, Rue du Lac 12, solde 1\'250.30';
    let terms: Term[] = [];
    for (const f of detectTerms(text)) terms = addTerm(terms, f.term, f.kind);
    const out = pseudonymize(text, terms).text;
    expect(out).not.toMatch(/Dupont|Jean|Rue du Lac/);
    expect(out).toContain("1'250.30");
  });
});

describe('masquage de numéros et de dates de naissance', () => {
  it('masque numéros de client, de sociétaire et de contrat', () => {
    const r = redact('N° de sociétaire 4204498105, Leasing No. 504008RN117285571, N° client: 12345-678');
    expect(r.text).not.toMatch(/4204498105|504008RN117285571|12345-678/);
    expect(r.counts.numero).toBe(3);
  });

  it('garde seulement l’année de naissance', () => {
    const r = redact('Date de naissance 17.04.1975');
    expect(r.text).toBe('Date de naissance [JJ.MM.]1975');
    expect(r.counts.naissance).toBe(1);
  });

  it('ne touche pas aux montants ni aux dates ordinaires', () => {
    const s = 'Avoir de vieillesse au 12.10.2026: 173\'693.75 (page 2 sur 3, N° 1)';
    expect(redact(s).text).toBe(s);
  });
});

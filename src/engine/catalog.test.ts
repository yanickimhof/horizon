import { describe, expect, it } from 'vitest';
import { Ledger } from '../../server/ledger';
import { project } from '../core/project';
import type { FactDraft } from '../core/types';
import { ASSET_CATALOG, catalogEntry } from './catalog';

const draft = (key: string, kind: FactDraft['kind'], data: Record<string, unknown>): FactDraft => ({
  kind, key, data, status: 'confirmed', origin: 'user', confidence: 1, sourceId: null, excerpt: null, why: null,
});
const snap = (...ds: FactDraft[]) => {
  const l = new Ledger();
  l.confirmNew(draft('household', 'household', { birthYear: 1981, adults: 2, children: 0, owner: true, retirementAge: 65 }));
  for (const d of ds) l.confirmNew(d);
  return project(l.current(), new Date(), l.rates());
};

describe('catalogue d actifs', () => {
  it('chaque type a un identifiant unique et une classe connue', () => {
    const ids = ASSET_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ASSET_CATALOG.every((e) => ['cash', 'securities', 'crypto', 'real_estate', 'pension', 'business', 'other'].includes(e.class))).toBe(true);
    expect(catalogEntry('nexiste-pas')).toBeUndefined();
  });

  it('le profil du type préremplit mobilisation et décote', () => {
    const a = snap(draft('asset:r', 'asset', { label: 'RSU', class: 'securities', subtype: 'rsu', value: 10000 })).assets[0];
    expect(a.liquidityMonths).toBe(12);
    expect(a.haircut).toBe(0.35);
    expect(a.subtype).toBe('rsu');
  });

  it('une valeur saisie sur la ligne l emporte sur le profil du type', () => {
    const a = snap(draft('asset:r', 'asset', { label: 'RSU', class: 'securities', subtype: 'rsu', value: 10000, haircut: 0.2, liquidityMonths: 3 })).assets[0];
    expect(a.haircut).toBe(0.2);
    expect(a.liquidityMonths).toBe(3);
  });

  it('une résidence principale est décotée comme un bien habité', () => {
    const a = snap(draft('asset:h', 'asset', { label: 'Maison', class: 'real_estate', subtype: 'home', value: 900000 })).assets[0];
    expect(a.haircut).toBe(0.25);
    const rental = snap(draft('asset:l', 'asset', { label: 'Studio', class: 'real_estate', subtype: 'rental', value: 300000 })).assets[0];
    expect(rental.haircut).toBe(0.1);
  });

  it('un type inconnu retombe sur la classe, rien ne casse', () => {
    const a = snap(draft('asset:x', 'asset', { label: 'Truc', class: 'other', subtype: 'inconnu', value: 100 })).assets[0];
    expect(a.liquidityMonths).toBe(12);
    expect(a.haircut).toBe(0.2);
  });

  it('un actif sur mesure se décrit entièrement par le contrat minimal', () => {
    const a = snap(draft('asset:c', 'asset', { label: 'Collection', class: 'other', subtype: 'custom', value: 50000, liquidityMonths: 24, haircut: 0.5, realGrowth: 0.03 })).assets[0];
    expect(a.liquidityMonths).toBe(24);
    expect(a.haircut).toBe(0.5);
    expect(a.realGrowth).toBe(0.03);
  });

  it('un compte de prévoyance se reconnaît par son type du catalogue', () => {
    const a = snap(draft('asset:k', 'asset', { label: '401(k)', class: 'pension', subtype: '401k', value: 100000, currency: 'USD' })).assets[0];
    expect(a.growthLike).toBe('securities');
    expect(a.haircut).toBe(0.25);
  });
});

describe('part détenue', () => {
  it('une copropriété à moitié ne compte que pour moitié, actif et dette', () => {
    const s = snap(
      draft('asset:g', 'asset', { label: 'Chalet', class: 'real_estate', subtype: 'second-home', value: 600000, share: 0.5 }),
      draft('liability:g', 'liability', { label: 'Hypothèque chalet', balance: 300000, rate: 0.02, variable: false, share: 0.5, securedBy: 'asset:g' }),
    );
    expect(s.assets[0].value).toBe(300000);
    expect(s.assets[0].share).toBe(0.5);
    expect(s.liabilities[0].balance).toBe(150000);
  });

  it('une part hors bornes est ramenée entre 0 et 1', () => {
    expect(snap(draft('asset:a', 'asset', { label: 'A', class: 'cash', value: 100, share: 3 })).assets[0].value).toBe(100);
    expect(snap(draft('asset:b', 'asset', { label: 'B', class: 'cash', value: 100, share: -1 })).assets[0].value).toBe(0);
  });
});

describe('soldes réguliers dans plusieurs pays', () => {
  it('chaque mise à jour devient un point de la série, rien n est écrasé', () => {
    const l = new Ledger();
    l.confirmNew(draft('asset:us-bank', 'asset', { label: 'Compte US', class: 'cash', value: 10000, currency: 'USD', region: 'US' }));
    l.correct('asset:us-bank', { value: 10400 }, 'Relevé de novembre');
    l.correct('asset:us-bank', { value: 9800 }, 'Relevé de décembre');
    const s = l.series('asset:us-bank', 'value');
    expect(s.map((p) => p.value)).toEqual([10000, 10400, 9800]);
    expect(s.every((p, i) => i === 0 || p.at >= s[i - 1].at)).toBe(true);
  });
});

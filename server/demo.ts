import type { FactDraft } from '../src/core/types';
import { standardExpenses } from '../src/engine/defaults';
import { Ledger } from './ledger';
import { loadDemoBudget } from './demo-budget';

const base = { confidence: 1, sourceId: null, excerpt: null } as const;

const confirmed = (kind: FactDraft['kind'], key: string, data: Record<string, unknown>, why: string): FactDraft => ({
  kind, key, data, status: 'confirmed', origin: 'user', why, ...base,
});

/** Famille fictive : 2 adultes, 2 enfants, propriétaires. Sert aux tests et à la démo. */
export function loadDemo(l: Ledger): void {
  l.confirmNew(confirmed('household', 'household', { name: 'Famille exemple', birthYear: 1981, adults: 2, children: 2, owner: true, retirementAge: 65, members: [{ name: 'Alex', role: 'adult' }, { name: 'Sam', role: 'adult' }, { name: 'Léa', role: 'child' }, { name: 'Noé', role: 'child' }] }, 'Exemple'));

  l.confirmNew(confirmed('asset', 'asset:comptes', { label: 'Comptes courants et épargne', class: 'cash', value: 85000, currency: 'CHF', region: 'CH' }, 'Exemple'));
  l.confirmNew(confirmed('asset', 'asset:titres', { label: 'Titres et fonds', class: 'securities', value: 120000, currency: 'USD', region: 'WORLD' }, 'Exemple'));
  l.confirmNew(confirmed('asset', 'asset:residence', { label: 'Résidence principale', class: 'real_estate', value: 1150000, currency: 'CHF', region: 'CH', occupied: true }, 'Exemple'));
  l.confirmNew(confirmed('asset', 'asset:prevoyance', { label: 'LPP et 3e pilier', class: 'pension', value: 510000, currency: 'CHF', region: 'CH' }, 'Exemple'));

  l.confirmNew(confirmed('asset', 'asset:401k', { label: '401(k) États-Unis', class: 'pension', account: '401k', value: 90000, currency: 'USD', region: 'US' }, 'Exemple'));
  l.confirmNew(confirmed('asset', 'asset:crypto', { label: 'Portefeuille crypto', class: 'crypto', symbol: 'BTC', quantity: 0.35, currency: 'USD', region: 'WORLD' }, 'Exemple'));

  // Cours fictifs, uniquement pour l'exemple.
  l.setPrice('USD', 0.89, 'exemple');
  l.setPrice('EUR', 0.94, 'exemple');
  l.setPrice('BTC', 62000, 'exemple');

  l.confirmNew(confirmed('liability', 'liability:hypotheque-fixe', { label: 'Hypothèque taux fixe', balance: 520000, rate: 0.019, variable: false, securedBy: 'asset:residence' }, 'Exemple'));
  l.confirmNew(confirmed('liability', 'liability:hypotheque-saron', { label: 'Hypothèque SARON', balance: 230000, rate: 0.014, variable: true, securedBy: 'asset:residence' }, 'Exemple'));

  l.confirmNew(confirmed('income', 'income:salaire-1', { label: 'Salaire net 1', amount: 9200, frequency: 'monthly', stable: false }, 'Exemple'));
  l.confirmNew(confirmed('income', 'income:salaire-2', { label: 'Salaire net 2', amount: 3800, frequency: 'monthly', stable: false }, 'Exemple'));

  for (const d of standardExpenses({ adults: 2, children: 2, owner: true, monthlyIncome: 13000 })) l.assume(d);
  // Deux valeurs réelles remplacent les valeurs standard correspondantes.
  l.correct('expense:mortgage', { amount: 1900 }, 'Montant lu sur le décompte hypothécaire');
  l.correct('expense:health-adult', { amount: 395 }, 'Montant lu sur la police LAMal');

  l.confirmNew(confirmed('goal', 'goal:cuisine', { label: 'Rénover la cuisine', targetAmount: 45000, targetYear: 2028, saved: 8000 }, 'Exemple'));
  l.confirmNew(confirmed('goal', 'goal:voyage', { label: 'Voyage en famille', targetAmount: 15000, targetYear: 2027, saved: 0 }, 'Exemple'));

  // Situations de vie de l'exemple: études d'un enfant et rente à la retraite (montants fictifs).
  const Y = new Date().getFullYear();
  l.confirmNew(confirmed('expense', 'expense:etudes-exemple', { label: 'Études d’un enfant', category: 'family', amount: 2200, frequency: 'monthly', essential: true, startYear: Y + 3, endYear: Y + 7, event: 'study' }, 'Exemple'));
  l.confirmNew(confirmed('income', 'income:rente-exemple', { label: 'Rente à la retraite (AVS, LPP)', amount: 4200, frequency: 'monthly', stable: true, startAge: 65, event: 'retirement-income' }, 'Exemple'));

  l.addNote('Le couple envisage de déménager vers 2032, à la fin du lycée des enfants.', ['household']);

  // Budget fictif: 24 mois de relevés inventés, pour la démonstration et les captures d'écran.
  loadDemoBudget(l);
}

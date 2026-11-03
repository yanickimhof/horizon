import type { Ledger } from './ledger';
import { storeStatements } from './budget';
import type { ParsedStatement, Tx } from './statements';

/**
 * Budget fictif de la famille exemple: 24 mois de relevés inventés (employeurs, commerçants et prêts imaginaires),
 * pour que l'écran Budget soit rempli en démonstration et dans les captures d'écran. Aucune donnée réelle.
 */
const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const pad = (n: number) => String(n).padStart(2, '0');

export function loadDemoBudget(l: Ledger, now: Date = new Date()): void {
  const r = rng(42);
  const between = (a: number, b: number) => Math.round((a + r() * (b - a)) * 20) / 20;
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];

  // Rattachement des dépenses d'immobilier à un bien, donné une fois par l'utilisateur.
  l.setSetting('budget.biens', JSON.stringify([
    { re: '20\\.123|tilleuls|sanitaire dupont|peinture martin', bien: 'Domicile', home: true },
    { re: '20\\.555|studio|le lac|menuiserie exemple', bien: 'Studio' },
  ]));

  const accounts: Record<string, Tx[]> = { 'Compte courant': [], 'Compte locatif': [], 'Visa Exemple 1234': [] };
  const add = (account: string, date: string, label: string, amount: number) => {
    accounts[account].push({ account, date, label, amount, category: amount > 0 ? 'revenu' : 'inconnu', source: 'aucune', currency: 'CHF' });
  };

  for (let i = 24; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const mo = d.getMonth() + 1;
    const ym = `${y}-${pad(mo)}`;
    const day = (n: number) => `${ym}-${pad(Math.min(n, 28))}`;

    // Revenus
    add('Compte courant', day(25), 'Employeur Exemple SA, Paiement de salaire', 9200);
    add('Compte courant', day(27), 'Ecole Exemple, Paiement de salaire', 3800);
    if (mo === 4) add('Compte courant', day(15), 'Employeur Exemple SA, Bonus annuel', 5500);
    add('Compte locatif', day(20), 'Régie Exemple SA, Versement disponible - Studio Rue du Lac', 1450);
    if (i === 9) add('Compte courant', day(12), 'Notaire Exemple, Vente d’un terrain', 38000);

    // Immobilier
    if (mo % 3 === 0) {
      add('Compte courant', day(29), 'Banque Exemple SA, Débit d’intérêts Hypothèque SARON 20.123.456', -1180);
      add('Compte courant', day(29), 'Banque Exemple SA, Débit d’intérêts Prêt hypoth. taux fixe 20.123.457', -2950);
      add('Compte locatif', day(29), 'Banque Exemple SA, Débit d’intérêts Hypothèque SARON 20.555.111', -640);
      add('Compte courant', day(5), 'PPE Les Tilleuls, Appel de fonds', -1320);
      add('Compte locatif', day(5), 'PPE Le Lac, Appel de fonds', -420);
    }
    if (mo === 6 || mo === 12) add('Compte courant', day(29), 'Banque Exemple SA, Belastung der Amortisation auf Prêt hypoth.', -1500);
    if (i === 14) {
      add('Compte courant', day(10), 'Peinture Martin SA, Facture 2025-118', -4800);
      add('Compte courant', day(18), 'Sanitaire Dupont SA, Facture 2025-131', -2350);
    }
    if (i === 6) add('Compte locatif', day(14), 'Menuiserie Exemple SA, Facture 2026-044', -1900);

    // Impôts, assurances, énergie, télécoms
    add('Compte courant', day(28), 'Etat de Vaud Impôts, Acompte', -1480);
    if (i === 8) add('Compte courant', day(20), 'Etat de Vaud - Impôts, Décompte final', -6300);
    add('Compte courant', day(1), 'Assurance Maladie Exemple AG, Prime', -690);
    if (mo === 1) add('Compte courant', day(10), 'Vaudoise Assurances, Prime ménage et RC', -1740);
    if (mo % 2 === 0) add('Compte courant', day(15), 'Services Industriels Exemple, Électricité', -165);
    add('Compte courant', day(3), 'Swisscom (Suisse) SA, Facture', -89);
    add('Compte courant', day(4), 'Salt Mobile SA, Facture', -49);

    // Véhicule et enfants
    add('Compte courant', day(2), 'Auto Leasing Exemple SA, Leasing mensuel', -389);
    if (mo === 5) add('Compte courant', day(16), 'Garage Exemple Sàrl, Service et pneus', -520);
    add('Compte courant', day(7), 'Garderie Les Petits, Facture', -1050);

    // Carte: courses, restaurants, loisirs, abonnements
    const n = 38 + Math.floor(r() * 14);
    for (let k = 0; k < n; k++) {
      const dd = day(1 + Math.floor(r() * 27));
      const x = r();
      if (x < 0.42) add('Visa Exemple 1234', dd, `${pick(['Coop Pronto Lausanne', 'Migros M Lausanne', 'Denner Renens', 'Aldi Suisse Renens', 'Boulangerie Exemple Lausanne'])} CH`, -between(14, 125));
      else if (x < 0.57) add('Visa Exemple 1234', dd, `${pick(['Restaurant Chez Exemple', 'Pizzeria Exemple', 'McDonalds Lausanne', 'Café du Marché'])} CH`, -between(22, 140));
      else if (x < 0.64) add('Visa Exemple 1234', dd, `${pick(['Migrol Lausanne', 'Parking Exemple', 'Shell Relais Exemple'])} CH`, -between(18, 85));
      else if (x < 0.69) add('Visa Exemple 1234', dd, 'SBB CFF FFS, Berne CH', -between(18, 95));
      else if (x < 0.75) add('Visa Exemple 1234', dd, `${pick(['Pharmacie Exemple', 'Dentiste Exemple SA'])} CH`, -between(15, 190));
      else if (x < 0.82) add('Visa Exemple 1234', dd, `${pick(['H&M Lausanne', 'Zara Lausanne', 'Intersport Exemple'])} CH`, -between(25, 160));
      else if (x < 0.9) add('Visa Exemple 1234', dd, `${pick(['IKEA Lausanne', 'Jumbo Exemple', 'Digitec Galaxus'])} CH`, -between(20, 230));
      else add('Visa Exemple 1234', dd, `${pick(['Cinéma Exemple', 'Fitness Exemple', 'Piscine Exemple'])} CH`, -between(15, 95));
    }
    add('Visa Exemple 1234', day(9), 'NETFLIX.COM, Los Gatos US', -17.9);
    add('Visa Exemple 1234', day(11), 'Spotify, Stockholm SE', -12.95);
    if (mo === 7 || mo === 12) {
      add('Visa Exemple 1234', day(3), 'Hotel Exemple Sàrl, Réservation', -1850);
      add('Visa Exemple 1234', day(2), 'EASYJET, Luton GB', -640);
    }
    if (mo % 4 === 0) add('Visa Exemple 1234', day(20), 'Fondation Exemple, Don', -50);
    // Quelques lignes que personne ne peut deviner: elles apparaissent dans « À identifier ».
    if (i === 17) add('Compte courant', day(13), 'Atelier Les Lutins SARL, Facture', -186);
    if (i === 5) add('Compte courant', day(21), 'Association Exemple, Cotisation', -240);
  }

  const parsed: ParsedStatement[] = Object.entries(accounts).map(([account, txs]) => ({ account, txs }));
  storeStatements(l, parsed, 'demo');
}

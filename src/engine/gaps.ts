import type { Snapshot } from './types';
import { monthlyExpenses } from './horizons';
import { staleRates } from './fx';
import type { DocMeta } from '../core/docmeta';

export interface Gap {
  id: string;
  title: string;
  /** Ce que ça change pour l'analyse. */
  why: string;
  /** Quoi fournir, en une phrase. */
  ask: string;
  /** Poids relatif, 0 à 1, pour classer. */
  impact: number;
}

export interface GapContext {
  /** Noms des documents déjà importés. */
  sourceNames: string[];
  /** Textes des notes de contexte. */
  notes: string[];
  /** Documents importés avec pays, année et type reconnus. */
  sources?: { name: string; meta?: DocMeta }[];
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Angles manquants, classés par gain attendu. On ne demande jamais ce qui est
 * déjà connu : un document déjà importé ou un fait confirmé supprime la suggestion.
 */
export function suggestMissing(s: Snapshot, ctx: GapContext): Gap[] {
  const out0: Gap[] = [];
  const has = (re: RegExp) => ctx.sourceNames.some((n) => re.test(n));
  const noted = (re: RegExp) => ctx.notes.some((n) => re.test(n));
  const taxDocs = (ctx.sources ?? []).filter((x) => x.meta?.type === 'tax-return');
  const years = [...new Set(taxDocs.map((x) => x.meta?.year).filter((y): y is number => typeof y === 'number'))].sort();
  if (taxDocs.length > 0 && years.length < 3) {
    out0.push({
      id: 'tax-history',
      title: 'Déclarations des années précédentes',
      why: `${years.length ? `Tu as fourni ${years.join(', ')}.` : 'Les années ne sont pas reconnues.'} Trois ans ou plus permettent de lire les tendances (revenus, impôts, fortune) et les décisions passées.`,
      ask: 'Déposer les déclarations ou taxations des 3 à 5 dernières années.',
      impact: 0.55,
    });
  }
  const hasUs = s.assets.some((a) => a.region === 'US' || ['401k', 'ira', 'roth'].includes(a.account ?? ''));
  const noUsFiling = noted(/(pas de|aucune) d[ée]claration (us|am[ée]ricaine)/i);
  if (hasUs && !noUsFiling && !(ctx.sources ?? []).some((x) => x.meta?.country === 'US' && x.meta?.type === 'tax-return')) {
    out0.push({
      id: 'tax-us',
      title: 'Déclarations américaines (Form 1040)',
      why: 'Tu détiens des actifs aux États-Unis. Leur déclaration éclaire le revenu imposable, les retenues et l’historique du compte.',
      ask: 'Déposer les Form 1040 et pièces associées (W-2, 1099) des dernières années.',
      impact: 0.5,
    });
  }
  const total = monthlyExpenses(s) || 1;
  const assumedShare = s.expenses.filter((e) => e.certainty === 'assumed').reduce((a, e) => a + e.monthly, 0) / total;
  const out: Gap[] = [...out0];

  const noRate = [...new Set([...s.assets, ...s.liabilities].filter((x) => x.rateMissing).map((x) => ('symbol' in x && x.symbol ? x.symbol : x.currency)))];
  if (noRate.length) {
    out.push({
      id: 'rates',
      title: `Cours manquant: ${noRate.join(', ')}`,
      why: 'Sans cours, ces montants sont comptés 1 pour 1 en francs, ce qui fausse la valeur du patrimoine.',
      ask: 'Saisir le cours (CHF pour une unité) dans Données, ou mettre à jour les cours publics.',
      impact: 0.9,
    });
  }
  const old = staleRates(s.rates, new Date(s.asOf));
  if (old.length) {
    out.push({
      id: 'stale-rates',
      title: `Cours périmés: ${old.join(', ')}`,
      why: 'Ces cours ont plus de 30 jours. Les valeurs en devises ou en crypto peuvent avoir beaucoup bougé.',
      ask: 'Mettre à jour les cours dans Données.',
      impact: 0.6,
    });
  }

  const tax = s.expenses.find((e) => e.category === 'tax');
  if ((!tax || tax.certainty === 'assumed') && !has(/imp[oô]t|taxation|d[ée]claration|tax/i)) {
    out.push({
      id: 'tax',
      title: 'Déclaration d’impôts ou dernière taxation',
      why: 'Les impôts sont une grosse dépense estimée à la louche. La déclaration donne aussi revenus, fortune, dettes et déductions réels.',
      ask: 'Déposer la dernière taxation ou déclaration (PDF).',
      impact: clamp(0.5 + (tax ? (tax.monthly / total) * 2 : 0.2)),
    });
  }
  if (assumedShare >= 0.4 && !has(/relev|extrait|statement|carte/i)) {
    out.push({
      id: 'statements',
      title: 'Relevés bancaires et de cartes des 12 derniers mois',
      why: `${Math.round(assumedShare * 100)} % de tes dépenses sont des valeurs standard. Les relevés les remplacent par la réalité.`,
      ask: 'Déposer les relevés (PDF ou CSV) de compte courant et de cartes.',
      impact: clamp(assumedShare),
    });
  }
  const pension = s.assets.find((a) => a.class === 'pension');
  if ((!pension || pension.certainty === 'assumed') && !has(/lpp|pr[ée]voyance|certificat|3a|pilier/i)) {
    out.push({
      id: 'pension',
      title: 'Certificat LPP et avoirs 3e pilier',
      why: 'La prévoyance pèse sur l’anneau de 20 ans, le seul où elle compte. Sans elle, l’horizon long est faussé.',
      ask: 'Déposer le dernier certificat de prévoyance et les relevés 3a.',
      impact: 0.8,
    });
  }
  const debtUnsure = s.liabilities.length === 0 || s.liabilities.some((l) => l.certainty === 'assumed');
  if (s.household.owner && debtUnsure && !has(/hypoth|mortgage|pr[êe]t|cr[ée]dit/i)) {
    out.push({
      id: 'mortgage',
      title: 'Contrat ou décompte hypothécaire',
      why: 'La dette décide de la valeur nette de l’immobilier, donc de l’anneau de 5 ans. Les échéances des taux fixes révèlent aussi le risque de refinancement.',
      ask: 'Déposer le dernier décompte hypothécaire: montants, taux, échéances, amortissement.',
      impact: 0.7,
    });
  }
  if (s.assets.some((a) => a.class === 'real_estate') && !has(/estimation|expertise|valeur|valuation/i)) {
    out.push({
      id: 'valuation',
      title: 'Estimation récente de chaque bien immobilier',
      why: 'Une erreur de 10 % sur la valeur du bien change fortement la valeur nette, car la dette ne bouge pas.',
      ask: 'Indiquer une estimation récente (expertise, valeur fiscale, prix de marché) par bien.',
      impact: 0.55,
    });
  }
  if (!has(/avs|compte individuel|rente/i)) {
    out.push({
      id: 'avs',
      title: 'Extrait de compte individuel AVS',
      why: 'Il fixe la rente publique future. Le moteur ne modélise pas encore les rentes: c’est le prochain chantier, et cette pièce servira.',
      ask: 'Commander et déposer l’extrait de compte individuel.',
      impact: 0.5,
    });
  }
  if (s.goals.length === 0) {
    out.push({
      id: 'goals',
      title: 'Tes envies et projets',
      why: 'Les rêves se posent sur les anneaux. Sans eux, l’outil mesure la solidité mais pas ce qu’elle sert à faire.',
      ask: 'Dire ce que tu voudrais financer dans 1, 5 et 20 ans, même approximativement.',
      impact: 0.45,
    });
  }
  if (!noted(/r[ée]gime|mariage|testament|succession|pacte|d[ée]c[èe]s|divorce/i)) {
    out.push({
      id: 'succession',
      title: 'Régime matrimonial, testament, couverture en cas de décès',
      why: 'Angle absent du moteur: décès, invalidité, séparation. Ce sont les chocs qui changent le plus une situation familiale.',
      ask: 'Indiquer le régime matrimonial, l’existence d’un testament et des assurances décès ou invalidité.',
      impact: 0.4,
    });
  }
  const insurance = s.expenses.filter((e) => e.category === 'insurance');
  if (insurance.length && insurance.every((e) => e.certainty === 'assumed') && !has(/lamal|police|assurance|prime/i)) {
    out.push({
      id: 'insurance',
      title: 'Polices et primes d’assurance',
      why: 'Les primes sont fixes et prévisibles: les connaître retire un lot entier d’incertitude.',
      ask: 'Déposer les polices ou décomptes de primes (maladie, ménage, véhicule, vie).',
      impact: 0.35,
    });
  }
  return out.sort((a, b) => b.impact - a.impact);
}

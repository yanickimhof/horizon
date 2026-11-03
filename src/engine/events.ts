import type { FactDraft } from '../core/types';

/**
 * Situations de vie. Chacune est un modèle qui produit des faits datés: pas de code
 * spécial dans le moteur, les fenêtres de temps et les dépenses ponctuelles suffisent.
 * Montants par défaut volontairement absents: seul l'utilisateur sait.
 */
export interface EventField {
  id: 'label' | 'amount' | 'startYear' | 'endYear' | 'startAge' | 'currency';
  label: string;
  type: 'text' | 'number';
  optional?: boolean;
}

export interface LifeEventDef {
  id: 'study' | 'one-off' | 'dependent' | 'retirement-income';
  label: string;
  hint: string;
  fields: EventField[];
  defaults?: (now: Date) => Partial<Record<EventField['id'], string>>;
  build: (v: Record<string, string>) => FactDraft;
}

const base = { status: 'confirmed', origin: 'user', confidence: 1, sourceId: null, excerpt: null } as const;
const key = (kind: string, id: string, label: string) => `${kind}:${id}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)}-${Date.now().toString(36)}`;
const n = (v: string | undefined) => (v === undefined || v === '' ? undefined : Number(v));

export const LIFE_EVENTS: LifeEventDef[] = [
  {
    id: 'study',
    label: 'Enfant aux études',
    hint: 'Coût mensuel (logement, frais, vie) pendant les années d’études.',
    fields: [
      { id: 'label', label: 'Nom', type: 'text' },
      { id: 'amount', label: 'Coût par mois', type: 'number' },
      { id: 'startYear', label: 'Première année', type: 'number' },
      { id: 'endYear', label: 'Dernière année', type: 'number' },
    ],
    defaults: (now) => ({ label: 'Études d’un enfant', startYear: String(now.getFullYear() + 2), endYear: String(now.getFullYear() + 6) }),
    build: (v) => ({
      ...base, kind: 'expense', key: key('expense', 'etudes', v.label || 'etudes'),
      data: { label: v.label || 'Études d’un enfant', category: 'family', amount: n(v.amount) ?? 0, frequency: 'monthly', essential: true, startYear: n(v.startYear), endYear: n(v.endYear), event: 'study' },
      why: 'Situation de vie: études',
    }),
  },
  {
    id: 'one-off',
    label: 'Grosse dépense prévue',
    hint: 'Travaux, véhicule, mariage, voyage exceptionnel: un montant, une année.',
    fields: [
      { id: 'label', label: 'Nom', type: 'text' },
      { id: 'amount', label: 'Montant', type: 'number' },
      { id: 'startYear', label: 'Année', type: 'number' },
    ],
    defaults: (now) => ({ label: 'Grosse dépense', startYear: String(now.getFullYear() + 1) }),
    build: (v) => ({
      ...base, kind: 'expense', key: key('expense', 'ponctuelle', v.label || 'depense'),
      data: { label: v.label || 'Grosse dépense', category: 'other', amount: n(v.amount) ?? 0, frequency: 'once', essential: true, startYear: n(v.startYear), startMonth: 6, event: 'one-off' },
      why: 'Situation de vie: dépense ponctuelle',
    }),
  },
  {
    id: 'dependent',
    label: 'Enfant à charge',
    hint: 'Coût mensuel à partir d’une année (naissance, arrivée), jusqu’à l’indépendance.',
    fields: [
      { id: 'label', label: 'Nom', type: 'text' },
      { id: 'amount', label: 'Coût par mois', type: 'number' },
      { id: 'startYear', label: 'À partir de', type: 'number' },
      { id: 'endYear', label: 'Jusqu’en', type: 'number', optional: true },
    ],
    defaults: (now) => ({ label: 'Enfant à charge', startYear: String(now.getFullYear() + 1), endYear: String(now.getFullYear() + 21) }),
    build: (v) => ({
      ...base, kind: 'expense', key: key('expense', 'enfant', v.label || 'enfant'),
      data: { label: v.label || 'Enfant à charge', category: 'family', amount: n(v.amount) ?? 0, frequency: 'monthly', essential: true, startYear: n(v.startYear), endYear: n(v.endYear), event: 'dependent' },
      why: 'Situation de vie: enfant à charge',
    }),
  },
  {
    id: 'retirement-income',
    label: 'Rente à la retraite',
    hint: 'AVS, LPP en rente, Social Security: revenu stable qui démarre à un âge donné.',
    fields: [
      { id: 'label', label: 'Nom', type: 'text' },
      { id: 'amount', label: 'Rente par mois', type: 'number' },
      { id: 'startAge', label: 'À partir de l’âge', type: 'number' },
      { id: 'currency', label: 'Devise', type: 'text', optional: true },
    ],
    defaults: () => ({ label: 'Rente (AVS, LPP, Social Security)', startAge: '65', currency: 'CHF' }),
    build: (v) => ({
      ...base, kind: 'income', key: key('income', 'rente', v.label || 'rente'),
      data: { label: v.label || 'Rente à la retraite', amount: n(v.amount) ?? 0, frequency: 'monthly', stable: true, startAge: n(v.startAge) ?? 65, currency: (v.currency || 'CHF').toUpperCase(), event: 'retirement-income' },
      why: 'Situation de vie: rente à la retraite',
    }),
  },
];

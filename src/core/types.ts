/**
 * Registre de faits (ledger).
 *
 * Tout ce que l'application sait de la situation d'une personne est un Fait :
 * une affirmation datée, avec son origine, son niveau de certitude, la preuve
 * dont elle vient et la raison pour laquelle elle est supposée. Un fait n'est
 * jamais écrasé : une correction crée un nouveau fait qui remplace l'ancien,
 * et l'historique reste consultable.
 */

export type FactKind = 'household' | 'asset' | 'liability' | 'income' | 'expense' | 'goal';

/** D'où vient l'information. */
export type Origin = 'user' | 'document' | 'inferred' | 'default';

/**
 * Cycle de vie :
 * - proposed   : extrait d'un message ou d'un document, en attente de validation (n'entre pas dans les calculs)
 * - confirmed  : validé par l'utilisateur
 * - assumed    : valeur supposée (standard ou déduite), utilisée dans les calculs et signalée comme telle
 * - rejected   : refusé par l'utilisateur
 * - superseded : remplacé par un fait plus récent (historique)
 */
export type Status = 'proposed' | 'confirmed' | 'assumed' | 'rejected' | 'superseded';

export interface Fact {
  id: string;
  kind: FactKind;
  /** Identité stable : une correction réutilise la même clé (ex. "asset:residence-principale"). */
  key: string;
  /** Contenu libre, validé par kind (voir src/core/schema.ts). */
  data: Record<string, unknown>;
  status: Status;
  origin: Origin;
  /** 0 à 1, indicatif. */
  confidence: number;
  validFrom: string;
  validTo: string | null;
  recordedAt: string;
  sourceId: string | null;
  /** Passage du document ou du message d'où vient le fait. */
  excerpt: string | null;
  /** Pourquoi cette valeur : "Valeur standard LAMal adulte", "Lu sur la déclaration 2024"... */
  why: string | null;
}

export type FactDraft = Omit<Fact, 'id' | 'recordedAt' | 'validTo' | 'validFrom'> & {
  validFrom?: string;
};

import type { DocMeta } from './docmeta';

export interface Source {
  id: string;
  kind: 'chat' | 'voice' | 'screenshot' | 'pdf' | 'manual';
  name: string;
  sha256: string | null;
  addedAt: string;
  summary: string | null;
  /** Pays, année et type reconnus. */
  meta?: DocMeta;
}

/** Contexte qualitatif que le moteur ne calcule pas mais que le coach doit retenir. */
export interface Note {
  id: string;
  text: string;
  createdAt: string;
  /** Clés de faits auxquelles la note se rapporte. */
  keys: string[];
}

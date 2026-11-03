import type { FactKind } from './types';
import { isFrequency } from '../engine/frequency';

/**
 * Noyau typé minimal : seuls les champs nécessaires au moteur sont exigés.
 * Tout champ supplémentaire est accepté et conservé (flexibilité), il sert au
 * coach et pourra être promu en champ typé plus tard.
 */
const REQUIRED: Record<FactKind, string[]> = {
  household: [],
  asset: ['label', 'class', 'value'],
  liability: ['label', 'balance'],
  income: ['label', 'amount', 'frequency'],
  expense: ['label', 'amount', 'frequency'],
  goal: ['label', 'targetAmount', 'targetYear'],
};

const CLASSES = ['cash', 'securities', 'crypto', 'real_estate', 'pension', 'business', 'other'];

/** Retourne la liste des problèmes (vide si le fait est exploitable par le moteur). */
export function validateData(kind: FactKind, data: Record<string, unknown>): string[] {
  const problems: string[] = [];
  // Un actif coté (crypto) se décrit par symbole et quantité: la valeur est calculée depuis le cours.
  const quoted = kind === 'asset' && typeof data.symbol === 'string' && data.symbol !== '';
  for (const field of REQUIRED[kind]) {
    if (quoted && field === 'value') continue;
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      problems.push(`champ manquant: ${field}`);
    }
  }
  if (quoted && (typeof data.quantity !== 'number' || !Number.isFinite(data.quantity))) problems.push('champ manquant: quantity');
  const num = (f: string) => {
    if (data[f] !== undefined && (typeof data[f] !== 'number' || !Number.isFinite(data[f]))) {
      problems.push(`${f} doit être un nombre`);
    }
  };
  ['value', 'balance', 'amount', 'targetAmount', 'targetYear', 'saved', 'rate', 'quantity'].forEach(num);
  if (kind === 'asset' && data.class !== undefined && !CLASSES.includes(String(data.class))) {
    problems.push(`class inconnue: ${String(data.class)}`);
  }
  if ((kind === 'income' || kind === 'expense') && data.frequency !== undefined && !isFrequency(data.frequency)) {
    problems.push(`frequency inconnue: ${String(data.frequency)}`);
  }
  return problems;
}

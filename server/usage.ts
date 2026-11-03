import type { Ledger } from './ledger';
import { rateFor } from '../src/engine/fx';
import { EgressBlocked, guardedFetch, type Purpose } from './egress';
import { anthropicKey } from './secrets';

/** Tarifs officiels en dollars par million de jetons (entrée, sortie). Haiku coûte plus cher au-delà de 100 000 jetons d'entrée. */
const PRICES: { prefix: string; inUsd: number; outUsd: number; inLong?: number; outLong?: number }[] = [
  { prefix: 'claude-haiku-5-5', inUsd: 0.1, outUsd: 0.5, inLong: 0.5, outLong: 2.5 },
  { prefix: 'claude-sonnet-5-5', inUsd: 2, outUsd: 10 },
  { prefix: 'claude-opus-5-5', inUsd: 4, outUsd: 20 },
  { prefix: 'claude-fable-5-1', inUsd: 10, outUsd: 50 },
];
const FALLBACK: (typeof PRICES)[number] = { prefix: '', inUsd: 10, outUsd: 50 };

export const DEFAULT_CAP_CHF = 10;

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES.find((x) => model.startsWith(x.prefix)) ?? FALLBACK;
  const long = p.inLong !== undefined && p.outLong !== undefined && inputTokens > 100_000;
  const pin = long ? (p.inLong as number) : p.inUsd;
  const pout = long ? (p.outLong as number) : p.outUsd;
  return (inputTokens * pin + outputTokens * pout) / 1_000_000;
}

export const monthStart = (d: Date = new Date()): string => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
const usdChf = (l: Ledger): number => rateFor(l.rates(), 'USD')?.perUnit ?? 0.8;

export const capChf = (l: Ledger): number => {
  const v = Number(l.getSetting('llm.capChf'));
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_CAP_CHF;
};

export interface UsageSummary {
  monthChf: number;
  capChf: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export function usageSummary(l: Ledger, now: Date = new Date()): UsageSummary {
  const u = l.usageSince(monthStart(now));
  return { monthChf: u.costUsd * usdChf(l), capChf: capChf(l), calls: u.calls, inputTokens: u.input, outputTokens: u.output };
}

export class CapReached extends EgressBlocked {
  constructor(spent: number, cap: number) {
    super(`Plafond mensuel atteint (${spent.toFixed(2)} sur ${cap.toFixed(0)} CHF). Augmente-le dans Confidentialité pour continuer.`);
  }
}

export interface ClaudeCall {
  purpose: Purpose;
  model: string;
  system?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
  summary: string;
}

export interface ClaudeResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costChf: number;
}

/**
 * Seul point d'appel vers l'API Anthropic. Applique la politique de confidentialité (guardedFetch),
 * refuse d'aller au-delà du plafond mensuel et consigne les jetons et le coût de chaque appel.
 */
export async function claude(l: Ledger, c: ClaudeCall, doFetch: typeof fetch = fetch): Promise<ClaudeResult> {
  const key = anthropicKey();
  if (!key) throw new Error('Aucune clé d’API: lance bash scripts/set-key.sh');
  const month = usageSummary(l);
  if (month.monthChf >= month.capChf) throw new CapReached(month.monthChf, month.capChf);
  const body: Record<string, unknown> = { model: c.model, max_tokens: c.maxTokens, messages: c.messages };
  if (c.system) body.system = c.system;
  const r = await guardedFetch(
    l,
    {
      purpose: c.purpose,
      url: 'https://api.anthropic.com/v1/messages',
      init: { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body) },
      summary: c.summary,
    },
    doFetch,
  );
  const j = (await r.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } };
  if (!r.ok) throw new Error(j?.error?.message ?? `Erreur du service (${r.status})`);
  const inputTokens = j.usage?.input_tokens ?? 0;
  const outputTokens = j.usage?.output_tokens ?? 0;
  const usd = costUsd(c.model, inputTokens, outputTokens);
  l.logUsage({ model: c.model, purpose: c.purpose, input: inputTokens, output: outputTokens, costUsd: usd });
  const text = (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n');
  return { text, inputTokens, outputTokens, costChf: usd * usdChf(l) };
}

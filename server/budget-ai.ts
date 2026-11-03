import type { Ledger } from './ledger';
import { ensureBudget } from './budget';
import { classifyUnknown } from './statements-ai';
import type { Tx } from './statements';

export interface StoredAi {
  labels: number;
  classified: number;
  costChf: number;
  note: string;
}

/**
 * Classe avec un petit modèle les lignes que les règles ne reconnaissent pas. Seuls des libellés réduits, sans montant ni
 * date, quittent l'ordinateur, après accord. Le classement est gardé (source « ia ») et ne sera pas recalculé.
 */
export async function classifyStored(l: Ledger): Promise<StoredAi> {
  ensureBudget(l);
  const out: StoredAi = { labels: 0, classified: 0, costChf: 0, note: '' };
  const upd = l.raw.prepare("UPDATE budget_txs SET category = ?, source = 'ia' WHERE id = ?");
  for (let round = 0; round < 20; round++) {
    const rows = l.raw.prepare("SELECT id, account, date, amount, currency, label FROM budget_txs WHERE category = 'inconnu' AND amount < 0").all() as unknown as { id: string; account: string; date: string; amount: number; currency: string; label: string }[];
    if (rows.length === 0) break;
    const txs: (Tx & { id: string })[] = rows.map((r) => ({ ...r, category: 'inconnu', source: 'aucune' as const }));
    const r = await classifyUnknown(l, txs);
    if (!r) break;
    out.labels += r.labels;
    out.costChf += r.costChf;
    if (r.note) out.note = r.note;
    let n = 0;
    for (const t of txs) {
      if (t.category !== 'inconnu') {
        upd.run(t.category, t.id);
        n++;
      }
    }
    out.classified += n;
    if (!r.used || n === 0) break;
  }
  return out;
}

import type { Ledger } from './ledger';

/**
 * Décomptes annuels de copropriété (PPE): ce que la gérance a réellement facturé, par rubrique.
 * Les versements trimestriels à la PPE couvrent plus que les charges déductibles (chauffage, provisions,
 * fonds de rénovation): le décompte dit ce qui est une charge, et ce qui reste de l'épargne ou du chauffage.
 */

export interface DecompteLine {
  label: string;
  amount: number;
}

export interface Decompte {
  bien: string | null;
  from: string;
  to: string;
  /** Charges de l'exercice déductibles fiscalement, part du copropriétaire. */
  total: number;
  lines: DecompteLine[];
  /** Solde du décompte: positif = à recevoir, négatif = à payer. */
  solde: number | null;
  /** Versé à la PPE sur l'exercice, d'après les relevés. */
  paid: number;
}

const iso = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;
const num = (s: string) => Number(s.replace(/['’]/g, ''));

export function parseDecompte(text: string): { from: string; to: string; lines: DecompteLine[]; total: number }[] {
  const out: { from: string; to: string; lines: DecompteLine[]; total: number }[] = [];
  const re = /Charges fiscales\s*-\s*Exercice du (\d{2}\.\d{2}\.\d{4}) au (\d{2}\.\d{2}\.\d{4})/g;
  for (const m of text.matchAll(re)) {
    const rest = text.slice((m.index ?? 0) + m[0].length);
    const start = rest.search(/copropri[ée]t[ée]\.\s*/);
    const end = rest.search(/TOTAL\s+-?[\d'’]+\.\d{2}/);
    if (start < 0 || end < 0 || end < start) continue;
    const body = rest.slice(start, end).replace(/^copropri[ée]t[ée]\.\s*/, '');
    const lines: DecompteLine[] = [];
    for (const l of body.matchAll(/([A-Za-zÀ-ÿ][^\d]*?)\s{2,}(-?[\d'’]+\.\d{2})/g)) lines.push({ label: l[1].replace(/\s+/g, ' ').trim(), amount: num(l[2]) });
    const total = rest.slice(end).match(/TOTAL\s+(-?[\d'’]+\.\d{2})/);
    if (lines.length > 0 && total) out.push({ from: iso(m[1]), to: iso(m[2]), lines, total: num(total[1]) });
  }
  return out;
}

function parseSolde(text: string): { from: string; to: string; solde: number }[] {
  const out: { from: string; to: string; solde: number }[] = [];
  for (const m of text.matchAll(/d[ée]compte de copropri[ée]t[ée]\s*du (\d{2}\.\d{2}\.\d{4}) au (\d{2}\.\d{2}\.\d{4})[\s\S]{0,400}?solde en votre (faveur|d[ée]faveur) de\s*Fr\.\s*(-?[\d'’]+(?:\.\d+)?)/gi)) {
    const v = Math.abs(num(m[4]));
    out.push({ from: iso(m[1]), to: iso(m[2]), solde: /faveur$/i.test(m[3]) && !/d[ée]/i.test(m[3]) ? v : -v });
  }
  return out;
}

export function decomptesView(l: Ledger): Decompte[] {
  let rules: { re: string; bien: string }[] = [];
  try {
    rules = JSON.parse(l.getSetting('budget.biens') || '[]');
  } catch {
    rules = [];
  }
  const sources = l.raw.prepare('SELECT id FROM sources').all() as { id: string }[];
  const byKey = new Map<string, Decompte>();
  const soldes: { from: string; to: string; solde: number; bien: string | null }[] = [];
  for (const s of sources) {
    const text = (l.raw.prepare('SELECT text FROM chunks WHERE source_id = ? ORDER BY CAST(ord AS INTEGER)').all(s.id) as { text: string }[]).map((c) => c.text).join(' ');
    if (!/Charges fiscales|d[ée]compte de copropri[ée]t[ée]/i.test(text)) continue;
    const bien = rules.find((r) => new RegExp(r.re, 'i').test(text))?.bien ?? null;
    for (const d of parseDecompte(text)) {
      const key = `${bien}|${d.from}|${d.to}`;
      if (!byKey.has(key)) byKey.set(key, { bien, from: d.from, to: d.to, total: d.total, lines: d.lines, solde: null, paid: 0 });
    }
    for (const x of parseSolde(text)) soldes.push({ ...x, bien });
  }
  const txs = l.raw.prepare("SELECT date, amount, label, bien FROM budget_txs WHERE amount < 0 AND label LIKE '%PPE%'").all() as { date: string; amount: number; label: string; bien: string | null }[];
  const list = [...byKey.values()];
  for (const d of list) {
    d.solde = soldes.find((x) => x.from === d.from && x.to === d.to && (x.bien === d.bien || x.bien === null || d.bien === null))?.solde ?? null;
    d.paid = txs.filter((t) => t.date >= d.from && t.date <= d.to && (d.bien === null || t.bien === d.bien)).reduce((s, t) => s - t.amount, 0);
  }
  return list.sort((a, b) => b.to.localeCompare(a.to));
}

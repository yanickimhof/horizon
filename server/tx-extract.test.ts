import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Ledger } from './ledger';
import { budgetView } from './budget';
import { extractTransactions, looksLikeStatement, parseTxResponse, reconciles } from './tx-extract';
import { parseStatement } from './statements';
import { getWatch, runWatch, setWatch } from './watch';

const reply = (o: unknown) => async () => ({ text: JSON.stringify(o), costChf: 0.01 });

describe('relevés lus par un modèle', () => {
  it('garde les lignes valides et ignore les autres', () => {
    const x = parseTxResponse('Voici {"account":"Visa","currency":"CHF","openingBalance":0,"closingBalance":-80,"transactions":[{"date":"2026-09-02","label":"Coop","amount":-50},{"date":"2026-09-03","label":"Denner","amount":-30},{"date":"03.09","label":"mal daté","amount":-1},{"date":"2026-09-04","label":"zéro","amount":0}]}');
    expect(x.txs).toHaveLength(2);
    expect(reconciles(x)).toBe(true);
  });

  it('refuse d’enregistrer un relevé qui ne se réconcilie pas', async () => {
    const l = new Ledger(':memory:');
    const r = await extractTransactions(l, 'texte', 'rel.pdf', reply({ account: 'Visa', openingBalance: 0, closingBalance: -500, transactions: [{ date: '2026-09-02', label: 'Coop', amount: -50 }] }));
    expect(r.stored).toBe(0);
    expect(r.reconciled).toBe(false);
    expect(budgetView(l).count).toBe(0);
  });

  it('enregistre un relevé réconcilié, sans doublon au second passage', async () => {
    const l = new Ledger(':memory:');
    const llm = reply({ account: 'Carte Visa', openingBalance: 0, closingBalance: -80, transactions: [{ date: '2026-09-02', label: 'Coop', amount: -50 }, { date: '2026-09-03', label: 'Denner', amount: -30 }] });
    const a = await extractTransactions(l, 'texte', 'rel.pdf', llm);
    expect(a.stored).toBe(2);
    const b = await extractTransactions(l, 'texte', 'rel.pdf', llm);
    expect(b.stored).toBe(0);
    expect(b.skipped).toBe(2);
    expect(budgetView(l).accounts[0].kind).toBe('card');
  });

  it('reconnaît un texte de relevé', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `0${i + 1}.09.2026 Achat commerce ${i} 12.50`).join('\n');
    expect(looksLikeStatement(lines)).toBe(true);
    expect(looksLikeStatement('Bonjour, voici une lettre.')).toBe(false);
    expect(looksLikeStatement('rien', 'bank')).toBe(true);
  });
});

describe('format camt.053', () => {
  it('lit les écritures, le sens et le libellé', () => {
    const xml = `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.04"><BkToCstmrStmt><Stmt><Acct><Id><IBAN>CH9300762011623852957</IBAN></Id></Acct>
      <Ntry><Amt Ccy="CHF">125.40</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-09-05</Dt></BookgDt><NtryDtls><TxDtls><RltdPties><Cdtr><Nm>Coop Morges</Nm></Cdtr></RltdPties><RmtInf><Ustrd>Achat</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
      <Ntry><Amt Ccy="EUR">2000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-09-28</Dt></BookgDt><AddtlNtryInf>Salaire</AddtlNtryInf></Ntry></Stmt></BkToCstmrStmt></Document>`;
    const s = parseStatement('camt.xml', xml);
    expect(s.account).toContain('2957');
    expect(s.txs).toHaveLength(2);
    expect(s.txs[0]).toMatchObject({ date: '2026-09-05', amount: -125.4 });
    expect(s.txs[0].label).toContain('Coop');
    expect(s.txs[1]).toMatchObject({ amount: 2000, currency: 'EUR' });
  });
});

describe('dossier surveillé et budget', () => {
  it('place les relevés CSV d’un dossier dans le budget, une seule fois', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hz-'));
    const csv = ['IBAN;Booked At;Text;Credit/Debit Amount;Balance;Valuta Date', ...Array.from({ length: 4 }, (_, i) => `CH9300762011623852957;2026-09-0${i + 1} 00:00:00.0;Achat ${i};-${10 + i};0;2026-09-0${i + 1} 00:00:00.0`)].join('\n');
    writeFileSync(join(dir, 'compte.csv'), csv);
    const l = new Ledger(':memory:');
    setWatch(l, { dirs: [dir], auto: false });
    expect(getWatch(l).dirs).toEqual([dir]);
    const first = await runWatch(l, { extract: false });
    expect(first.status.transactions).toBe(4);
    expect(budgetView(l).count).toBe(4);
    const second = await runWatch(l, { extract: false });
    expect(second.status.transactions).toBe(0);
    expect(budgetView(l).count).toBe(4);
  });
});

describe('réponse coupée et sens des soldes', () => {
  it('récupère les lignes complètes d’une réponse tronquée', () => {
    const cut = '{"account": "Visa", "currency": "CHF", "openingBalance": 0, "closingBalance": -60.5, "transactions": [{"date": "2026-04-03", "label": "Coop, Morges CH", "amount": -9.5, "currency": "CHF"},{"date": "2026-04-04", "label": "Denner \\"Assens\\"", "amount": -51, "currency": "CHF"},{"date": "2026-04';
    const x = parseTxResponse(cut);
    expect(x.account).toBe('Visa');
    expect(x.txs).toHaveLength(2);
    expect(x.txs[1].label).toContain('Assens');
    expect(reconciles(x)).toBe(true);
  });

  it('accepte le sens inverse d’un solde de carte', () => {
    const x = parseTxResponse('{"account":"Visa","openingBalance":100,"closingBalance":160.5,"transactions":[{"date":"2026-04-03","label":"Coop","amount":-60.5}]}');
    expect(reconciles(x)).toBe(true);
  });
});

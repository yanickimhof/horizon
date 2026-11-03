import { useState } from 'react';
import { api, fmt, type Db, type State, type StatementReport } from '../api';

const CHOICES: [string, string][] = [
  ['impots', 'Impôts'],
  ['assurances', 'Assurances'],
  ['logement', 'Immobilier'],
  ['vehicule', 'Véhicules'],
  ['quotidien', 'Vie courante'],
  ['sante', 'Santé'],
  ['famille', 'Famille'],
  ['epargne', 'Épargne, prévoyance'],
  ['interne', 'Entre mes comptes'],
  ['autre', 'Autre'],
];
import '../retraite.css';

/** Décode un fichier en UTF-8, ou en Latin-1 si les accents ne passent pas (exports bancaires suisses). */
async function readText(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('iso-8859-1').decode(buf);
  }
}

const date = (iso: string) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('fr-CH') : '');

/**
 * Analyse de relevés: règles locales d'abord, Claude seulement pour les libellés inconnus, avec accord.
 * Montre ce que disent les relevés par mois, et l'écart avec ce qu'Horizon sait déjà.
 */
export function Statements({ db, state, reveal, setState }: { db: Db; state: State; reveal: boolean; setState?: (s: State) => void }) {
  const pv = state.privacy;
  const aiReady = pv.mode === 'assisted' && pv.hasKey && Boolean(pv.consentAnalysis);
  const [files, setFiles] = useState<File[]>([]);
  const [useAi, setUseAi] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [r, setR] = useState<StatementReport | null>(null);
  const [texts, setTexts] = useState<{ name: string; text: string }[]>([]);
  const money = (n: number) => (reveal ? fmt.money(n) : '••••');
  const [proposed, setProposed] = useState<Record<string, boolean>>({});
  const propose = async (v: { key: string; statements: number; horizon: number }) => {
    try {
      const s = await api.post(db, 'statements/propose', { key: v.key, statements: v.statements, horizon: v.horizon });
      setState?.(s);
      setProposed((p) => ({ ...p, [v.key]: true }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const analyze = async (payload: { name: string; text: string }[]) => {
    setBusy(true);
    setErr('');
    try {
      setR(await api.analyzeStatements(db, payload, useAi && aiReady));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (files.length === 0) return;
    const payload = await Promise.all(files.map(async (f) => ({ name: f.name, text: await readText(f) })));
    setTexts(payload);
    await analyze(payload);
  };

  /** Classe une ligne pour de bon: la signature est mémorisée, puis l'analyse est refaite sans Claude. */
  const label = async (key: string, category: string) => {
    if (!category) return;
    try {
      await api.labelStatement(db, key, category);
      await analyze(texts);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="group stmts">
      <header><h2>Relevés bancaires</h2></header>
      <div className="group-body">
        <div className="line">
          <div className="line-main">
            <div className="line-title">Analyser mes relevés</div>
            <div className="line-sub">Choisis les exports CSV de tes comptes, sur douze mois. Le classement se fait sur ton ordinateur.</div>
          </div>
          <div className="stmts-pick">
            <input type="file" accept=".csv,text/csv" multiple aria-label="Relevés au format CSV" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
            <button className="btn primary" onClick={run} disabled={busy || files.length === 0}>{busy ? 'Analyse…' : 'Analyser'}</button>
          </div>
        </div>
        <div className="line">
          {aiReady ? (
            <div className="line-top">
              <div className="line-main">
                <div className="line-title">Claude classe les lignes inconnues</div>
                <div className="line-sub">Seuls des libellés réduits partent, sans montant ni date. Coût typique: quelques centimes.</div>
              </div>
              <button type="button" role="switch" aria-checked={useAi} aria-label="Claude classe les lignes inconnues" className={'switch' + (useAi ? ' on' : '')} onClick={() => setUseAi(!useAi)}><i /></button>
            </div>
          ) : (
            <div className="line-sub">Pour que Claude classe les lignes inconnues: Confidentialité, mode Assisté, accord d’analyse et clé d’API.</div>
          )}
        </div>
      </div>
      {err && <p className="error" role="alert">{err}</p>}

      {r && r.categories.length > 0 && (
        <div className="stmts-out">
          <p className="muted small">
            {r.months} mois, du {date(r.from)} au {date(r.to)}, {r.accounts.length} compte{r.accounts.length > 1 ? 's' : ''}.
            {r.internal.count > 0 ? ` ${r.internal.count} virement${r.internal.count > 1 ? 's' : ''} entre comptes écarté${r.internal.count > 1 ? 's' : ''}.` : ''}
            {r.ai.note ? ` ${r.ai.used ? 'Claude: ' : ''}${r.ai.note}` : ''}
          </p>

          <section className="group">
            <header><h2>Dépenses par mois</h2></header>
            <div className="group-body">
              {r.categories.map((c) => (
                <div key={c.key} className="line">
                  <div className="line-top">
                    <div className="line-main"><div className="line-title">{c.label}</div><div className="line-sub">{c.count} paiement{c.count > 1 ? 's' : ''}</div></div>
                    <div className="line-end"><b>{money(c.monthly)}</b></div>
                  </div>
                </div>
              ))}
              <div className="line"><div className="line-top"><div className="line-main"><div className="line-title">Revenus encaissés</div></div><div className="line-end"><b>{money(r.income.monthly)}</b></div></div></div>
            </div>
          </section>

          <section className="group">
            <header><h2>Écart avec Horizon, par mois</h2></header>
            <div className="group-body">
              {r.vsHorizon.map((v) => {
                const off = Math.abs(v.gap) > Math.max(50, v.horizon * 0.1);
                return (
                  <div key={v.key} className="line">
                    <div className="line-top">
                      <div className="line-main">
                        <div className="line-title">{v.label}</div>
                        <div className="line-sub">Relevés {money(v.statements)}, Horizon {money(v.horizon)}</div>
                      </div>
                      <div className="line-end">
                        <span className={'tag ' + (off ? 'assumed' : 'ok')}>{off ? (reveal ? `${v.gap > 0 ? '+' : '−'}${fmt.money(Math.abs(v.gap))}` : 'Écart') : 'Cohérent'}</span>
                        {off && v.gap > 0 ? (proposed[v.key] ? <span className="muted small">Proposé, à valider</span> : <button className="btn small" onClick={() => propose(v)}>Proposer</button>) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {r.unknown.samples.length > 0 && (
            <section className="group">
              <header><h2>À identifier</h2></header>
              <div className="group-body">
                {r.unknown.samples.slice(0, 8).map((u) => (
                  <div key={u.key} className="line">
                    <div className="line-top">
                      <div className="line-main"><div className="line-title">{u.label}</div><div className="line-sub">{u.count} fois, {money(u.amount)} chacune</div></div>
                      <div className="line-end">
                        <select aria-label={`Classer ${u.label}`} defaultValue="" onChange={(e) => label(u.key, e.target.value)}>
                          <option value="">Classer</option>
                          {CHOICES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
                <p className="note">Un classement est mémorisé: il s’applique à tous tes futurs relevés.</p>
              </div>
            </section>
          )}

          {r.recurring.length > 0 && (
            <section className="group">
              <header><h2>Paiements récurrents</h2></header>
              <div className="group-body">
                {r.recurring.slice(0, 8).map((x) => (
                  <div key={x.key} className="line">
                    <div className="line-top">
                      <div className="line-main"><div className="line-title">{x.label}</div><div className="line-sub">{x.months} mois, {money(x.amount)}</div></div>
                      <div className="line-end"><span className={'tag ' + (x.category === 'inconnu' ? 'assumed' : 'ok')}>{x.category === 'inconnu' ? 'À identifier' : (CHOICES.find(([k]) => k === x.category)?.[1] ?? 'Reconnu')}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      {r && r.categories.length === 0 && !err && <p className="muted small">Aucune dépense reconnue dans ces fichiers. Vérifie qu’il s’agit d’exports CSV de relevés.</p>}
    </section>
  );
}

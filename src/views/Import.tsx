import { useState } from 'react';
import { FileSearch } from 'lucide-react';
import { api, type Db, type ManifestEntry, type State, type WatchStatus } from '../api';
import { Statements } from './Statements';
import '../stmts.css';
import '../retraite.css';

const STATUS: Record<string, string> = {
  extracted: 'Lu', needs_reading: 'À lire visuellement', duplicate: 'Déjà importé', skipped: 'Ignoré',
};
const TYPE: Record<string, string> = {
  'tax-return': 'Impôts', payslip: 'Salaire', bank: 'Banque', pension: 'Prévoyance', mortgage: 'Hypothèque', insurance: 'Assurance', valuation: 'Estimation', crypto: 'Crypto', other: 'Autre',
};
const MASKED: Record<string, string> = { avs: 'AVS', iban: 'IBAN', carte: 'carte', email: 'e-mail', tel: 'téléphone', numero: 'numéro', naissance: 'naissance' };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

function summary(s: WatchStatus): string {
  const parts = [
    plural(s.read, 'document lu', 'documents lus'),
    s.duplicates ? plural(s.duplicates, 'déjà connu', 'déjà connus') : '',
    s.unreadable ? `${s.unreadable} à lire visuellement` : '',
    s.transactions ? plural(s.transactions, 'ligne ajoutée au budget', 'lignes ajoutées au budget') : '',
    s.proposed ? plural(s.proposed, 'fait à valider', 'faits à valider') : '',
    s.learned ? plural(s.learned, 'nouveau nom ou adresse masqué', 'nouveaux noms ou adresses masqués') : '',
  ].filter(Boolean);
  return `Dernier contrôle à ${new Date(s.at).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })}: ${parts.join(', ')}.`;
}

export function Import({ db, state, setState, reveal, goto }: { db: Db; state: State; setState: (s: State) => void; reveal: boolean; goto?: (tab: string) => void }) {
  const [dirs, setDirs] = useState(state.watch.dirs.join('\n'));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [manifest, setManifest] = useState<ManifestEntry[] | null>(null);

  const list = dirs.split('\n').map((x) => x.trim()).filter(Boolean);
  const last = state.watch.last;

  const run = async () => {
    if (list.length === 0) return;
    setBusy(true);
    setErr('');
    try {
      await api.watchSet(db, { dirs: list });
      const r = await api.watchRun(db);
      setState(r.state);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setAuto = async (auto: boolean) => {
    setErr('');
    try {
      setState(await api.watchSet(db, { dirs: list, auto }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const taxYears = (country: string) =>
    [...new Set(state.sources.filter((s) => s.meta?.type === 'tax-return' && s.meta?.country === country && s.meta?.year).map((s) => s.meta!.year!))].sort();
  const ch = taxYears('CH');
  const us = taxYears('US');

  return (
    <div className="page">
      <h1>Importer</h1>
      <p className="lede">
        Dépose tout dans un dossier de ton ordinateur: relevés de comptes et de cartes (CSV, camt.053, PDF, copies d’écran), impôts, hypothèques, assurances. Horizon lit chaque fichier, masque les noms, adresses et numéros, ajoute les lignes au budget et te propose les chiffres à valider.
      </p>

      <div className="form">
        <textarea value={dirs} onChange={(e) => setDirs(e.target.value)} rows={2} placeholder="/Users/toi/Documents/Horizon" aria-label="Dossier des documents, un chemin par ligne" />
        <div className="actions">
          <button className="btn primary" onClick={run} disabled={busy || list.length === 0}>{busy ? 'Analyse…' : 'Analyser maintenant'}</button>
          <label className="auto">
            <button type="button" role="switch" aria-checked={state.watch.auto} aria-label="Contrôle automatique" className={'switch' + (state.watch.auto ? ' on' : '')} onClick={() => setAuto(!state.watch.auto)} disabled={list.length === 0}><i /></button>
            <span>Contrôle automatique des nouveaux documents</span>
          </label>
        </div>
      </div>
      <p className="muted small">
        Un fichier déjà lu n’est jamais relu, même renommé. Les scans sont lus par la reconnaissance de texte de ton Mac. Seul le texte masqué peut être envoyé à Claude, et seulement si tu as autorisé l’analyse dans Confidentialité.
      </p>
      {err && <p className="error" role="alert">{err}</p>}

      {last && (
        <section className="block">
          <p>{summary(last)}</p>
          {last.proposed > 0 && goto ? <button className="btn small" onClick={() => goto('inbox')}>Voir les faits à valider</button> : null}
          {last.notes.length > 0 && (
            <ul className="muted small">
              {last.notes.slice(0, 6).map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
        </section>
      )}

      <Statements db={db} state={state} reveal={reveal} setState={setState} />

      {manifest && manifest.length > 0 && (
        <section className="block">
          <h2>Dernière analyse</h2>
          <ul className="list">
            {manifest.map((m) => (
              <li key={m.path} className="row">
                <div className="row-main">
                  <div className="row-title">{m.path}</div>
                  <div className="row-sub">
                    {[m.meta?.type ? TYPE[m.meta.type] : '', m.meta?.country, m.meta?.year].filter(Boolean).join(', ') || 'Type non reconnu'}
                    {m.note ? `. ${m.note}` : ''}
                    {m.redactions && Object.keys(m.redactions).length > 0 ? `. Masqué: ${Object.entries(m.redactions).map(([k, v]) => `${v} ${MASKED[k] ?? k}`).join(', ')}` : ''}
                  </div>
                </div>
                <span className={'tag ' + (m.status === 'duplicate' || m.status === 'skipped' ? '' : m.status === 'needs_reading' ? 'assumed' : 'ok')}>{STATUS[m.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="block">
        <div className="block-head">
          <h2>Ce qui est indexé</h2>
          <FileSearch size={18} strokeWidth={1.5} aria-hidden="true" />
        </div>
        <p className="muted">
          {plural(state.docs.sources, 'document')}, {plural(state.docs.chunks, 'passage consultable', 'passages consultables')}.
          {ch.length ? ` Impôts suisses: ${ch.join(', ')}.` : ''}
          {us.length ? ` Impôts américains: ${us.join(', ')}.` : ''}
        </p>
        {state.sources.length > 0 && (
          <ul className="list">
            {state.sources.map((s) => (
              <li key={s.id} className="row">
                <div className="row-main">
                  <div className="row-title">{s.name}</div>
                  <div className="row-sub">{[s.meta?.type ? TYPE[s.meta.type] : '', s.meta?.country, s.meta?.year].filter(Boolean).join(', ')}</div>
                </div>
                <div className="row-end muted small">{new Date(s.addedAt).toLocaleDateString('fr-CH')}</div>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">
          Autonomie: {state.autonomy.handled === 0 ? 'pas encore de document traité' : `${Math.round(state.autonomy.share * 100)} % des documents traités sans modèle`}, {plural(state.autonomy.rules, 'règle apprise', 'règles apprises')}.
        </p>
      </section>
    </div>
  );
}

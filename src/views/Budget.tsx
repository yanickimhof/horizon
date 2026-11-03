import { useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { api, fmt, type Db, type State, type WatchStatus } from '../api';
import '../budget.css';

const CATS: [string, string][] = [
  ['logement', 'Immobilier'], ['travaux', 'Travaux et rénovations'], ['impots', 'Impôts'], ['assurances', 'Assurances'], ['sante', 'Santé'], ['alimentation', 'Alimentation'],
  ['restaurants', 'Restaurants et cafés'], ['abonnements', 'Abonnements numériques'], ['telecom', 'Télécoms et hébergement'], ['energie', 'Énergie, eau, chauffage'],
  ['vehicule', 'Véhicules'], ['transports', 'Transports publics et taxis'], ['voyages', 'Voyages et vacances'], ['loisirs', 'Loisirs, sport, culture'],
  ['vetements', 'Vêtements'], ['maison', 'Maison, équipement'], ['enfants', 'Enfants et études'], ['famille', 'Famille'], ['dons', 'Cadeaux et dons'],
  ['banque', 'Frais bancaires'], ['especes', 'Espèces et devises'], ['neobanque', 'Recharges Revolut, détail manquant'], ['carte', 'Cartes, détail manquant'],
  ['quotidien', 'Vie courante, autre'], ['autre', 'Autre'],
];
const LABEL: Record<string, string> = { ...Object.fromEntries(CATS), inconnu: 'À identifier' };
const CHOICES: [string, string][] = [...CATS, ['epargne', 'Épargne, prévoyance'], ['interne', 'Entre mes comptes']];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

function summary(s: WatchStatus): string {
  const parts = [
    plural(s.read, 'document lu', 'documents lus'),
    s.statements ? plural(s.statements, 'relevé', 'relevés') : '',
    s.transactions ? plural(s.transactions, 'ligne ajoutée', 'lignes ajoutées') : '',
    s.duplicates ? plural(s.duplicates, 'déjà connu', 'déjà connus') : '',
    s.unreadable ? `${s.unreadable} à lire visuellement` : '',
    s.proposed ? plural(s.proposed, 'fait à valider', 'faits à valider') : '',
  ].filter(Boolean);
  return `Dernière lecture à ${new Date(s.at).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })}: ${parts.join(', ')}.`;
}

const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('fr-CH', { month: 'long', year: 'numeric' });

async function readText(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('iso-8859-1').decode(buf);
  }
}

/**
 * Budget réel: ce que le ménage dépense vraiment, mois par mois, d'après les relevés importés.
 * Les montants suivent le bouton œil; les proportions et les tendances restent visibles.
 */
export function Budget({ db, state, setState, reveal }: { db: Db; state: State; setState: (s: State) => void; reveal: boolean }) {
  const b = state.budget;
  const money = (n: number) => (reveal ? fmt.money(n) : '••••');
  const [dir, setDir] = useState(state.watch.dirs[0] ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const full = useMemo(() => b.months.filter((m) => !m.partial), [b.months]);
  const last = full[full.length - 1];
  const [period, setPeriod] = useState('12');
  const years = useMemo(() => [...new Set(full.filter((m) => m.spend > 0).map((m) => m.month.slice(0, 4)))].filter((y) => full.filter((m) => m.month.startsWith(y) && m.spend > 0).length >= 6).sort().reverse(), [full]);
  const yearOk = period === '12' || years.includes(period);
  const used = period === '12' || !yearOk ? full.slice(-12) : full.filter((m) => m.month.startsWith(period));
  const prevYear = period !== '12' && yearOk ? full.filter((m) => m.month.startsWith(String(Number(period) - 1))) : [];
  const periodLabel = period === '12' || !yearOk ? `${used.length} derniers mois` : `${used.length} mois de ${period}`;
  // Une dépense payée une année mais qui appartient à une autre (solde d'impôts) suit son année dans la vue par année.
  const adj = useMemo(() => {
    const byCat: Record<string, number> = {};
    let total = 0;
    if (period !== '12' && yearOk) {
      for (const m of full) {
        const inUsed = m.month.startsWith(period);
        for (const mv of m.moved ?? []) {
          if (inUsed && mv.year !== period) {
            byCat[mv.category] = (byCat[mv.category] ?? 0) - mv.amount;
            total -= mv.amount;
          }
          if (!inUsed && mv.year === period) {
            byCat[mv.category] = (byCat[mv.category] ?? 0) + mv.amount;
            total += mv.amount;
          }
        }
      }
    }
    return { byCat, total };
  }, [full, period, yearOk]);
  const avg = (f: (m: (typeof full)[number]) => number) => (used.length ? used.reduce((s, m) => s + f(m), 0) / used.length : 0);
  const avgIncome = avg((m) => m.income);
  const avgSpend = avg((m) => m.spend) + (used.length ? adj.total / used.length : 0);
  const avgOneOff = avg((m) => (m.oneOff ?? 0) + Object.values(m.works ?? {}).reduce((s, v) => s + v, 0));
  const avgEstimated = avg((m) => m.estimated);
  const maxBar = Math.max(1, ...used.flatMap((m) => [m.income + m.exceptional, m.spend]));
  const sum = (f: (m: (typeof full)[number]) => number) => used.reduce((s, m) => s + f(m), 0);

  // Tendance: trois derniers mois contre les trois précédents.
  const cats = useMemo(() => {
    const keys = [...new Set([...used.flatMap((m) => Object.keys(m.byCategory)), ...Object.keys(adj.byCat)])];
    const mean = (ms: typeof used, k: string) => (ms.length ? ms.reduce((s, m) => s + (m.byCategory[k] ?? 0), 0) / ms.length : 0);
    return keys
      .map((k) => {
        const recent = mean(used.slice(-3), k);
        const before = mean(used.slice(-6, -3), k);
        const prevAvg = prevYear.length >= 6 ? mean(prevYear, k) : null;
        const trend = prevAvg !== null ? (prevAvg > 20 ? mean(used, k) / prevAvg - 1 : null) : used.length >= 6 && before > 20 ? recent / before - 1 : null;
        return { key: k, avg: mean(used, k) + (used.length ? (adj.byCat[k] ?? 0) / used.length : 0), last: last?.byCategory[k] ?? 0, trend, prevAvg };
      })
      .filter((c) => c.avg > 0)
      .sort((p, q) => q.avg - p.avg);
  }, [used, last, prevYear, adj]);

  const immoRows = useMemo(() => {
    const t: Record<string, { loyers: number; charges: number }> = {};
    for (const m of used) for (const [k, v] of Object.entries(m.immo ?? {})) {
      const x = (t[k] = t[k] ?? { loyers: 0, charges: 0 });
      x.loyers += v.loyers;
      x.charges += v.charges;
    }
    // Le domicile d'abord, puis les biens loués, puis ce qui n'est pas encore rattaché à un bien.
    const rank = (k: string) => ((b.homes ?? []).includes(k) ? 0 : k === 'Non réparti' ? 2 : 1);
    return Object.entries(t).sort((p, q) => rank(p[0]) - rank(q[0]) || p[0].localeCompare(q[0]));
  }, [used, b.homes]);
  // Dépenses par catégorie, par année ou par mois, pour voir d'un coup d'œil ce qu'une catégorie coûte sur l'année.
  const [catView, setCatView] = useState<'annee' | 'mois'>('annee');
  const catTable = useMemo(() => {
    type Col = { key: string; label: string; sub: string; totals: Record<string, number>; n: number };
    let cols: Col[] = [];
    if (catView === 'mois') {
      cols = used.map((m) => ({ key: m.month, label: new Date(`${m.month}-01T00:00:00`).toLocaleDateString('fr-CH', { month: 'short' }), sub: m.month.slice(0, 4), totals: m.byCategory, n: 1 }));
    } else {
      for (const y of [...new Set(full.map((m) => m.month.slice(0, 4)))].sort()) {
        const mm = full.filter((m) => m.month.startsWith(y));
        if (mm.length < 3) continue; // une année à peine entamée ne dit rien
        const totals: Record<string, number> = {};
        for (const m of mm) for (const [k, v] of Object.entries(m.byCategory)) totals[k] = (totals[k] ?? 0) + v;
        // Un impôt payé une autre année suit son année.
        for (const m of full) {
          for (const mv of m.moved ?? []) {
            const inYear = m.month.startsWith(y);
            if (inYear && mv.year !== y) totals[mv.category] = (totals[mv.category] ?? 0) - mv.amount;
            if (!inYear && mv.year === y) totals[mv.category] = (totals[mv.category] ?? 0) + mv.amount;
          }
        }
        cols.push({ key: y, label: y, sub: mm.length < 12 ? `${mm.length} mois` : '', totals, n: mm.length });
      }
    }
    const keys = [...new Set(cols.flatMap((c) => Object.keys(c.totals)))].filter((k) => cols.some((c) => (c.totals[k] ?? 0) > 0));
    const lastCol = cols[cols.length - 1];
    if (lastCol) keys.sort((p, q) => (lastCol.totals[q] ?? 0) - (lastCol.totals[p] ?? 0));
    return { cols, keys };
  }, [catView, used, full]);
  const worksByBien = useMemo(() => {
    const t: Record<string, number> = {};
    for (const m of used) for (const [k, v] of Object.entries(m.works ?? {})) t[k] = (t[k] ?? 0) + v;
    return Object.entries(t).sort((p, q) => q[1] - p[1]);
  }, [used]);
  const [rules, setRules] = useState<{ words: string; bien: string; home: boolean; from: string; to: string }[]>([]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const toWords = (re: string) => re.split('|').map((x) => x.replace(/\\(.)/g, '$1')).join(', ');
  const fromWords = (w: string) => w.split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  useEffect(() => {
    setRules((b.biens ?? []).map((r) => ({ words: toWords(r.re), bien: r.bien, home: !!r.home, from: r.from ?? '', to: r.to ?? '' })));
  }, [b.biens]);
  const saveRules = async () => {
    try {
      setState(await api.post(db, 'budget/biens', { rules: rules.map((r) => ({ re: fromWords(r.words), bien: r.bien, home: r.home, from: r.from || undefined, to: r.to || undefined })) }));
      setRulesOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const [est, setEst] = useState({ label: '', amount: '', currency: 'CHF', per: 'month', category: 'abonnements' });
  const addEst = async () => {
    const amount = Number(est.amount.replace(',', '.'));
    if (!est.label.trim() || !(amount > 0)) return;
    try {
      setState(await api.post(db, 'budget/estimate', { ...est, amount }));
      setEst({ ...est, label: '', amount: '' });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const removeEst = async (id: string) => {
    try {
      setState(await api.post(db, 'budget/estimate/remove', { id }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const classifyAi = async () => {
    setErr('');
    setMsg('Classement par Claude…');
    try {
      const r = await api.budgetClassify(db);
      setState(r.state);
      setMsg(r.result.classified > 0 ? `${r.result.classified} ligne${r.result.classified > 1 ? 's' : ''} classée${r.result.classified > 1 ? 's' : ''}.` : r.result.note || 'Rien à classer.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setMsg('');
    }
  };

  const running = state.watch.running;

  // Pendant une lecture en arrière-plan, l'état est relu toutes les trois secondes.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(async () => {
      try {
        setState(await api.state(db));
      } catch {
        /* le serveur est occupé: on réessaie */
      }
    }, 3000);
    return () => clearInterval(id);
  }, [running, db, setState]);

  const rescan = async () => {
    if (!dir.trim()) return;
    setErr('');
    setMsg('');
    try {
      await api.watchSet(db, { dirs: [dir.trim()] });
      const r = await api.watchRun(db);
      setState(r.state);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const add = async () => {
    if (files.length === 0) return;
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const payload = await Promise.all(files.map(async (f) => ({ name: f.name, text: await readText(f) })));
      const r = await api.budgetImport(db, payload);
      setState(r.state);
      setMsg(`${r.result.added} nouvelle${r.result.added > 1 ? 's' : ''} ligne${r.result.added > 1 ? 's' : ''}${r.result.skipped ? `, ${r.result.skipped} déjà connue${r.result.skipped > 1 ? 's' : ''}` : ''}.`);
      setFiles([]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const classify = async (key: string, category: string) => {
    if (!category) return;
    try {
      setState(await api.post(db, 'budget/label', { key, category }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="page wide budget">
      <h1>Budget</h1>
      <p className="lede">Ce que ton ménage dépense vraiment, d’après tes relevés. Chaque ligne n’est comptée qu’une fois, les virements entre tes comptes et les doublons sont écartés.</p>

      <section className="tile import">
        <h2>Dossier de documents</h2>
        <div className="imp-row">
          <input className="path" value={dir} onChange={(e) => setDir(e.target.value)} placeholder="/Users/toi/Documents/Horizon-Documents" aria-label="Dossier de documents" />
          <button className="btn primary" onClick={rescan} disabled={running || !dir.trim()}>{running ? 'Lecture en cours…' : 'Relire le dossier'}</button>
        </div>
        {running ? (
          <div className="working" role="status" aria-live="polite">
            <i className="spin" aria-hidden="true" />
            <span>{state.watch.step || 'Lecture'}…</span>
            <div className="shimmer" aria-hidden="true" />
          </div>
        ) : null}
        <p className="muted small">
          {running ? `${state.watch.step || 'Lecture'}…` : msg || (state.watch.last ? summary(state.watch.last) : 'Dépose tes relevés dans ce dossier, puis relis-le: les nouveaux fichiers sont lus, les déjà connus ignorés.')}
          {b.count > 0 ? ` Budget: ${b.count} lignes, ${plural(b.accounts.length, 'compte')}${b.currencies.length > 1 ? `, devises ${b.currencies.join(', ')}` : ''}.` : ''}
        </p>
        {state.watch.last && state.watch.last.notes.length > 0 ? (
          <ul className="muted small notes">
            {state.watch.last.notes.slice(0, 5).map((n) => <li key={n}>{n}</li>)}
          </ul>
        ) : null}
        <details className="manual">
          <summary>Ajouter des fichiers à la main</summary>
          <div className="imp-row">
            <input type="file" multiple accept=".csv,.txt,.xml" aria-label="Relevés de comptes et de cartes" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
            <button className="btn" onClick={add} disabled={busy || files.length === 0}>Ajouter</button>
          </div>
        </details>
        {err ? <p className="error" role="alert">{err}</p> : null}
      </section>

      {last ? (
        <>
          {years.length > 0 ? (
            <div className="periods" role="tablist" aria-label="Période">
              <button className={'btn' + (period === '12' ? ' primary' : '')} onClick={() => setPeriod('12')}>12 derniers mois</button>
              {years.map((y) => <button key={y} className={'btn' + (period === y ? ' primary' : '')} onClick={() => setPeriod(y)}>{y}</button>)}
            </div>
          ) : null}
          <div className="three">
            <section className="tile"><h2>Revenus par mois</h2><p className="big">{money(avgIncome)}</p><p className="unit">moyenne sur {periodLabel}</p></section>
            <section className="tile"><h2>Dépenses par mois</h2><p className="big">{money(avgSpend)}</p><p className="unit">{avgIncome > 0 ? `${fmt.pct(avgSpend / avgIncome)} des revenus` : 'revenus non identifiés'}{avgEstimated > 1 ? `, dont ${money(avgEstimated)} estimé` : ''}</p>
              <p className="unit">Habituelles, sans travaux ni montants uniques: {money(avgSpend - avgOneOff)}</p></section>
            <section className="tile">
              <h2>Reste par mois</h2>
              <p className={'big' + (avgIncome - avgSpend < 0 ? ' neg' : '')}>{money(avgIncome - avgSpend)}</p>
              <p className="unit">dernier mois, {monthName(used[used.length - 1].month)}: {money(used[used.length - 1].income - used[used.length - 1].spend)}</p>
            </section>
          </div>

          <section className="tile">
            <h2>Mois par mois</h2>
            <div className="bars" role="img" aria-label="Revenus et dépenses par mois">
              {used.map((m) => (
                <div key={m.month} className="bar-col" title={monthName(m.month)}>
                  <div className="pair">
                    <i className="inc" style={{ height: `${(m.income / maxBar) * 100}%` }} />
                    {m.exceptional > 0 ? <i className="one" style={{ height: `${(m.exceptional / maxBar) * 100}%` }} /> : null}
                    <i className={'out' + (m.spend > m.income && m.income > 0 ? ' over' : '')} style={{ height: `${(m.spend / maxBar) * 100}%` }} />
                  </div>
                  <span>{m.month.slice(5)}</span>
                </div>
              ))}
            </div>
            <p className="legend"><i className="inc" />Revenus <i className="one" />Versements uniques <i className="out" />Dépenses</p>
            <p className="muted small">
              Sur {periodLabel}: revenus réguliers {money(sum((m) => m.income))}, versements uniques {money(sum((m) => m.exceptional))}, dépenses {money(sum((m) => m.spend))}, mis de côté {money(sum((m) => m.saved))} (épargne, prévoyance, parts sociales). Seuls les doublons et les virements entre tes comptes sont écartés.
            </p>
          </section>

          <section className="tile">
            <h2>Où part l’argent</h2>
            <ul className="cats">
              {cats.map((c) => (
                <li key={c.key}>
                  <span className="name">{LABEL[c.key] ?? c.key}</span>
                  <span className="share"><i style={{ width: `${avgSpend > 0 ? Math.min(100, (c.avg / avgSpend) * 100) : 0}%` }} /></span>
                  <span className="amt">{money(c.avg)}{c.prevAvg !== null && prevYear.length >= 6 ? <span className="muted small"> ({Number(period) - 1}: {money(c.prevAvg)})</span> : null}</span>
                  <span className={'trend' + (c.trend !== null && c.trend > 0.15 ? ' up' : c.trend !== null && c.trend < -0.15 ? ' down' : '')}>
                    {c.trend === null ? '' : c.trend > 0.15 ? <><ArrowUpRight size={14} strokeWidth={1.8} />{Math.round(c.trend * 100)} %</> : c.trend < -0.15 ? <><ArrowDownRight size={14} strokeWidth={1.8} />{Math.round(c.trend * 100)} %</> : 'stable'}
                  </span>
                </li>
              ))}
            </ul>
            <p className="muted small">Moyenne par mois. {prevYear.length >= 6 ? `La tendance compare ${period} à ${Number(period) - 1}.` : 'La tendance compare les trois derniers mois aux trois précédents.'}</p>
          </section>
          {catTable.cols.length > 0 && catTable.keys.length > 0 ? (
            <section className="tile">
              <h2>Dépenses par catégorie</h2>
              <div className="periods" role="tablist" aria-label="Affichage des catégories">
                <button className={'btn' + (catView === 'annee' ? ' primary' : '')} onClick={() => setCatView('annee')}>Par année</button>
                <button className={'btn' + (catView === 'mois' ? ' primary' : '')} onClick={() => setCatView('mois')}>Par mois</button>
              </div>
              <div className="cattable-wrap">
                <table className="cattable">
                  <thead>
                    <tr>
                      <th>Catégorie</th>
                      {catTable.cols.map((c) => <th key={c.key}>{c.label}{c.sub ? <span className="muted small"> {c.sub}</span> : null}</th>)}
                      {catView === 'annee' && catTable.cols.length >= 2 ? <th>Évolution</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {catTable.keys.map((k) => {
                      const a = catTable.cols[catTable.cols.length - 2];
                      const z = catTable.cols[catTable.cols.length - 1];
                      const evo = catView === 'annee' && a && z && a.n >= 6 && z.n >= 6 && (a.totals[k] ?? 0) / a.n > 20 ? (z.totals[k] ?? 0) / z.n / ((a.totals[k] ?? 0) / a.n) - 1 : null;
                      return (
                        <tr key={k}>
                          <th scope="row">{LABEL[k] ?? k}</th>
                          {catTable.cols.map((c) => <td key={c.key}>{c.totals[k] ? money(c.totals[k]) : '·'}</td>)}
                          {catView === 'annee' && catTable.cols.length >= 2 ? <td className={'trend' + (evo !== null && evo > 0.15 ? ' up' : evo !== null && evo < -0.15 ? ' down' : '')}>{evo === null ? '' : `${evo > 0 ? '+' : ''}${Math.round(evo * 100)} %`}</td> : null}
                        </tr>
                      );
                    })}
                    <tr className="total">
                      <th scope="row">Total</th>
                      {catTable.cols.map((c) => <td key={c.key}>{money(Object.entries(c.totals).reduce((s, [k, v]) => s + (catTable.keys.includes(k) ? v : 0), 0))}</td>)}
                      {catView === 'annee' && catTable.cols.length >= 2 ? <td /> : null}
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="muted small">{catView === 'annee' ? 'Total payé dans l’année, impôts rattachés à leur année. L’évolution compare la moyenne mensuelle des deux dernières années.' : `Dépenses de chaque mois sur ${periodLabel}.`}</p>
            </section>
          ) : null}

          {immoRows.length > 0 ? (
            <section className="tile">
              <h2>Immobilier: ménage et locatif</h2>
              <ul className="cats">
                <li><span className="name muted small">Bien</span><span className="amt muted small">Loyers · charges · net</span></li>
                {immoRows.map(([bien, v]) => (
                  <li key={bien}>
                    <span className="name">{(b.homes ?? []).includes(bien) && !/domicile/i.test(bien) ? `${bien} (domicile)` : bien}</span>
                    <span className="amt">{(b.homes ?? []).includes(bien) ? `${money(v.charges)} de charges` : `${money(v.loyers)} · ${money(v.charges)} · ${money(v.loyers - v.charges)}`}</span>
                  </li>
                ))}
              </ul>
              <p className="muted small">Sur {periodLabel}. Les loyers sont nets de charges PPE et de gérance. Charges: intérêts hypothécaires, charges PPE, décomptes et travaux.</p>
            </section>
          ) : null}
          {worksByBien.length > 0 ? (
            <section className="tile">
              <h2>Travaux par bien</h2>
              <ul className="cats">
                {worksByBien.map(([bien, total]) => (
                  <li key={bien}>
                    <span className="name">{bien}</span>
                    <span className="amt">{money(total)}</span>
                  </li>
                ))}
              </ul>
              <p className="muted small">Total sur {periodLabel}. Les charges PPE et les intérêts restent dans Immobilier.</p>
            </section>
          ) : null}
        </>
      ) : null}

      {b.excluded.length > 0 ? (
        <section className="tile">
          <h2>Versements uniques non comptés</h2>
          <p className="muted small">Ils ne se répètent pas, donc ils ne gonflent pas ton revenu mensuel. Si l'un d'eux est en réalité régulier, remets-le dans les revenus.</p>
          <ul className="changes">
            {b.excluded.map((u) => (
              <li key={u.key + u.date}>
                <span className="name">{u.label.length > 60 ? `${u.label.slice(0, 60)}…` : u.label} <span className="muted small">{new Date(u.date + 'T00:00:00').toLocaleDateString('fr-CH')}</span></span>
                <span className="amt">{money(u.amount)}</span>
                <button className="btn small" onClick={() => classify(u.key, 'revenu')}>Compter comme revenu</button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="tile">
        <h2>Mes biens</h2>
        <p className="muted small">Dis à quel bien appartient un fournisseur (régie, copropriété, artisan, banque du prêt): ses loyers, charges et travaux sont alors regroupés par bien. Si un même fournisseur change de bien, ajoute une période.</p>
        {rules.length > 0 && !rulesOpen ? (
          <ul className="changes">
            {rules.map((r, i) => (
              <li key={i}><span className="name">{r.bien}{r.home ? ' (domicile)' : ''} <span className="muted small">{r.words}{r.from || r.to ? `, ${r.from || '…'} → ${r.to || '…'}` : ''}</span></span></li>
            ))}
          </ul>
        ) : null}
        {rulesOpen ? (
          <div className="biens-form">
            {rules.map((r, i) => (
              <div className="est-form" key={i}>
                <input value={r.words} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, words: e.target.value } : x)))} placeholder="Mots du libellé, séparés par une virgule" aria-label="Mots du libellé" />
                <input value={r.bien} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, bien: e.target.value } : x)))} placeholder="Nom du bien" aria-label="Nom du bien" />
                <input value={r.from} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} placeholder="Dès (AAAA-MM-JJ)" aria-label="Dès" />
                <input value={r.to} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} placeholder="Jusqu'à" aria-label="Jusqu'à" />
                <label className="small"><input type="checkbox" checked={r.home} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, home: e.target.checked } : x)))} /> Mon domicile</label>
                <button className="btn small" onClick={() => setRules(rules.filter((_, j) => j !== i))}>Retirer</button>
              </div>
            ))}
            <div className="est-form">
              <button className="btn small" onClick={() => setRules([...rules, { words: '', bien: '', home: false, from: '', to: '' }])}>Ajouter un fournisseur</button>
              <button className="btn" onClick={saveRules}>Enregistrer</button>
              <button className="btn small" onClick={() => setRulesOpen(false)}>Annuler</button>
            </div>
          </div>
        ) : (
          <button className="btn small" onClick={() => { if (rules.length === 0) setRules([{ words: '', bien: '', home: false, from: '', to: '' }]); setRulesOpen(true); }}>{rules.length ? 'Modifier' : 'Ajouter un bien'}</button>
        )}
      </section>

      <section className="tile">
        <h2>Dépenses connues hors relevés</h2>
        <p className="muted small">Une carte perdue ou des paiements en espèces: indique ce que tu sais, c'est ajouté chaque mois et marqué comme estimé. Si une ligne réelle correspond dans un relevé, elle prend le dessus.</p>
        {b.estimates.length > 0 ? (
          <ul className="changes">
            {b.estimates.map((x) => (
              <li key={x.id}>
                <span className="name">{x.label} <span className="muted small">({LABEL[x.category] ?? x.category})</span></span>
                <span className="amt">{reveal ? `${x.currency} ${x.amount} ${x.per === 'year' ? 'par an' : 'par mois'}` : '••••'}</span>
                <button className="btn small" onClick={() => removeEst(x.id)} aria-label={`Retirer ${x.label}`}>Retirer</button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="est-form">
          <input value={est.label} onChange={(e) => setEst({ ...est, label: e.target.value })} placeholder="Netflix, Claude, abonnement..." aria-label="Libellé" />
          <input value={est.amount} onChange={(e) => setEst({ ...est, amount: e.target.value })} placeholder="Montant" inputMode="decimal" aria-label="Montant" />
          <select value={est.currency} onChange={(e) => setEst({ ...est, currency: e.target.value })} aria-label="Devise">{['CHF', ...b.currencies.filter((c) => c !== 'CHF')].map((c) => <option key={c}>{c}</option>)}</select>
          <select value={est.per} onChange={(e) => setEst({ ...est, per: e.target.value })} aria-label="Fréquence"><option value="month">par mois</option><option value="year">par an</option></select>
          <select value={est.category} onChange={(e) => setEst({ ...est, category: e.target.value })} aria-label="Catégorie">{CATS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <button className="btn" onClick={addEst} disabled={!est.label.trim() || !est.amount}>Ajouter</button>
        </div>
      </section>

      {b.unknownSamples.length > 0 || b.unknownMinor.count > 0 ? (
        <section className="tile">
          <h2>À identifier</h2>
          <p className="muted small">
            {b.unknown.count} ligne{b.unknown.count > 1 ? 's' : ''}, {money(b.unknown.total)} au total. Ouvre une ligne pour voir les dates et les comptes. Un classement est mémorisé pour les prochains relevés.{' '}
            <button className="link" onClick={classifyAi}>Classer avec Claude</button>
          </p>
          <ul className="unk">
            {b.unknownSamples.map((u) => (
              <li key={u.key}>
                <details>
                  <summary>
                    <span className="name">{u.label.length > 90 ? `${u.label.slice(0, 90)}…` : u.label}</span>
                    <span className="amt">{u.count} fois, {money(u.total)}</span>
                  </summary>
                  <div className="unk-detail">
                    <p className="muted small">Du {new Date(u.first + 'T00:00:00').toLocaleDateString('fr-CH')} au {new Date(u.last + 'T00:00:00').toLocaleDateString('fr-CH')}, compte{u.accounts.length > 1 ? 's' : ''}: {u.accounts.join(', ')}.</p>
                    <ul className="muted small">
                      {u.occurrences.map((o, i) => <li key={i}>{new Date(o.date + 'T00:00:00').toLocaleDateString('fr-CH')}, {o.account}, {money(o.amount)}</li>)}
                    </ul>
                    <div className="unk-actions">
                      <select aria-label={`Classer ${u.label}`} defaultValue="" onChange={(e) => classify(u.key, e.target.value)}>
                        <option value="">Choisir une catégorie</option>
                        {CHOICES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <button className="btn small" onClick={() => classify(u.key, 'autre')}>Je ne sais pas</button>
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
          {b.unknownMinor.count > 0 ? (
            <p className="muted small">
              {b.unknownMinor.count} petite{b.unknownMinor.count > 1 ? 's' : ''} ligne{b.unknownMinor.count > 1 ? 's' : ''} ({money(b.unknownMinor.total)}) de moins de 30 francs par libellé.{' '}
              <button className="link" onClick={async () => { try { setState(await api.post(db, 'budget/minor-other', {})); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } }}>Les ranger dans Autre</button>
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

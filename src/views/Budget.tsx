import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { AlertCircle, ArrowDownRight, ArrowLeft, ArrowUpRight, ChevronRight, FolderOpen, PieChart, TrendingDown, TrendingUp } from 'lucide-react';
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
  const [view, setView] = useState<'home' | 'all' | 'todo'>(full.length > 0 ? 'home' : 'todo');
  const [sel, setSel] = useState('');
  const years = useMemo(() => [...new Set(full.filter((m) => m.spend > 0).map((m) => m.month.slice(0, 4)))].filter((y) => full.filter((m) => m.month.startsWith(y) && m.spend > 0).length >= 3).sort().reverse(), [full]);
  const isMonth = /^\d{4}-\d{2}$/.test(period);
  const yearOk = period === '12' || isMonth || years.includes(period);
  const used = isMonth ? full.filter((m) => m.month === period) : period === '12' || !yearOk ? full.slice(-12) : full.filter((m) => m.month.startsWith(period));
  // Comparaison à période égale: mêmes mois un an plus tôt, ou les 12 mois précédents. Jamais une année entière contre une année entamée.
  const prevYear = (() => {
    if (period === '12' || !yearOk) return full.length >= 24 ? full.slice(-24, -12) : [];
    const y = String(Number(period.slice(0, 4)) - 1);
    const months = new Set(used.map((m) => m.month.slice(5)));
    const p = full.filter((m) => m.month.startsWith(y) && months.has(m.month.slice(5)));
    return p.length === used.length ? p : [];
  })();
  const prevLabel = period === '12' || !yearOk ? 'aux 12 mois précédents' : `à la même période en ${Number(period.slice(0, 4)) - 1}`;
  const curYear = last ? last.month.slice(0, 4) : '';
  const yearName = (y: string) => (y === curYear && last && last.month.slice(5) !== '12' ? `${y} à ce jour` : y);
  const periodLabel = isMonth ? monthName(period) : period === '12' || !yearOk ? `${used.length} derniers mois` : yearName(period);
  // Une dépense payée une année mais qui appartient à une autre (solde d'impôts) suit son année dans la vue par année.
  const adj = useMemo(() => {
    const byCat: Record<string, number> = {};
    let total = 0;
    if (period !== '12' && !isMonth && yearOk) {
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

  const cats = useMemo(() => {
    const keys = [...new Set([...used.flatMap((m) => Object.keys(m.byCategory)), ...Object.keys(adj.byCat)])];
    const mean = (ms: typeof used, k: string) => (ms.length ? ms.reduce((t, m) => t + (m.byCategory[k] ?? 0), 0) / ms.length : 0);
    return keys
      .map((k) => {
        const avg = mean(used, k) + (used.length ? (adj.byCat[k] ?? 0) / used.length : 0);
        const prevAvg = prevYear.length > 0 ? mean(prevYear, k) : null;
        const trend = prevAvg !== null && prevAvg > 20 ? avg / prevAvg - 1 : null;
        return { key: k, avg, total: avg * used.length, prevAvg, trend };
      })
      .filter((c) => c.avg > 0)
      .sort((p, q) => q.avg - p.avg);
  }, [used, prevYear, adj]);

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
  const [catView, setCatView] = useState<'moy' | 'total'>('moy');
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

  const todo = b.unknown.count + b.excluded.length;
  const reste = avgIncome - avgSpend;
  const topCats = cats.slice(0, 5);
  const periodSelect = (
    <select className="periodsel" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Période">
      <option value="12">12 derniers mois</option>
      {years.map((y) => <option key={y} value={y}>{yearName(y)}</option>)}
      <optgroup label="Mois">
        {full.slice(-12).reverse().map((m) => <option key={m.month} value={m.month}>{monthName(m.month)}</option>)}
      </optgroup>
    </select>
  );
  const rec = state.recurring;
  const [tab, setTab] = useState<'revient' | 'quotidien' | 'exceptionnel' | 'evolution' | 'immo'>('revient');
  const [more, setMore] = useState(false);
  const monthsN = Math.max(rec.months.length, 1);
  const spendYear = rec.totals.recurring + rec.totals.daily + rec.totals.exceptional;
  const resteM = (rec.income - spendYear) / monthsN;
  const barMax = Math.max(rec.income, spendYear, 1);
  const parts: { k: typeof tab; label: string; v: number; color: string }[] = [
    { k: 'revient', label: 'Ce qui revient', v: rec.totals.recurring, color: '#534AB7' },
    { k: 'quotidien', label: 'Le quotidien', v: rec.totals.daily, color: '#0F6E56' },
    { k: 'exceptionnel', label: 'Exceptionnel', v: rec.totals.exceptional, color: '#b7791f' },
  ];
  const pct = (t: number | null) => (t === null ? '' : `${t > 0 ? '+' : ''}${Math.round(t * 100)} %`);
  const Trend = ({ t, d }: { t: number | null; d: number | null }) => (t !== null && d !== null && Math.abs(t) >= 0.1 && Math.abs(d) >= 100 ? <span className={'chip ' + (t > 0 ? 'up' : 'down')} title={`Par rapport aux mêmes mois un an plus tôt (${rec.comparedMonths} mois)`}>{pct(t)}</span> : null);
  const cut = (n: number) => (more ? n : 8);
  const moving = [...rec.recurring, ...rec.merchants.map((m) => ({ ...m, perYear: m.total }))]
    .filter((x) => x.trend !== null && x.delta !== null && Math.abs(x.trend) >= 0.1 && Math.abs(x.delta) >= 150)
    .sort((p, q) => Math.abs((q.delta ?? 0)) - Math.abs((p.delta ?? 0)))
    .slice(0, 10);
  const levers = rec.recurring.filter((x) => x.lever).slice(0, 6);
  const dateFr = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const bienNames = [...new Set([...immoRows.map(([k]) => k), ...worksByBien.map(([k]) => k)])];
  const maxCat = Math.max(1, ...cats.map((c) => (catView === 'total' ? c.total : c.avg)));

  return (
    <div className="page wide budget">
      <div className="topbar">
        {view === 'home' && last ? <span className="muted small">12 derniers mois</span> : <button className="iconbtn" onClick={() => setView('home')} aria-label="Retour"><ArrowLeft size={18} strokeWidth={1.6} /></button>}
        {view === 'home' && last ? <button className="iconbtn" onClick={() => setView('todo')} aria-label="Documents et points à traiter" title="Documents et points à traiter"><FolderOpen size={18} strokeWidth={1.6} />{todo > 0 ? <i className="badge">{todo}</i> : null}</button> : <span className="muted small">{view === 'all' ? '' : 'Documents'}</span>}
      </div>

      {view === 'home' && last ? (
        <>
          <section className="hero">
            <p className="unit">Reste par mois</p>
            <p className={'big xl' + (resteM < 0 ? ' neg' : '')}>{money(resteM)}</p>
            <p className="unit">entrées {money(rec.income / monthsN)} · sorties {money(spendYear / monthsN)}</p>
          </section>
          <div className="stackbar" role="group" aria-label="Répartition des sorties">
            {parts.map((x) => <button key={x.k} className={tab === x.k ? 'on' : ''} style={{ flex: Math.max(x.v, 1) / barMax, background: x.color }} aria-label={x.label} onClick={() => { setTab(x.k); setMore(false); }} />)}
            {resteM > 0 ? <i className="free" style={{ flex: (resteM * monthsN) / barMax }} /> : null}
          </div>
          <div className="seg wide" role="tablist" aria-label="Rubriques">
            {([['revient', 'Revient'], ['quotidien', 'Quotidien'], ['exceptionnel', 'Exceptionnel'], ['evolution', 'Évolution'], ['immo', 'Immobilier']] as [typeof tab, string][]).map(([k, l]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setMore(false); }}>{l}</button>
            ))}
          </div>

          {tab === 'revient' ? (
            <section>
              <p className="sub">{money(rec.totals.recurring / monthsN)} par mois, {money(rec.totals.recurring)} par an. Ce que tu paies même en ne faisant rien.</p>
              <ul className="rows">
                {rec.recurring.slice(0, cut(rec.recurring.length)).map((x) => (
                  <li key={x.key}>
                    <span className="n">{x.label}<small>{LABEL[x.category] ?? x.category} · {x.cadence}{x.bien ? ` · ${x.bien}` : ''}{x.lever ? ' · à comparer' : ''}</small></span>
                    <Trend t={x.trend} d={x.delta} />
                    <span className="v">{money(x.perYear)}<small>par an</small></span>
                  </li>
                ))}
              </ul>
              {rec.comparedMonths > 0 ? <p className="muted small">Les pourcentages comparent les {rec.comparedMonths} derniers mois aux mêmes mois un an plus tôt.</p> : null}
              {rec.recurring.length > 8 ? <button className="morelink" onClick={() => setMore(!more)}>{more ? 'Réduire' : `Voir les ${rec.recurring.length - 8} autres`}</button> : null}
            </section>
          ) : null}

          {tab === 'quotidien' ? (
            <section>
              <p className="sub">{money(rec.totals.daily / monthsN)} par mois chez les commerçants. Les plus gros d’abord.</p>
              <ul className="rows">
                {rec.merchants.slice(0, cut(rec.merchants.length)).map((x) => (
                  <li key={x.key}>
                    <span className="n">{x.label}<small>{LABEL[x.category] ?? x.category} · {x.count} paiements</small></span>
                    <Trend t={x.trend} d={x.delta} />
                    <span className="v">{money(x.total)}<small>par an</small></span>
                  </li>
                ))}
              </ul>
              {rec.comparedMonths > 0 ? <p className="muted small">Les pourcentages comparent les {rec.comparedMonths} derniers mois aux mêmes mois un an plus tôt.</p> : null}
              {rec.merchants.length > 8 ? <button className="morelink" onClick={() => setMore(!more)}>{more ? 'Réduire' : `Voir les ${rec.merchants.length - 8} autres`}</button> : null}
            </section>
          ) : null}

          {tab === 'exceptionnel' ? (
            <section>
              <p className="sub">{money(rec.totals.exceptional)} sur l’année: impôts, travaux et grosses dépenses ponctuelles.</p>
              <ul className="rows">
                {rec.oneOffs.slice(0, cut(rec.oneOffs.length)).map((x, i) => (
                  <li key={i}>
                    <span className="n">{/^(paiement|d[ée]bit|ordre|transfert|virement|retrait)/i.test(x.label) ? (LABEL[x.category] ?? x.label) : x.label}<small>{dateFr(x.date)} · {LABEL[x.category] ?? x.category}{x.bien ? ` · ${x.bien}` : ''}</small></span>
                    <span className="v">{money(x.amount)}</span>
                  </li>
                ))}
              </ul>
              {rec.oneOffs.length > 8 ? <button className="morelink" onClick={() => setMore(!more)}>{more ? 'Réduire' : `Voir les ${rec.oneOffs.length - 8} autres`}</button> : null}
            </section>
          ) : null}

          {tab === 'evolution' ? (
            <section>
              <p className="sub">{rec.comparedMonths > 0 ? `Les ${rec.comparedMonths} derniers mois comparés aux mêmes mois un an plus tôt, fournisseur par fournisseur. L’écart est ramené à l’année.` : 'Les relevés ne remontent pas assez loin pour comparer à l’année précédente.'}</p>
              {rec.categories.length > 0 ? (
                <>
                  <h3 className="subtitle">Par domaine</h3>
                  <ul className="rows">
                    {rec.categories.slice(0, 6).map((c) => (
                      <li key={c.category}>
                        <span className="n">{LABEL[c.category] ?? c.category}</span>
                        <span className={'chip ' + (c.trend > 0 ? 'up' : 'down')}>{pct(c.trend)}</span>
                        <span className="v">{c.delta > 0 ? '+' : ''}{money(c.delta)}<small>par an</small></span>
                      </li>
                    ))}
                  </ul>
                  <h3 className="subtitle">Par fournisseur</h3>
                </>
              ) : null}
              {moving.length > 0 ? (
                <ul className="rows">
                  {moving.map((x) => (
                    <li key={x.key}>
                      <span className="n">{x.label}<small>{LABEL[x.category] ?? x.category}</small></span>
                      <span className={'chip ' + ((x.trend ?? 0) > 0 ? 'up' : 'down')}>{pct(x.trend)}</span>
                      <span className="v">{(x.delta ?? 0) > 0 ? '+' : ''}{money(x.delta ?? 0)}<small>par an</small></span>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted small">Pas assez d’historique pour comparer: il faut deux ans de relevés.</p>}
              {levers.length > 0 ? (
                <>
                  <h3 className="subtitle">À comparer ou renégocier</h3>
                  <ul className="rows">
                    {levers.map((x) => (
                      <li key={x.key}>
                        <span className="n">{x.label}<small>{LABEL[x.category] ?? x.category} · {x.cadence}</small></span>
                        <span className="v">{money(x.perYear)}<small>par an</small></span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </section>
          ) : null}

          {tab === 'immo' ? (
            <section>
              <div className="biens">
                {bienNames.map((bien) => {
                  const v = Object.fromEntries(immoRows)[bien] ?? { loyers: 0, charges: 0 };
                  const home = (b.homes ?? []).includes(bien);
                  const works = Object.fromEntries(worksByBien)[bien] ?? 0;
                  return (
                    <div className="bien" key={bien}>
                      <div className="bn">{bien}{home && !/domicile/i.test(bien) ? ' · domicile' : ''}</div>
                      <div className="bf">
                        {home ? <div><span>Charges</span><b>{money(v.charges)}</b></div> : (
                          <>
                            <div><span>Loyers</span><b>{money(v.loyers)}</b></div>
                            <div><span>Charges</span><b>{money(v.charges)}</b></div>
                            <div><span>Net</span><b>{money(v.loyers - v.charges)}</b></div>
                          </>
                        )}
                        {works > 0 ? <div><span>dont travaux</span><b>{money(works)}</b></div> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              {bienNames.length === 0 ? <p className="muted small">Ajoute tes biens dans Documents, « Mes biens ».</p> : null}
            </section>
          ) : null}
        </>
      ) : null}

      {view === 'todo' || !last ? (
        <>
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
      <section className="tile">
        <h2>Mes biens</h2>
        <p className="muted small">Dis à quel bien appartient un fournisseur (régie, copropriété, artisan, banque du prêt): ses loyers, charges et travaux sont alors regroupés par bien. Si un même fournisseur change de bien, ajoute une période.</p>
        {rules.length > 0 && !rulesOpen ? (
          <ul className="changes">
            {rules.map((r, i) => (
              <li key={i}><span className="name">{r.bien}{r.home && !/domicile/i.test(r.bien) ? ' (domicile)' : ''} <span className="muted small">{r.words}{r.from || r.to ? `, ${r.from || '…'} → ${r.to || '…'}` : ''}</span></span></li>
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
        </>
      ) : null}
    </div>
  );
}

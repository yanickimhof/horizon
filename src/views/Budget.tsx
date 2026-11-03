import { useEffect, useMemo, useState, type MouseEvent, type ReactElement } from 'react';
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Building2, FolderOpen, Home, Landmark, LayoutGrid, Repeat, ShoppingBasket, TrendingUp, Wallet, Zap } from 'lucide-react';
import { api, fmt, type Db, type RecurringView, type State, type WatchStatus } from '../api';
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
  const rangeM = period.match(/^(\d{4}-\d{2})\.\.(\d{4}-\d{2})$/);
  const yearOk = period === '12' || isMonth || !!rangeM || years.includes(period);
  const used = rangeM ? full.filter((m) => m.month >= rangeM[1] && m.month <= rangeM[2]) : isMonth ? full.filter((m) => m.month === period) : period === '12' || !yearOk ? full.slice(-12) : full.filter((m) => m.month.startsWith(period));
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
  const periodLabel = rangeM ? `${monthName(rangeM[1])} à ${monthName(rangeM[2])}` : isMonth ? monthName(period) : period === '12' || !yearOk ? `${used.length} derniers mois` : yearName(period);
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
  const [recAlt, setRecAlt] = useState<RecurringView | null>(null);
  useEffect(() => {
    if (period === '12') {
      setRecAlt(null);
      return;
    }
    let live = true;
    api.recurring(db, period).then((r) => { if (live) setRecAlt(r); }).catch(() => { if (live) setRecAlt(null); });
    return () => { live = false; };
  }, [period, db, state.budget.count]);
  const rec = period === '12' || !recAlt ? state.recurring : recAlt;
  const [open, setOpen] = useState('');
  const [tab, setTab] = useState<'synthese' | 'revient' | 'quotidien' | 'exceptionnel' | 'immo'>('synthese');
  const [more, setMore] = useState(false);
  const monthsN = Math.max(rec.months.length, 1);
  const bienNames = [...new Set([...immoRows.map(([k]) => k), ...worksByBien.map(([k]) => k), ...rec.works.map((w) => w.bien ?? 'À rattacher')])];
  const monthShort = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('fr-CH', { month: 'short' }).replace('.', '');
  const priorLabel = (() => {
    const pm = rec.priorMonths;
    if (pm.length === 0) return '';
    const a = pm[0];
    const z = pm[pm.length - 1];
    if (a === z) return `${monthShort(a)} ${a.slice(0, 4)}`;
    return a.slice(0, 4) === z.slice(0, 4) ? `${monthShort(a)} à ${monthShort(z)} ${z.slice(0, 4)}` : `${monthShort(a)} ${a.slice(0, 4)} à ${monthShort(z)} ${z.slice(0, 4)}`;
  })();
  const spendYear = rec.totals.recurring + rec.totals.daily + rec.totals.exceptional + rec.totals.works;
  const resteM = (rec.income - spendYear) / monthsN;
  const barMax = Math.max(rec.income, spendYear, 1);
  const parts: { k: typeof tab; label: string; v: number; color: string }[] = [
    { k: 'revient', label: 'Ce qui revient', v: rec.totals.recurring, color: '#534AB7' },
    { k: 'quotidien', label: 'Le quotidien', v: rec.totals.daily, color: '#0F6E56' },
    { k: 'exceptionnel', label: 'Exceptionnel', v: rec.totals.exceptional, color: '#b7791f' },
    { k: 'immo', label: 'Travaux et frais des biens', v: rec.totals.works, color: '#8a8a85' },
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
  const [fix, setFix] = useState<{ id: string; name: string; category: string } | null>(null);
  const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tooGeneral = (t: string) => t.length < 4 || /^(paiement|d[ée]bit|cr[ée]dit|transfert|virement|ordre|retrait|achat|e-banking)\b/i.test(t);
  const saveFix = async (seed: string) => {
    if (!fix || !fix.name.trim()) return;
    try {
      setState(await api.post(db, 'budget/fournisseurs', { rules: [...state.fournisseurs.filter((r) => r.re !== escapeRe(seed)), { re: escapeRe(seed), name: fix.name.trim(), ...(fix.category ? { category: fix.category } : {}) }] }));
      setFix(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const removeFournisseur = async (re: string) => {
    try {
      setState(await api.post(db, 'budget/fournisseurs', { rules: state.fournisseurs.filter((r) => r.re !== re) }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const pctPlain = (x: number) => `${(Math.round(x * 1000) / 10).toString().replace('.', ',')} %`;
  const nrm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const factsAssets = state.facts.filter((f) => f.key.startsWith('asset:') && f.data.class === 'real_estate');
  const factsDebts = state.facts.filter((f) => f.key.startsWith('liability:') && typeof f.data.balance === 'number');
  const factor = 12 / Math.max(used.length, 1);
  type Prop = { bien: string; home: boolean; commune: string; valeur: number | null; dette: number; taux: number | null; loyers: number; charges: number; interets: number; travaux: number; autres: number; rend: number | null; cash: number; ltv: number | null; items: { n: string; v: number }[] };
  const props: Prop[] = bienNames.map((bien) => {
    const v = Object.fromEntries(immoRows)[bien] ?? { loyers: 0, charges: 0 };
    const asset = factsAssets.find((f) => nrm(String(f.data.label ?? '')).includes(nrm(bien)));
    const debts = asset ? factsDebts.filter((d) => d.data.securedBy === asset.key) : [];
    const dette = debts.reduce((t, d) => t + Number(d.data.balance), 0);
    const taux = dette > 0 ? debts.reduce((t, d) => t + Number(d.data.balance) * Number(d.data.rate ?? 0), 0) / dette : null;
    const valeur = asset && typeof asset.data.value === 'number' ? Number(asset.data.value) : null;
    const home = (b.homes ?? []).includes(bien) || asset?.data.subtype === 'home';
    const items = rec.recurring.filter((x) => x.bien === bien);
    const interets = items.filter((x) => /^int[ée]r[êe]ts/i.test(x.label)).reduce((t, x) => t + x.perYear, 0);
    const travaux = rec.works.filter((w) => (w.bien ?? 'À rattacher') === bien).reduce((t, w) => t + w.amount, 0);
    const autres = Math.max(0, v.charges - interets - travaux);
    const noi = (v.loyers - autres) * factor;
    return {
      bien, home, commune: String(asset?.data.commune ?? ''), valeur, dette, taux, loyers: v.loyers, charges: v.charges, interets, travaux, autres,
      rend: valeur && !home ? noi / valeur : null,
      cash: (v.loyers - v.charges) / Math.max(used.length, 1),
      ltv: valeur && dette > 0 ? dette / valeur : null,
      items: [...items.map((x) => ({ n: x.label, v: x.perYear })), ...rec.works.filter((w) => (w.bien ?? 'À rattacher') === bien).map((w) => ({ n: `${w.label}, ${dateFr(w.date)}`, v: w.amount }))],
    };
  });
  const homeProps = props.filter((p) => p.home);
  const invProps = props.filter((p) => !p.home);
  const invSummary = (() => {
    const withVal = invProps.filter((p) => p.valeur);
    if (invProps.length === 0) return null;
    const val = withVal.reduce((t, p) => t + (p.valeur ?? 0), 0);
    const noi = withVal.reduce((t, p) => t + (p.rend ?? 0) * (p.valeur ?? 0), 0);
    const debt = withVal.reduce((t, p) => t + p.dette, 0);
    const rend = val > 0 ? noi / val : null;
    const cash = invProps.reduce((t, p) => t + p.cash, 0);
    const ltv = val > 0 && debt > 0 ? debt / val : null;
    const tone = { r: rend === null ? '' : rend >= 0.03 ? 'ok' : rend >= 0.02 ? 'mid' : 'bad', c: cash >= 0 ? 'ok' : 'bad', l: ltv === null ? '' : ltv <= 0.6 ? 'ok' : ltv <= 0.75 ? 'mid' : 'bad' };
    return { rend, cash, ltv, tone };
  })();
  const renderProp = (p: Prop) => {
    const tr = p.rend === null ? '' : p.rend >= 0.03 ? 'ok' : p.rend >= 0.02 ? 'mid' : 'bad';
    const tl2 = p.ltv === null ? '' : p.ltv <= 0.6 ? 'ok' : p.ltv <= 0.75 ? 'mid' : 'bad';
    const monthlyCost = (p.charges) / Math.max(used.length, 1);
    return (
      <details key={p.bien} className="prop">
        <summary>
          <span className="pn">{p.bien}{p.commune ? <small>{p.commune}</small> : null}</span>
          {p.home ? (
            <span className="inds">
              <span className="ind"><Home size={16} strokeWidth={1.6} /><b>{money(monthlyCost)}</b><small>par mois</small></span>
              <span className={'ind ' + tl2}><Landmark size={16} strokeWidth={1.6} /><b>{p.ltv !== null ? pctPlain(p.ltv) : '—'}</b><small>de dette</small></span>
            </span>
          ) : (
            <span className="inds">
              <span className={'ind ' + tr}><TrendingUp size={16} strokeWidth={1.6} /><b>{p.rend !== null ? pctPlain(p.rend) : '—'}</b><small>rendement</small></span>
              <span className={'ind ' + (p.cash >= 0 ? 'ok' : 'bad')}><Wallet size={16} strokeWidth={1.6} /><b>{money(p.cash)}</b><small>par mois</small></span>
              <span className={'ind ' + tl2}><Landmark size={16} strokeWidth={1.6} /><b>{p.ltv !== null ? pctPlain(p.ltv) : '—'}</b><small>de dette</small></span>
            </span>
          )}
        </summary>
        <ul className="mini">
          {!p.home ? <li><span>Loyers reçus</span><b>{money(p.loyers)}</b></li> : null}
          {p.items.map((it, i) => <li key={i}><span>{it.n}</span><b>{money(it.v)}</b></li>)}
          {!p.home ? <li className="net"><span>Net</span><b>{money(p.loyers - p.charges)}</b></li> : null}
          {p.valeur ? <li className="sep"><span>Valeur estimée</span><b>{money(p.valeur)}</b></li> : null}
          {p.dette > 0 ? <li><span>Hypothèque{p.taux !== null ? `, taux moyen ${pctPlain(p.taux)}` : ''}</span><b>{money(p.dette)}</b></li> : null}
        </ul>
        {(() => {
          const dec = state.decomptes.find((d) => d.bien === p.bien);
          return dec ? (
            <div className="decompte">
              <p className="muted small">Décompte de copropriété {dateFr(dec.from)} au {dateFr(dec.to)}: charges {money(dec.total)}{dec.paid > dec.total ? `, versé ${money(dec.paid)}` : ''}{dec.solde !== null ? (dec.solde < 0 ? `, à payer ${money(Math.abs(dec.solde))}` : dec.settled ? `, solde de ${money(dec.solde)} déduit le ${dateFr(dec.settled)}` : `, à recevoir ${money(dec.solde)}`) : ''}.</p>
              <ul className="mini sm">{dec.lines.map((ln, i) => <li key={i}><span>{ln.label}</span><b>{money(ln.amount)}</b></li>)}</ul>
            </div>
          ) : null;
        })()}
      </details>
    );
  };
  const tl = full.slice(-24);
  const tlMax = Math.max(1, ...tl.flatMap((m) => [m.spend, m.income]));
  const selMonths = new Set(rec.months);
  const [anchor, setAnchor] = useState('');
  const pickMonth = (e: MouseEvent, m: string) => {
    if (e.shiftKey && anchor && anchor !== m) {
      const [a, z] = anchor < m ? [anchor, m] : [m, anchor];
      setPeriod(`${a}..${z}`);
    } else if (period === m) {
      setPeriod('12');
    } else {
      setPeriod(m);
      setAnchor(m);
    }
    setOpen('');
    setMore(false);
  };
  const timeline = (
    <div className="timeline">
      <div className="tlbars" role="group" aria-label="Choisir une période">
        {tl.map((m) => (
          <button key={m.month} className={selMonths.has(m.month) ? 'on' : ''} onClick={(e) => pickMonth(e, m.month)} title={`${monthName(m.month)}: gains ${money(m.income)}, dépenses ${money(m.spend)}`} aria-label={monthName(m.month)} aria-pressed={selMonths.has(m.month)}>
            <i className="gain" style={{ height: `${Math.max(4, (m.income / tlMax) * 100)}%` }} /><i className="dep" style={{ height: `${Math.max(4, (m.spend / tlMax) * 100)}%` }} />
          </button>
        ))}
      </div>
      <div className="tlyears">
        {tl.map((m, i) => (
          <span key={m.month}>{m.month.slice(5) === '01' || i === 0 ? <button onClick={() => { setPeriod(m.month.slice(0, 4)); setOpen(''); setMore(false); }}>{m.month.slice(0, 4)}</button> : null}</span>
        ))}
      </div>
      <div className="tllabel">
        <button className={period === '12' ? 'on' : ''} onClick={() => { setPeriod('12'); setOpen(''); setMore(false); }}>12 mois</button>
        <span>{periodLabel}</span>
      </div>
      <p className="tlcap"><span><b style={{ background: '#5aa877' }} />Gains</span><span><b style={{ background: '#534AB7' }} />Dépenses</span></p>
      <p className="tlcmp">{rec.comparedMonths > 0 ? `Les ↑ ↓ comparent à la même période: ${priorLabel}.` : 'Pas de comparaison: les relevés ne remontent pas assez loin.'}</p>
    </div>
  );
  const Cmp = ({ now, before, goodUp = false }: { now: number; before: number | null; goodUp?: boolean }) => {
    if (before === null || before <= 0) return <p className="cmpline">Pas de comparaison possible</p>;
    const t = now / before - 1;
    if (Math.abs(t) < 0.02) return <p className="cmpline">Stable · {money(before)} en {priorLabel}</p>;
    const good = goodUp ? t > 0 : t < 0;
    return <p className={'cmpline ' + (good ? 'down' : 'up')}>{t > 0 ? '↑' : '↓'} {pct(t)} · {money(before)} en {priorLabel}</p>;
  };
  type Item = { id: string; name: string; amount: number; cat: string; prior?: number | null; trend?: number | null; delta?: number | null; facts: string[]; lines: { date: string; amount: number; account: string; text: string }[] };
  const [sortBy, setSortBy] = useState<'montant' | 'nom'>('montant');
  const [groupBy, setGroupBy] = useState<Record<string, boolean>>({ exceptionnel: true });
  const [openGroup, setOpenGroup] = useState('');
  const note = (it: Item) => (it.trend !== null && it.trend !== undefined && it.delta !== null && it.delta !== undefined && it.prior !== null && it.prior !== undefined && Math.abs(it.trend) >= 0.1 && Math.abs(it.delta) >= 100 ? { text: `${it.trend > 0 ? '↑' : '↓'} ${pct(it.trend)} · ${money(it.prior)} en ${priorLabel}`, tone: it.trend > 0 ? 'up' : 'down' } : null);
  const renderRow = (it: Item) => {
    const n = note(it);
    return (
      <li key={it.id} className={open === it.id ? 'open' : ''}>
        <button className="rowbtn" onClick={() => setOpen(open === it.id ? '' : it.id)} aria-expanded={open === it.id}>
          <span className="n">{it.name}{n ? <small className={'chg ' + n.tone}>{n.text}</small> : null}</span>
          <span className="v">{money(it.amount)}</span>
        </button>
        {open === it.id ? (
          <div className="detail">
            <p className="facts">{it.facts.filter(Boolean).join(' · ')}</p>
            {(() => {
              const seed = (it.lines[0]?.text ?? '').split(',')[0].trim();
              if (!seed || tooGeneral(seed)) return null;
              return fix?.id === it.id ? (
                <div className="fixform">
                  <input value={fix.name} onChange={(e) => setFix({ ...fix, name: e.target.value })} aria-label="Nom" placeholder="Nom du fournisseur" />
                  <select value={fix.category} onChange={(e) => setFix({ ...fix, category: e.target.value })} aria-label="Catégorie">
                    <option value="">Garder la catégorie</option>
                    {CATS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <button className="btn" onClick={() => saveFix(seed)}>Enregistrer</button>
                  <button className="btn small" onClick={() => setFix(null)}>Annuler</button>
                </div>
              ) : (
                <button className="link" onClick={() => setFix({ id: it.id, name: it.name, category: '' })}>Corriger le nom ou la catégorie</button>
              );
            })()}
            <ul>
              {it.lines.map((ln, i) => <li key={i}><span>{dateFr(ln.date)}</span><span className="t">{ln.text}</span><b>{money(ln.amount)}</b></li>)}
            </ul>
          </div>
        ) : null}
      </li>
    );
  };
  const sorter = (a: { name: string; amount: number }, b: { name: string; amount: number }) => (sortBy === 'nom' ? a.name.localeCompare(b.name, 'fr') : b.amount - a.amount);
  const renderList = (tabKey: string, items: Item[]) => {
    const grouped = !!groupBy[tabKey];
    const sorted = [...items].sort(sorter);
    const shown = more ? sorted : sorted.slice(0, 8);
    const groups = grouped ? Object.entries(items.reduce<Record<string, Item[]>>((t, x) => ({ ...t, [x.cat]: [...(t[x.cat] ?? []), x] }), {})).map(([cat, list]) => ({ cat, name: LABEL[cat] ?? cat, amount: list.reduce((t, x) => t + x.amount, 0), list: [...list].sort(sorter) })).sort(sorter) : [];
    return (
      <>
        <div className="listtools">
          <div className="seg" role="group" aria-label="Tri">
            <button className={sortBy === 'montant' ? 'on' : ''} onClick={() => setSortBy('montant')}>Montant</button>
            <button className={sortBy === 'nom' ? 'on' : ''} onClick={() => setSortBy('nom')}>A–Z</button>
          </div>
          <div className="seg" role="group" aria-label="Regroupement">
            <button className={!grouped ? 'on' : ''} onClick={() => setGroupBy({ ...groupBy, [tabKey]: false })}>Liste</button>
            <button className={grouped ? 'on' : ''} onClick={() => setGroupBy({ ...groupBy, [tabKey]: true })}>Par catégorie</button>
          </div>
        </div>
        {grouped ? (
          <ul className="rows">
            {groups.map((g) => (
              <li key={g.cat} className={openGroup === tabKey + g.cat ? 'open' : ''}>
                <button className="rowbtn" onClick={() => setOpenGroup(openGroup === tabKey + g.cat ? '' : tabKey + g.cat)} aria-expanded={openGroup === tabKey + g.cat}>
                  <span className="n">{g.name}<small>{plural(g.list.length, 'ligne')}</small></span>
                  <span className="v">{money(g.amount)}</span>
                </button>
                {openGroup === tabKey + g.cat ? <ul className="rows sub">{g.list.map((it) => renderRow(it))}</ul> : null}
              </li>
            ))}
          </ul>
        ) : (
          <>
            <ul className="rows">{shown.map((it) => renderRow(it))}</ul>
            {items.length > 8 ? <button className="morelink" onClick={() => setMore(!more)}>{more ? 'Réduire' : `Voir les ${items.length - 8} autres`}</button> : null}
          </>
        )}
      </>
    );
  };
  const maxCat = Math.max(1, ...cats.map((c) => (catView === 'total' ? c.total : c.avg)));

  return (
    <div className="page wide budget">
      <div className="topbar">
        {view === 'home' && last ? <span /> : <button className="iconbtn" onClick={() => setView('home')} aria-label="Retour"><ArrowLeft size={18} strokeWidth={1.6} /></button>}
        {view === 'home' && last ? <button className="iconbtn" onClick={() => setView('todo')} aria-label="Documents et points à traiter" title="Documents et points à traiter"><FolderOpen size={18} strokeWidth={1.6} />{todo > 0 ? <i className="badge">{todo}</i> : null}</button> : <span className="muted small">{view === 'all' ? '' : 'Documents'}</span>}
      </div>

      {view === 'home' && last ? (
        <>
          {timeline}
          <div className="tabs" role="tablist" aria-label="Rubriques">
            {([['synthese', 'Synthèse', <LayoutGrid key="s" size={20} strokeWidth={1.5} />], ['revient', 'Revient', <Repeat key="a" size={20} strokeWidth={1.5} />], ['quotidien', 'Quotidien', <ShoppingBasket key="b" size={20} strokeWidth={1.5} />], ['exceptionnel', 'Exceptionnel', <Zap key="c" size={20} strokeWidth={1.5} />], ['immo', 'Immobilier', <Building2 key="e" size={20} strokeWidth={1.5} />]] as [typeof tab, string, ReactElement][]).map(([k, l, ic]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setMore(false); setOpen(''); }}>{ic}<span>{l}</span></button>
            ))}
          </div>

          {tab === 'revient' ? renderList('revient', rec.recurring.map((x) => ({ id: x.key, name: x.label, amount: x.perYear, cat: x.category, prior: x.prior, trend: x.trend, delta: x.delta, facts: [LABEL[x.category] ?? x.category, x.cadence, x.bien ?? '', x.lever ? 'à comparer' : '', plural(x.count, 'paiement')], lines: x.lines }))) : null}
          {tab === 'quotidien' ? renderList('quotidien', rec.merchants.map((x) => ({ id: x.key, name: x.label, amount: x.total, cat: x.category, prior: x.prior, trend: x.trend, delta: x.delta, facts: [LABEL[x.category] ?? x.category, plural(x.count, 'paiement')], lines: x.lines }))) : null}
          {tab === 'exceptionnel' ? renderList('exceptionnel', rec.oneOffs.map((x, i) => ({ id: `o${i}`, name: /^(paiement|d[ée]bit|ordre|transfert|virement|retrait)/i.test(x.label) ? (LABEL[x.category] ?? x.label) : x.label, amount: x.amount, cat: x.category, facts: [dateFr(x.date), LABEL[x.category] ?? x.category], lines: [{ date: x.date, amount: x.amount, account: '', text: x.text }] }))) : null}

          {tab === 'synthese' ? (
            <section>
              <div className="duo">
                <div className="side">
                  <p className="lbl">Gains</p>
                  <p className="amt">{money(rec.income)}</p>
                  <Cmp now={rec.income} before={rec.compare.income} goodUp />
                  <ul className="split">
                    {rec.incomeBy.map((x) => (
                      <li key={x.label}><span>{x.label}</span><b>{money(x.amount)}</b><i style={{ width: `${rec.income > 0 ? Math.min(100, (x.amount / rec.income) * 100) : 0}%`, background: '#2f7d4f' }} /></li>
                    ))}
                  </ul>
                  {rec.incomeOnce > 0 ? <p className="muted small">Hors habituel, non compté: {money(rec.incomeOnce)}</p> : null}
                </div>
                <div className="side">
                  <p className="lbl">Dépenses</p>
                  <p className="amt">{money(spendYear)}</p>
                  <Cmp now={spendYear} before={rec.compare.spend} />
                  <ul className="split">
                    {parts.map((x) => (
                      <li key={x.k}><button onClick={() => { setTab(x.k); setMore(false); setOpen(''); }}><span>{x.label}</span><b>{money(x.v)}</b></button><i style={{ width: `${spendYear > 0 ? Math.min(100, (x.v / spendYear) * 100) : 0}%`, background: x.color }} /></li>
                    ))}
                  </ul>
                </div>
              </div>
              {moving.length > 0 || rec.categories.length > 0 ? (
                <>
                  <h3 className="subtitle">Ce qui a changé</h3>
                  <ul className="rows">
                    {rec.categories.slice(0, 3).map((c) => (
                      <li key={c.category} className="plain">
                        <span className="n">{LABEL[c.category] ?? c.category}<small>{money(c.prior)} en {priorLabel} → {money(c.perYear)}</small></span>
                        <span className={'delta ' + (c.delta > 0 ? 'up' : 'down')}>{c.delta > 0 ? '+' : ''}{money(c.delta)}</span>
                      </li>
                    ))}
                    {moving.slice(0, 4).map((x) => (
                      <li key={x.key} className="plain">
                        <span className="n">{x.label}<small>{x.prior !== null && x.prior !== undefined ? `${money(x.prior)} en ${priorLabel} → ${money(x.perYear)}` : ''}</small></span>
                        <span className={'delta ' + ((x.delta ?? 0) > 0 ? 'up' : 'down')}>{(x.delta ?? 0) > 0 ? '+' : ''}{money(x.delta ?? 0)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {levers.length > 0 ? (
                <>
                  <h3 className="subtitle">À comparer ou renégocier</h3>
                  <ul className="rows">
                    {levers.slice(0, 4).map((x) => (
                      <li key={x.key} className="plain"><span className="n">{x.label}<small>{x.cadence}</small></span><span className="v">{money(x.perYear)}</span></li>
                    ))}
                  </ul>
                </>
              ) : null}
            </section>
          ) : null}

          {tab === 'immo' ? (
            <section className="immo">
              {homeProps.length > 0 ? (
                <>
                  <h3 className="subtitle first">Résidence principale</h3>
                  {homeProps.map((p) => renderProp(p))}
                </>
              ) : null}
              {invProps.length > 0 ? (
                <>
                  <h3 className="subtitle">Investissements</h3>
                  {invSummary ? (
                    <div className="inds big">
                      <span className={'ind ' + invSummary.tone.r}><TrendingUp size={18} strokeWidth={1.6} /><b>{invSummary.rend !== null ? pctPlain(invSummary.rend) : '—'}</b><small>rendement net</small></span>
                      <span className={'ind ' + invSummary.tone.c}><Wallet size={18} strokeWidth={1.6} /><b>{money(invSummary.cash)}</b><small>par mois, après intérêts</small></span>
                      <span className={'ind ' + invSummary.tone.l}><Landmark size={18} strokeWidth={1.6} /><b>{invSummary.ltv !== null ? pctPlain(invSummary.ltv) : '—'}</b><small>de dette</small></span>
                    </div>
                  ) : null}
                  {invProps.map((p) => renderProp(p))}
                  <p className="muted small">Rendement net: loyers moins charges courantes (avant intérêts) sur la valeur estimée. Cash-flow: ce qui reste chaque mois après intérêts et travaux. Dette: hypothèque sur valeur estimée.</p>
                </>
              ) : null}
              {bienNames.length === 0 ? <p className="muted small">Ajoute tes biens dans Documents, « Mes biens ».</p> : null}
            </section>
          ) : null}
        </>
      ) : null}

      {view === 'todo' || !last ? (
        <>
      {!last ? (
        <section className="tile welcome">
          <h2>Bienvenue</h2>
          <ol>
            <li>Mets tes documents dans un dossier: relevés de comptes et de cartes, décomptes, impôts, contrats. Plus tu remontes loin, mieux Horizon compare.</li>
            <li>Indique ce dossier ci-dessous et lance la lecture. Les noms et numéros sont masqués, tout reste sur ton ordinateur.</li>
            <li>Horizon classe, écarte les doublons et les virements entre tes comptes, puis te montre ce qui reste, ce qui revient, ce qui change.</li>
          </ol>
          <p className="muted small">Un compte à l’étranger ou un bien immobilier? Ils apparaissent seulement si tes documents en contiennent.</p>
        </section>
      ) : null}
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
        <h2>Noms et catégories</h2>
        <p className="muted small">Un nom ou une catégorie corrigés sur une ligne s’appliquent à tous les paiements du même fournisseur. Pour corriger, ouvre une ligne dans Revient, Quotidien ou Exceptionnel.</p>
        {state.fournisseurs.length > 0 ? (
          <ul className="changes">
            {state.fournisseurs.map((r) => (
              <li key={r.re}>
                <span className="name">{r.name}<span className="muted small"> · {r.re.replace(/\\(.)/g, '$1')}{r.category ? ` · ${LABEL[r.category] ?? r.category}` : ''}</span></span>
                <button className="btn small" onClick={() => removeFournisseur(r.re)} aria-label={`Retirer ${r.name}`}>Retirer</button>
              </li>
            ))}
          </ul>
        ) : <p className="muted small">Aucun nom choisi pour l’instant.</p>}
      </section>

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

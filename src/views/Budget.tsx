import { useEffect, useMemo, useState, type PointerEvent as RPointerEvent, type ReactElement } from 'react';
import { ArrowDownRight, ArrowLeft, ArrowLeftRight, ArrowUpRight, Building2, Calendar, CalendarRange, FolderOpen, Home, Landmark, LayoutGrid, Repeat, ShoppingBasket, TrendingUp, Wallet, Zap } from 'lucide-react';
import { api, fmt, type Db, type RecurringView, type State, type WatchStatus } from '../api';
import '../budget.css';

const CATS: [string, string][] = [
  ['logement', 'Logement, intérêts et charges'], ['travaux', 'Travaux et rénovations'], ['impots', 'Impôts'], ['assurances', 'Assurances'], ['sante', 'Santé'], ['alimentation', 'Alimentation'],
  ['restaurants', 'Restaurants et cafés'], ['abonnements', 'Abonnements numériques'], ['telecom', 'Télécoms et hébergement'], ['energie', 'Énergie, eau, chauffage'],
  ['vehicule', 'Véhicules'], ['transports', 'Transports publics et taxis'], ['voyages', 'Voyages et vacances'], ['loisirs', 'Loisirs, sport, culture'],
  ['vetements', 'Vêtements'], ['maison', 'Maison, équipement'], ['enfants', 'Enfants et études'], ['famille', 'Famille'], ['dons', 'Cadeaux et dons'],
  ['banque', 'Frais bancaires'], ['especes', 'Espèces et devises'], ['neobanque', 'Recharges Revolut, détail manquant'], ['carte', 'Cartes, détail manquant'],
  ['quotidien', 'Vie courante, autre'], ['autre', 'Autre'],
];
const LABEL: Record<string, string> = { ...Object.fromEntries(CATS), inconnu: 'À identifier' };
const CHOICES: [string, string][] = [...CATS, ['epargne', 'Épargne, prévoyance'], ['interne', 'Entre mes comptes']];

/** Une couleur par catégorie, la même dans tous les graphiques (palette --k1 à --k10 dans budget.css). */
const PALETTE: Record<string, string> = { logement: 'var(--k1)', travaux: 'var(--k1)', impots: 'var(--k9)', assurances: 'var(--k2)', voyages: 'var(--k2)', energie: 'var(--k3)', loisirs: 'var(--k3)', restaurants: 'var(--k4)', vehicule: 'var(--k5)', transports: 'var(--k5)', enfants: 'var(--k6)', vetements: 'var(--k6)', famille: 'var(--k7)', sante: 'var(--k7)', alimentation: 'var(--k8)', quotidien: 'var(--k10)', maison: 'var(--k10)' };
const colorOf = (c: string) => PALETTE[c] ?? 'var(--k9)';

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
  const rangeLabelFn = (pm: string[]) => {
    if (pm.length === 0) return '';
    const sh = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('fr-CH', { month: 'short' }).replace('.', '');
    const a = pm[0];
    const z = pm[pm.length - 1];
    return a === z ? `${sh(a)} ${a.slice(0, 4)}` : `${sh(a)} à ${sh(z)} ${z.slice(0, 4)}`;
  };
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
  }, [period, db, state.budget.count, state.fournisseurs, state.recurring]);
  const rec = period === '12' || !recAlt ? state.recurring : recAlt;
  const [open, setOpen] = useState('');
  const [tab, setTab] = useState<'synthese' | 'revient' | 'quotidien' | 'immo' | 'mila' | 'compare'>('synthese');
  const [more, setMore] = useState(false);
  const monthsN = Math.max(rec.months.length, 1);
  // Bascule discrète mois / année: tous les montants de synthèse sont des totaux de période ramenés au mois ou à l'année.
  const [unit, setUnit] = useState<'mois' | 'an'>('mois');
  const [immoOpen, setImmoOpen] = useState('');
  const sc = (v: number) => (v * (unit === 'mois' ? 1 : 12)) / monthsN;
  const bienNames = [...new Set([...immoRows.map(([k]) => k), ...worksByBien.map(([k]) => k), ...rec.works.map((w) => w.bien ?? 'À rattacher')])];
  const monthShort = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('fr-CH', { month: 'short' }).replace('.', '');
  const monthFr = (m: string) => `${monthShort(m)} ${m.slice(0, 4)}`;
  const rangeLabel = (pm: string[]) => {
    if (pm.length === 0) return '';
    const a = pm[0];
    const z = pm[pm.length - 1];
    if (a === z) return `${monthShort(a)} ${a.slice(0, 4)}`;
    return a.slice(0, 4) === z.slice(0, 4) ? `${monthShort(a)} à ${monthShort(z)} ${z.slice(0, 4)}` : `${monthShort(a)} ${a.slice(0, 4)} à ${monthShort(z)} ${z.slice(0, 4)}`;
  };
  const priorLabel = rangeLabel(rec.priorMonths);
  const nowLabel = rangeLabel(rec.pairMonths);
  const spendYear = rec.totals.recurring + rec.totals.daily + rec.totals.exceptional + rec.totals.works;
  const resteM = (rec.income - spendYear) / monthsN;
  const barMax = Math.max(rec.income, spendYear, 1);
  const parts: { k: typeof tab; label: string; v: number; color: string }[] = [
    { k: 'revient', label: 'Charges et impôts', v: rec.totals.recurring + rec.totals.exceptional, color: 'var(--k1)' },
    { k: 'quotidien', label: 'Le quotidien', v: rec.totals.daily, color: 'var(--k8)' },
    { k: 'immo', label: 'Travaux sur les biens', v: rec.totals.works, color: 'var(--k6)' },
  ];
  const pct = (t: number | null) => (t === null ? '' : `${t > 0 ? '+' : ''}${Math.round(t * 100)} %`);
  const Trend = ({ t, d }: { t: number | null; d: number | null }) => (t !== null && d !== null && Math.abs(t) >= 0.1 && Math.abs(d) >= 100 ? <span className={'chip ' + (t > 0 ? 'up' : 'down')} title={`Par rapport aux mêmes mois un an plus tôt (${rec.comparedMonths} mois)`}>{pct(t)}</span> : null);
  const cut = (n: number) => (more ? n : 8);
  const levers = rec.recurring.filter((x) => x.lever).slice(0, 6);
  const dateFr = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const [fix, setFix] = useState<{ id: string; name: string; category: string } | null>(null);
  const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tooGeneral = (t: string) => t.length < 4 || /^(paiement|d[ée]bit|cr[ée]dit|transfert|virement|ordre|retrait|achat|e-banking)\b/i.test(t);
  const [fixErr, setFixErr] = useState('');
  const saveFix = async (it: { bases: string[] }) => {
    if (!fix || !fix.name.trim()) {
      setFixErr('Donne un nom au fournisseur.');
      return;
    }
    setFixErr('');
    try {
      const rules = [...state.fournisseurs.filter((r) => !(r.key && it.bases.includes(r.key))), ...it.bases.map((k) => ({ key: k, name: fix.name.trim(), ...(fix.category ? { category: fix.category } : {}) }))];
      setState(await api.post(db, 'budget/fournisseurs', { rules }));
      setFix(null);
    } catch (e) {
      setFixErr(e instanceof Error ? e.message : String(e));
    }
  };
  const removeFournisseur = async (id: string) => {
    try {
      setState(await api.post(db, 'budget/fournisseurs', { rules: state.fournisseurs.filter((r) => (r.re ?? r.key) !== id) }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const pctPlain = (x: number) => `${(Math.round(x * 1000) / 10).toString().replace('.', ',')} %`;
  const nrm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const factsAssets = state.facts.filter((f) => f.key.startsWith('asset:') && f.data.class === 'real_estate');
  const factsDebts = state.facts.filter((f) => f.key.startsWith('liability:') && typeof f.data.balance === 'number');
  const mois = Math.max(used.length, 1);
  type Prop = { bien: string; home: boolean; orphan: boolean; commune: string; valeur: number | null; prix: number | null; apport: number | null; valeurNote: string; valeurLow: number | null; valeurHigh: number | null; dette: number; taux: number | null; amort: number; loyers: number; moisLoyer: number; charges: number; interets: number; autres: number; travaux: number; rend: number | null; items: { n: string; v: number }[] };
  // Tous les montants d'un bien sont des totaux sur la période choisie; l'affichage les ramène au mois ou à l'année avec sc().
  const props: Prop[] = bienNames.map((bien) => {
    const v = Object.fromEntries(immoRows)[bien] ?? { loyers: 0, charges: 0 };
    const asset = factsAssets.find((f) => nrm(String(f.data.label ?? '')).includes(nrm(bien)));
    const debts = asset ? factsDebts.filter((d) => d.data.securedBy === asset.key) : [];
    const dette = debts.reduce((t, d) => t + Number(d.data.balance), 0);
    const amortYear = debts.reduce((t, d) => t + Number(d.data.amortization ?? 0), 0);
    const taux = dette > 0 ? debts.reduce((t, d) => t + Number(d.data.balance) * Number(d.data.rate ?? 0), 0) / dette : null;
    const valeur = asset && typeof asset.data.value === 'number' ? Number(asset.data.value) : null;
    const home = (b.homes ?? []).includes(bien) || asset?.data.subtype === 'home';
    const items = rec.recurring.filter((x) => x.bien === bien);
    const interets = Math.min(v.charges, items.filter((x) => /^int[ée]r[êe]ts/i.test(x.label)).reduce((t, x) => t + x.perYear, 0));
    const travaux = Math.min(Math.max(0, v.charges - interets), rec.works.filter((w) => (w.bien ?? 'À rattacher') === bien).reduce((t, w) => t + w.amount, 0));
    const autres = Math.max(0, v.charges - interets - travaux);
    const moisLoyer = used.filter((m) => (m.immo?.[bien]?.loyers ?? 0) > 0).length;
    return {
      bien, home, orphan: bien === 'Non réparti' || bien === 'À rattacher', commune: String(asset?.data.commune ?? ''), valeur, prix: typeof asset?.data.purchasePrice === 'number' ? Number(asset.data.purchasePrice) : null, apport: typeof asset?.data.downPayment === 'number' ? Number(asset.data.downPayment) : null, valeurNote: String(asset?.data.valueNote ?? ''),
      valeurLow: typeof asset?.data.estimateLow === 'number' ? Number(asset.data.estimateLow) : null, valeurHigh: typeof asset?.data.estimateHigh === 'number' ? Number(asset.data.estimateHigh) : null,
      dette, taux, amort: (amortYear * mois) / 12, loyers: v.loyers, moisLoyer, charges: v.charges, interets, autres, travaux,
      rend: (() => { const base = typeof asset?.data.purchasePrice === 'number' ? Number(asset.data.purchasePrice) : null; return base && !home && moisLoyer === mois ? ((v.loyers - autres) * 12) / mois / base : null; })(),
      items: [...items.map((x) => ({ n: x.label, v: x.perYear })), ...rec.works.filter((w) => (w.bien ?? 'À rattacher') === bien).map((w) => ({ n: `${w.label}, ${dateFr(w.date)}`, v: w.amount }))],
    };
  });
  const homeProps = props.filter((p) => p.home);
  const invProps = props.filter((p) => !p.home);
  const renderProp = (p: Prop, opened = false) => {
    const res = p.loyers - p.charges;
    const after = res - p.amort;
    const ltv = p.valeur && p.dette > 0 ? p.dette / p.valeur : null;
    const li = (label: string, v: number, cls = '') => <li className={cls} key={label}><span>{label}</span><b>{money(sc(v))}</b></li>;
    return (
      <details key={p.bien + String(opened)} className="prop" open={opened}>
        <summary>
          <span className="pn">{p.orphan ? 'Non rattaché à un bien' : p.bien}{p.commune ? <small>{p.commune}</small> : null}</span>
          <span className="inds">
            {p.home ? (
              <span className="ind"><Home size={16} strokeWidth={1.6} /><b>{money(sc(p.charges))}</b><small>{unit === 'mois' ? 'de coût par mois' : 'de coût par an'}</small></span>
            ) : (
              <span className={'ind ' + (res >= 0 ? 'ok' : 'bad')}><Wallet size={16} strokeWidth={1.6} /><b>{money(sc(res))}</b><small>{unit === 'mois' ? 'de résultat par mois' : 'de résultat par an'}</small></span>
            )}
          </span>
        </summary>
        {p.orphan ? <p className="muted small">Ces montants ne sont attribués à aucun bien. Ils sont comptés dans le total des investissements, mais fausseront un bien tant qu’ils ne sont pas rattachés (Documents, « Mes biens »).</p> : null}
        <ul className="mini">
          {!p.home ? li('Loyers nets reçus', p.loyers) : null}
          {p.interets > 0 ? li('Intérêts hypothécaires', -p.interets) : null}
          {p.autres > 0 ? li(p.home ? 'Charges et frais' : 'Charges (copropriété, assurances, taxes)', -p.autres) : null}
          {p.travaux > 0 ? li('Travaux', -p.travaux) : null}
          {p.home ? li('Coût total', p.charges, 'net') : li('Résultat avant amortissement', res, 'net')}
          {!p.home && p.amort > 0 ? li('Capital remboursé à la banque (amortissement)', -p.amort, 'muted small') : null}
          {!p.home && p.amort > 0 ? li('Résultat après amortissement', after, 'net') : null}
          {p.prix ? <li className="sep"><span>Prix d’achat</span><b>{money(p.prix)}</b></li> : null}
          {p.apport ? <li><span>Apport initial</span><b>{money(p.apport)}</b></li> : null}
          {p.valeur ? <li className={p.prix ? '' : 'sep'}><span>Valeur estimée, indicative</span><b>{money(p.valeur)}</b></li> : null}
          {p.valeur && p.valeurLow !== null && p.valeurHigh !== null ? <li className="muted small"><span>Fourchette</span><b>{money(p.valeurLow)} à {money(p.valeurHigh)}</b></li> : null}
          {p.valeur && p.valeurNote ? <li className="muted small"><span>{p.valeurNote}</span></li> : null}
          {p.dette > 0 ? <li><span>Hypothèque{p.taux !== null ? `, taux moyen ${pctPlain(p.taux)}` : ''}</span><b>{money(p.dette)}</b></li> : null}
        </ul>
        {!p.home && !p.orphan && p.moisLoyer < mois ? <p className="muted small">Loyers reçus sur {p.moisLoyer} mois seulement sur {mois}: le résultat est incomplet, rien n’est estimé.</p> : null}
        {(state.budget.gerance ?? []).filter((g) => g.bien === p.bien).sort((a, b) => b.to.localeCompare(a.to)).map((g) => {
          const enc = g.loyers + g.forfaits;
          const gl = (label: string, v: number, cls = '') => <li className={cls} key={label}><span>{label}</span><b>{money(v)}</b></li>;
          return (
            <div className="decompte" key={g.from}>
              <p className="muted small">Décompte de gérance {g.regie}, {dateFr(g.from)} au {dateFr(g.to)} (référence datée, total sur la période, ne vaut pas pour la période affichée)</p>
              <ul className="mini sm">
                {gl('Loyers payés par le locataire', g.loyers)}
                {g.forfaits > 0 ? gl('Forfait chauffage et charges', g.forfaits) : null}
                {gl('Encaissé par la régie', enc, 'net')}
                {gl('Charges PPE payées par la régie', -g.ppe)}
                {gl('Impôts fonciers et assurance', -g.taxes)}
                {g.entretien !== 0 ? gl('Entretien, net des refacturations', -g.entretien) : null}
                {gl('Honoraires de gestion', -g.honoraires)}
                {g.autres !== 0 ? gl('Autres frais (divers, relocation, banque)', -g.autres) : null}
                {gl('Résultat de gérance', g.benefice, 'net')}
              </ul>
            </div>
          );
        })}
        {p.items.length > 0 ? (
          <details className="manual">
            <summary>Détail des charges</summary>
            <ul className="mini sm">{p.items.map((it, i) => <li key={i}><span>{it.n}</span><b>{money(it.v)}</b></li>)}</ul>
          </details>
        ) : null}
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
  // Choix de la période: un toucher = un mois, un glissé sur les barres = une plage; les raccourcis couvrent le reste.
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const [hov, setHov] = useState<number | null>(null);
  const barIdx = (e: RPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(tl.length - 1, Math.floor(((e.clientX - r.left) / Math.max(r.width, 1)) * tl.length)));
  };
  const setSpan = (p: string) => { setPeriod(p); setOpen(''); setMore(false); };
  const endDrag = () => {
    if (!drag) return;
    const [a, z] = drag[0] <= drag[1] ? drag : [drag[1], drag[0]];
    setDrag(null);
    if (a === z) setSpan(period === tl[a].month ? '12' : tl[a].month);
    else setSpan(`${tl[a].month}..${tl[z].month}`);
  };
  const niceStep = (mx: number) => { const raw = mx / 3; const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1)))); const f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
  const axStep = niceStep(tlMax);
  const axTop = Math.ceil(tlMax / axStep) * axStep;
  const axTicks = Array.from({ length: Math.round(axTop / axStep) }, (_, i) => (i + 1) * axStep);
  const kfmt = (v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}`.replace('.', ',') + ' k' : String(v));
  const avg3 = tl.map((_, i) => { const w = tl.slice(Math.max(0, i - 2), i + 1).filter((x) => x.spend > 0); return w.length ? w.reduce((t, x) => t + x.spend, 0) / w.length : 0; });
  const shownMonths = drag ? new Set(tl.slice(Math.min(...drag), Math.max(...drag) + 1).map((m) => m.month)) : selMonths;
  const presets: [string, string][] = [['12', '12 mois'], ...years.slice(0, 2).map((y): [string, string] => [y, y === curYear && last && last.month.slice(5) !== '12' ? `${y} à ce jour` : y])];
  const timeline = (
    <div className="timeline">
      <div
        className="tlbars"
        role="group"
        aria-label="Choisir une période"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const i = barIdx(e); setDrag([i, i]); }}
        onPointerMove={(e) => { if (drag) setDrag([drag[0], barIdx(e)]); }}
        onPointerUp={endDrag}
        onPointerCancel={() => setDrag(null)}
      >
        <div className="tlgrid" aria-hidden="true">
          {axTicks.map((v) => <span key={v} style={{ bottom: `${(v / axTop) * 100}%` }}>{reveal ? <em>{kfmt(v)}</em> : null}</span>)}
        </div>
        <svg className="tlavg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={tl.map((_, i) => `${((i + 0.5) / tl.length) * 100},${100 - (avg3[i] / axTop) * 100}`).join(' ')} fill="none" vectorEffect="non-scaling-stroke" />
        </svg>
        {tl.map((m, i) => {
          const over = m.spend > m.income && m.income > 0;
          return (
            <button key={m.month} className={(shownMonths.has(m.month) ? 'on' : '') + (over ? ' over' : '') + (m.spend === 0 && m.income === 0 ? ' none' : '') + (hov === i ? ' hov' : '')} onClick={(e) => { if (e.detail === 0) setSpan(period === m.month ? '12' : m.month); }} onPointerEnter={() => setHov(i)} onPointerLeave={() => setHov(null)} title={`${monthName(m.month)}: gains ${money(m.income)}, dépenses ${money(m.spend)}`} aria-label={`${monthName(m.month)}: gains ${money(m.income)}, dépenses ${money(m.spend)}`} aria-pressed={shownMonths.has(m.month)}>
              <i className="dep" style={{ height: `${Math.max(m.spend === 0 ? 0 : 2, (m.spend / axTop) * 100)}%` }} />
              <i className="tick" style={{ bottom: `${Math.min(99, (m.income / axTop) * 100)}%` }} />
            </button>
          );
        })}
      </div>
      <div className="tlmonths" aria-hidden="true">
        {tl.map((m) => <span key={m.month}>{m.month.slice(5) === '01' ? m.month.slice(2, 4) : monthShort(m.month).slice(0, 1).toUpperCase()}</span>)}
      </div>
      <div className="tllabel">
        {presets.map(([p, label]) => <button key={p} className={period === p ? 'on' : ''} onClick={() => setSpan(p)}>{label}</button>)}
        <div className="unit" role="group" aria-label="Affichage par mois ou par année">
          <button className={unit === 'mois' ? 'on' : ''} onClick={() => setUnit('mois')} title="Par mois" aria-label="Par mois" aria-pressed={unit === 'mois'}><Calendar size={15} strokeWidth={1.6} /></button>
          <button className={unit === 'an' ? 'on' : ''} onClick={() => setUnit('an')} title="Par année" aria-label="Par année" aria-pressed={unit === 'an'}><CalendarRange size={15} strokeWidth={1.6} /></button>
        </div>
        <span>{periodLabel}</span>
      </div>
      {(() => {
        const sel = tl.filter((m) => shownMonths.has(m.month) && (m.spend > 0 || m.income > 0));
        const one = hov !== null ? tl[hov] : null;
        const n = Math.max(sel.length, 1);
        const g = one ? one.income : sel.reduce((t, m) => t + m.income, 0) / n;
        const d = one ? one.spend : sel.reduce((t, m) => t + m.spend, 0) / n;
        const r = g - d;
        return (
          <p className="tlread" aria-live="polite">
            <b>{one ? monthName(one.month) : `Moyenne mensuelle, ${periodLabel}`}</b>
            <span>Gains <strong>{money(g)}</strong></span>
            <span>Dépenses <strong>{money(d)}</strong></span>
            <span className={r >= 0 ? 'pos' : 'neg'}>{r >= 0 ? 'Reste' : 'Déficit'} <strong>{money(Math.abs(r))}</strong></span>
          </p>
        );
      })()}
      <p className="tlcap"><span><b className="bar" />Dépenses</span><span><b className="bar over" />Dépenses au-dessus des gains</span><span><b className="gain" />Gains</span><span><b className="avg" />Moyenne 3 mois</span><span className="hint">Glisse pour choisir une période</span></p>
    </div>
  );
  const Cmp = ({ now, before, goodUp = false }: { now: number | null; before: number | null; goodUp?: boolean }) => {
    if (now === null || before === null || before <= 0) return <p className="cmpline">Pas de comparaison possible</p>;
    const t = now / before - 1;
    const text = `${money(before)} en ${priorLabel}, contre ${money(now)} en ${nowLabel}`;
    if (Math.abs(t) < 0.02) return <p className="cmpline">Stable · {text}</p>;
    const good = goodUp ? t > 0 : t < 0;
    return <p className={'cmpline ' + (good ? 'down' : 'up')}>{t > 0 ? '↑' : '↓'} {pct(t)} · {text}</p>;
  };
  type Item = { id: string; name: string; amount: number; cat: string; bases: string[]; prior?: number | null; trend?: number | null; delta?: number | null; facts: string[]; lines: { date: string; amount: number; account: string; text: string }[] };
  const [sortBy, setSortBy] = useState<'montant' | 'nom'>('montant');
  const [groupBy, setGroupBy] = useState<Record<string, boolean>>({ exceptionnel: true });
  const [openGroup, setOpenGroup] = useState('');
  const [moreG, setMoreG] = useState('');
  // Un écart ne s'affiche que s'il pèse: en francs, pas en pourcentage, et à partir de 300 CHF.
  // Les charges de copropriété sont payées par appels de fonds, parfois en rattrapage: une comparaison à date de paiement serait trompeuse.
  const note = (it: Item) => (/ppe|copropri/i.test(it.name) ? null : it.delta !== null && it.delta !== undefined && it.prior !== null && it.prior !== undefined && Math.abs(it.delta) >= 300 ? { text: `${it.delta > 0 ? '+' : '−'}${money(Math.abs(it.delta))} sur un an (${money(it.prior)} avant)`, tone: '' } : null);
  const renderRow = (it: Item) => {
    const n = note(it);
    return (
      <li key={it.id} className={open === it.id ? 'open' : ''}>
        <button className="rowbtn" onClick={() => setOpen(open === it.id ? '' : it.id)} aria-expanded={open === it.id}>
          <span className="n">{it.name}{n ? <small className={'chg ' + n.tone}>{n.text}</small> : null}</span>
          <span className="v">{money(sc(it.amount))}</span>
        </button>
        {open === it.id ? (
          <div className="detail">
            <p className="facts">{it.facts.filter(Boolean).join(' · ')}</p>
            {it.bases.length > 0 ? (
              fix?.id === it.id ? (
                <div className="fixform">
                  <input value={fix.name} onChange={(e) => setFix({ ...fix, name: e.target.value })} aria-label="Nom" placeholder="Nom du fournisseur" />
                  <select value={fix.category} onChange={(e) => setFix({ ...fix, category: e.target.value })} aria-label="Catégorie">
                    <option value="">Garder la catégorie</option>
                    {CATS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <button className="btn" onClick={() => saveFix(it)}>Enregistrer</button>
                  <button className="btn small" onClick={() => { setFix(null); setFixErr(''); }}>Annuler</button>
                  {fixErr ? <p className="muted small" role="alert">{fixErr}</p> : null}
                </div>
              ) : (
                <button className="link" onClick={() => { setFixErr(''); setFix({ id: it.id, name: it.name, category: '' }); }}>Corriger le nom ou la catégorie</button>
              )
            ) : null}
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
        <p className="unitcap">Montants cumulés sur {periodLabel}</p>
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
  const renderTree = (tabKey: string, items: Item[], groupOf: (it: Item) => { id: string; label: string; color: string }) => {
    const gm = new Map<string, { id: string; label: string; color: string; list: Item[]; amount: number }>();
    for (const it of items) {
      const g = groupOf(it);
      const e = gm.get(g.id) ?? { ...g, list: [], amount: 0 };
      e.list.push(it);
      e.amount += it.amount;
      gm.set(g.id, e);
    }
    const groups = [...gm.values()].sort((a, b) => b.amount - a.amount);
    const tot = Math.max(1, groups.reduce((t, g) => t + g.amount, 0));
    const top = Math.max(1, groups[0]?.amount ?? 1);
    return (
      <ul className="rows tree">
        {groups.map((g) => {
          const key = tabKey + g.id;
          const isOpen = openGroup === key;
          const list = [...g.list].sort((a, b) => b.amount - a.amount);
          const shown = moreG === key ? list : list.slice(0, 8);
          return (
            <li key={g.id} className={isOpen ? 'open' : ''}>
              <button className="rowbtn" onClick={() => { setOpenGroup(isOpen ? '' : key); setOpen(''); }} aria-expanded={isOpen}>
                <span className="n"><span><span className="dot" style={{ background: g.color }} />{g.label}</span><small>{Math.round((g.amount / tot) * 100)} % · {plural(g.list.length, 'poste')}</small></span>
                <span className="v">{money(sc(g.amount))}</span>
              </button>
              <span className="gbar" aria-hidden="true"><i style={{ width: `${(g.amount / top) * 100}%`, background: g.color }} /></span>
              {isOpen ? (
                <ul className="rows sub">
                  {shown.map((it) => renderRow(it))}
                  {list.length > 8 && moreG !== key ? <li className="plain"><button className="morelink" onClick={() => setMoreG(key)}>Voir les {list.length - 8} autres</button></li> : null}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  };
  const maxCat = Math.max(1, ...cats.map((c) => (catView === 'total' ? c.total : c.avg)));

  const hbars = (rows: { k: string; label: string; v: number; note?: string; color?: string }[], max: number) => (
    <ul className="hb">
      {rows.map((r) => (
        <li key={r.k}>
          <span className="hl">{r.label}{r.note ? <small>{r.note}</small> : null}</span>
          <span className="hbar"><i style={{ width: `${max > 0 ? Math.min(100, (Math.abs(r.v) / max) * 100) : 0}%`, background: r.color ?? 'var(--c-cash)' }} /></span>
          <b>{money(r.v)}</b>
        </li>
      ))}
    </ul>
  );
  const STRUCT = ['impots', 'logement', 'assurances', 'energie', 'enfants', 'famille'];
  const revCats = Object.values(rec.recurring.reduce<Record<string, { k: string; v: number }>>((t, x) => ({ ...t, [x.category]: { k: x.category, v: (t[x.category]?.v ?? 0) + x.perYear } }), {})).sort((p, q) => q.v - p.v);
  const revTotal = revCats.reduce((t, x) => t + x.v, 0);
  const revStruct = revCats.filter((x) => STRUCT.includes(x.k)).reduce((t, x) => t + x.v, 0);
  const revMoves = rec.recurring.filter((x) => x.delta !== null && Math.abs(x.delta) >= 200).sort((p, q) => Math.abs(q.delta ?? 0) - Math.abs(p.delta ?? 0)).slice(0, 5);
  const DAILY: [string, string[], string][] = [['Courses', ['alimentation'], 'var(--k8)'], ['Restaurants', ['restaurants'], 'var(--k4)'], ['Achats et loisirs', ['quotidien', 'maison', 'vetements', 'loisirs'], 'var(--k10)']];
  const dailyMonths = full.slice(-13).map((m) => ({ month: m.month, parts: DAILY.map(([, ks]) => ks.reduce((t, k) => t + (m.byCategory[k] ?? 0), 0)) }));
  const dailyMax = Math.max(1, ...dailyMonths.map((m) => m.parts.reduce((t, v) => t + v, 0)));
  const dailyAvg = dailyMonths.length ? dailyMonths.reduce((t, m) => t + m.parts.reduce((a, v) => a + v, 0), 0) / dailyMonths.length : 0;
  const mortgageLevers = factsDebts
    .map((d) => ({ key: d.key, label: String(d.data.label ?? d.key), interest: Number(d.data.balance) * Number(d.data.rate ?? 0), rate: Number(d.data.rate ?? 0) }))
    .filter((d) => d.rate >= 0.012)
    .sort((p, q) => q.interest - p.interest);

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
            {([['synthese', 'Synthèse', <LayoutGrid key="s" size={20} strokeWidth={1.5} />], ['revient', 'Charges', <Repeat key="a" size={20} strokeWidth={1.5} />], ['quotidien', 'Quotidien', <ShoppingBasket key="b" size={20} strokeWidth={1.5} />], ['immo', 'Immobilier', <Building2 key="e" size={20} strokeWidth={1.5} />], ['compare', 'Comparatif', <ArrowLeftRight key="p" size={20} strokeWidth={1.5} />], ['mila', 'Mila', <Home key="m" size={20} strokeWidth={1.5} />]] as [typeof tab, string, ReactElement][]).filter(([k]) => k !== 'mila' || !!state.mila).map(([k, l, ic]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setMore(false); setOpen(''); }}>{ic}<span>{l}</span></button>
            ))}
          </div>

          {tab === 'revient' ? (() => {
            const items: Item[] = [
              ...rec.recurring.map((x) => ({ id: x.key, name: x.label, amount: x.perYear, cat: x.category, bases: x.bases, prior: x.prior, trend: x.trend, delta: x.delta, facts: [x.cadence, x.bien ?? '', x.lever ? 'à comparer' : '', plural(x.count, 'paiement')], lines: x.lines })),
              ...rec.oneOffs.map((x, i) => ({ id: `o${i}`, name: /^(paiement|d[ée]bit|ordre|transfert|virement|retrait)/i.test(x.label) ? (LABEL[x.category] ?? x.label) : x.label, amount: x.amount, cat: x.category, bases: x.bases, facts: [dateFr(x.date), 'une fois sur la période'], lines: [{ date: x.date, amount: x.amount, account: '', text: x.text }] })),
            ];
            const total = items.reduce((t, x) => t + x.amount, 0);
            if (total <= 0) return <section><p className="muted small">Rien à afficher sur cette période.</p></section>;
            const struct = items.filter((x) => STRUCT.includes(x.cat)).reduce((t, x) => t + x.amount, 0);
            return (
              <section>
                <div className="inds big">
                  <span className="ind"><Repeat size={18} strokeWidth={1.6} /><b>{money(sc(total))}</b><small>de charges {unit === 'mois' ? 'par mois' : 'par an'}</small></span>
                  <span className="ind"><Landmark size={18} strokeWidth={1.6} /><b>{Math.round((struct / total) * 100)} %</b><small>incompressible</small></span>
                </div>
                <div className="stackbar" aria-hidden="true"><i style={{ width: `${(struct / total) * 100}%`, background: 'var(--k1)' }} /><i style={{ width: `${((total - struct) / total) * 100}%`, background: 'var(--k4)' }} /></div>
                <p className="muted small">Incompressible: impôts, logement, assurances, énergie, enfants, famille. Le reste est ajustable. Les impôts, voyages et grosses dépenses de l’année sont inclus. Touche un poste pour voir son détail.</p>
                {renderTree('revient', items, (it) => ({ id: it.cat, label: LABEL[it.cat] ?? it.cat, color: colorOf(it.cat) }))}
              </section>
            );
          })() : null}

          {tab === 'quotidien' ? (() => {
            const items: Item[] = rec.merchants.map((x) => ({ id: x.key, name: x.label, amount: x.total, cat: x.category, bases: x.bases, prior: x.prior, trend: x.trend, delta: x.delta, facts: [LABEL[x.category] ?? x.category, plural(x.count, 'paiement')], lines: x.lines }));
            const listed = items.reduce((t, x) => t + x.amount, 0);
            const small = Math.max(0, rec.totals.daily - listed);
            if (rec.totals.daily <= 0) return <section><p className="muted small">Rien à afficher sur cette période.</p></section>;
            return (
              <section>
                <div className="inds big">
                  <span className="ind"><ShoppingBasket size={18} strokeWidth={1.6} /><b>{money(sc(rec.totals.daily))}</b><small>de quotidien {unit === 'mois' ? 'par mois' : 'par an'}</small></span>
                  <span className="ind"><Wallet size={18} strokeWidth={1.6} /><b>{rec.totals.daily + rec.totals.recurring + rec.totals.exceptional > 0 ? Math.round((rec.totals.daily / spendYear) * 100) : 0} %</b><small>des dépenses</small></span>
                </div>
                <p className="muted small">Courses, restaurants, achats du quotidien. Touche une famille, puis un commerçant, pour voir les paiements.</p>
                {renderTree('quotidien', items, (it) => {
                  const f = DAILY.find(([, ks]) => ks.includes(it.cat));
                  return f ? { id: f[0], label: f[0], color: f[2] } : { id: 'autres', label: 'Autres achats', color: 'var(--k9)' };
                })}
                {small >= 50 ? <p className="muted small">Non listé: {money(sc(small))} {unit === 'mois' ? 'par mois' : 'par an'} de petits achats (moins de 100 CHF par commerçant sur la période).</p> : null}
              </section>
            );
          })() : null}

          {tab === 'synthese' ? (() => {
            const income = Math.max(rec.income, 0);
            const T = Math.max(income, spendYear, 1);
            const H = 150, SLOT = 40, GAP = 6, XL = 14, XR = 150, XM = (XL + XR) / 2;
            const nodes: { k: string; label: string; v: number; color: string; go: boolean }[] = [
              ...parts.filter((x) => x.v > 0).map((x) => ({ k: x.k as string, label: x.label, v: x.v, color: x.color, go: true })),
              ...(income > spendYear ? [{ k: 'reste', label: 'Reste', v: income - spendYear, color: 'var(--pos)', go: false }] : []),
            ];
            const hs = nodes.map((n) => Math.max(4, (n.v / T) * H));
            const slots = hs.map((h) => Math.max(h, SLOT));
            const totalH = slots.reduce((t, s) => t + s + GAP, 0) - GAP;
            const lh = hs.reduce((t, h) => t + h, 0);
            const l0 = Math.max(0, (totalH - lh) / 2);
            let slotTop = 0;
            let ly = l0;
            const flows = nodes.map((n, i) => {
              const h = hs[i];
              const ry = slotTop + (slots[i] - h) / 2;
              const out = { n, h, ry, ly, cy: slotTop + slots[i] / 2 };
              slotTop += slots[i] + GAP;
              ly += h;
              return out;
            });
            const deficit = Math.max(0, spendYear - income);
            const defH = deficit > 0 ? (lh * deficit) / T : 0;
            const manque = resteM < 0;
            return (
              <section>
                <div className="inds big">
                  <span className="ind"><TrendingUp size={18} strokeWidth={1.6} /><b>{money(sc(rec.income))}</b><small>gagné</small></span>
                  <span className="ind"><Wallet size={18} strokeWidth={1.6} /><b>{money(sc(spendYear))}</b><small>dépensé</small></span>
                  <span className={'ind ' + (manque ? 'bad' : 'ok')}><Landmark size={18} strokeWidth={1.6} /><b>{money(sc(rec.income - spendYear))}</b><small>{manque ? 'de manque' : 'qui reste'}</small></span>
                </div>
                <p className="muted small">{unit === 'mois' ? 'Par mois' : 'Par an'}, au rythme de {periodLabel}.</p>
                <svg className="flow" viewBox={`0 0 360 ${totalH}`} role="img" aria-label={`Ce qui est gagné se répartit entre ${nodes.map((n) => n.label).join(', ')}`}>
                  {flows.map(({ n, h, ry, ly: y0 }) => (
                    <path key={'p' + n.k} d={`M${XL},${y0} C${XM},${y0} ${XM},${ry} ${XR},${ry} L${XR},${ry + h} C${XM},${ry + h} ${XM},${y0 + h} ${XL},${y0 + h} Z`} style={{ fill: n.color, opacity: 0.28 }} />
                  ))}
                  <rect x={0} y={l0} width={XL} height={Math.max(1, lh - defH)} rx={3} style={{ fill: 'var(--pos)' }} />
                  {defH > 0 ? <rect x={0} y={l0 + lh - defH} width={XL} height={defH} rx={3} style={{ fill: 'var(--neg)' }} /> : null}
                  {flows.map(({ n, h, ry, cy }) => (
                    <g key={'n' + n.k} onClick={() => { if (n.go) { setTab(n.k as typeof tab); setMore(false); setOpen(''); } }} style={{ cursor: n.go ? 'pointer' : 'default' }}>
                      <rect x={XR} y={ry} width={12} height={h} rx={3} style={{ fill: n.color }} />
                      <text x={XR + 22} y={cy - 3}>{n.label}</text>
                      <text x={XR + 22} y={cy + 14} className="sub">{money(sc(n.v))} · {Math.round((n.v / T) * 100)} %</text>
                    </g>
                  ))}
                </svg>
                <p className="muted small">{manque ? 'Le rouge à gauche est ce qui a été dépensé en plus de ce qui est entré.' : 'Chaque bande part de ce qui est entré et va là où l’argent est sorti.'} Touche une destination pour ouvrir le détail.</p>
                {rec.compare.spend !== null && rec.compare.spendNow !== null ? (
                  <>
                    <h3 className="subtitle">Par rapport à l’an dernier</h3>
                    <Cmp now={rec.compare.spendNow} before={rec.compare.spend} />
                  </>
                ) : null}
                {levers.length + mortgageLevers.length > 0 ? (
                  <>
                    <h3 className="subtitle">À comparer ou renégocier</h3>
                    <ul className="rows">
                      {mortgageLevers.slice(0, 2).map((x) => (
                        <li key={x.key} className="plain"><span className="n">{x.label}<small>Taux {pctPlain(x.rate)}: à comparer au SARON au renouvellement</small></span><span className="v">{money(x.interest)}<small>d’intérêts par an</small></span></li>
                      ))}
                      {levers.slice(0, 3).map((x) => (
                        <li key={x.key} className="plain"><span className="n">{x.label}<small>{x.cadence}</small></span><span className="v">{money(sc(x.perYear))}</span></li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </section>
            );
          })() : null}

          {tab === 'compare' ? (() => {
            if (prevYear.length === 0) return <section><p className="muted small">Pas de comparaison possible: les relevés ne remontent pas assez loin pour cette période.</p></section>;
            const S = (ms: typeof used, f: (m: (typeof used)[number]) => number) => ms.reduce((t, m) => t + f(m), 0);
            const keys = [...new Set([...used, ...prevYear].flatMap((m) => Object.keys(m.byCategory)))];
            const all = keys.map((k) => ({ k, a: S(prevYear, (m) => m.byCategory[k] ?? 0), b: S(used, (m) => m.byCategory[k] ?? 0) }));
            const labA = rangeLabelFn(prevYear.map((m) => m.month));
            const labB = rangeLabelFn(used.map((m) => m.month));
            const incA = S(prevYear, (m) => m.income), incB = S(used, (m) => m.income);
            const spA = S(prevYear, (m) => m.spend), spB = S(used, (m) => m.spend);
            const diff = (n: number) => (Math.abs(n) < 100 ? '—' : `${n > 0 ? '+' : '−'}${money(Math.abs(n))}`);
            const movers = all.map((x) => ({ ...x, d: x.b - x.a })).filter((x) => Math.abs(x.d) >= 200).sort((p, q) => Math.abs(q.d) - Math.abs(p.d)).slice(0, 8);
            const rest = spB - spA - movers.reduce((t, x) => t + x.d, 0);
            return (
              <section className="immo">
                <p className="cmphead">{labB} <span className="muted">contre</span> {labA}</p>
                <p className="muted small">Les mêmes mois, un an plus tôt. Totaux sur toute la période, pas par mois.</p>
                <table className="cmp">
                  <thead><tr><th /><th>Avant<small>{labA}</small></th><th>Maintenant<small>{labB}</small></th><th>Écart</th></tr></thead>
                  <tbody>
                    <tr><td>Gagné</td><td>{money(incA)}</td><td>{money(incB)}</td><td>{diff(incB - incA)}</td></tr>
                    <tr><td>Dépensé</td><td>{money(spA)}</td><td>{money(spB)}</td><td>{diff(spB - spA)}</td></tr>
                    <tr className="tot"><td>Reste</td><td>{money(incA - spA)}</td><td>{money(incB - spB)}</td><td>{diff(incB - spB - (incA - spA))}</td></tr>
                  </tbody>
                </table>
                {movers.length > 0 ? (
                  <>
                    <h3 className="subtitle">Où se joue l’écart de dépenses</h3>
                    <ul className="rows">
                      {movers.map((x) => <li key={x.k} className="plain"><span className="n">{LABEL[x.k] ?? x.k}<small>{money(x.a)} → {money(x.b)}</small></span><span className={'v delta ' + (x.d > 0 ? 'up' : 'down')}>{diff(x.d)}</span></li>)}
                      {Math.abs(rest) >= 200 ? <li className="plain"><span className="n">Autres écarts<small>plusieurs petits postes</small></span><span className="v delta">{diff(rest)}</span></li> : null}
                    </ul>
                  </>
                ) : null}
                <p className="muted small">Doublons et virements entre comptes écartés. Pour changer la période comparée, choisis-la dans la frise en haut.</p>
              </section>
            );
          })() : null}

          {tab === 'mila' && state.mila ? (() => {
            const mv = state.mila;
            const FACTOR = unit === 'an' ? 10.5 : 1;
            const MAP: Record<string, [string, string]> = { loyer: ['Logement', 'logement'], ecole: ['École', 'enfants'], nourriture: ['Repas et courses', 'alimentation'], alimentation: ['Repas et courses', 'alimentation'], restaurants: ['Repas et courses', 'alimentation'], sante: ['Santé', 'sante'] };
            const acc: Record<string, { label: string; cat: string; total: number; perMonth: number; count: number }> = {};
            const put = (key: string, x: { total: number; perMonth: number; count: number }) => {
              const [label, cat] = MAP[key] ?? ['Autres', 'autre'];
              acc[label] = { label, cat, total: (acc[label]?.total ?? 0) + x.total, perMonth: (acc[label]?.perMonth ?? 0) + x.perMonth, count: (acc[label]?.count ?? 0) + x.count };
            };
            mv.famille.couts.forEach((x) => put(x.key, x));
            mv.compte?.sorties.forEach((x) => put(x.key, x));
            const rows = Object.values(acc).sort((p, q) => q.perMonth - p.perMonth);
            const perMonth = rows.reduce((t, x) => t + x.perMonth, 0);
            const total = perMonth * FACTOR;
            const yearTotal = perMonth * 10.5;
            const left = Math.max(0, yearTotal - mv.cout.total);
            const mx = Math.max(1, ...rows.map((x) => x.perMonth * FACTOR));
            return (
              <section className="immo">
                <p className="unitcap">{unit === 'an' ? 'Année scolaire: 10,5 mois, de la rentrée de fin août à fin juin' : 'Moyenne par mois, hors vacances d’été'}</p>
                <div className="inds big">
                  <span className="ind"><Home size={18} strokeWidth={1.6} /><b>{money(total)}</b><small>{unit === 'mois' ? 'par mois en moyenne' : 'prévus sur l’année scolaire'}</small></span>
                  <span className="ind"><Wallet size={18} strokeWidth={1.6} /><b>{money(mv.cout.total)}</b><small>déjà payé depuis le 17 août</small></span>
                  <span className="ind"><Landmark size={18} strokeWidth={1.6} /><b>{money(left)}</b><small>encore à prévoir jusqu’à fin juin</small></span>
                </div>
                <ul className="hb">
                  {rows.map((x) => (
                    <li key={x.label}>
                      <span className="hl">{x.label}<small>{Math.round((x.perMonth / Math.max(perMonth, 1)) * 100)} % · {plural(x.count, 'paiement')}</small></span>
                      <span className="hbar"><i style={{ width: `${(x.perMonth * FACTOR / mx) * 100}%`, background: colorOf(x.cat) }} /></span>
                      <b>{money(x.perMonth * FACTOR)}</b>
                    </li>
                  ))}
                </ul>
                {mv.compte ? <p className="muted small">Solde de son compte: {money(mv.compte.solde)}, contre {money(mv.compte.soldeInitial)} au départ.</p> : null}
                <p className="muted small">Yverdon et Ste-Croix uniquement, plus tout ce qui est clairement pour le CPNV. Année scolaire: 10,5 mois, du 17 août au 30 juin.</p>
                {mv.famille.epargne.length > 0 ? <p className="muted small">Mis de côté pour elle, pas un coût: {money(mv.famille.epargne.reduce((t, x) => t + x.total, 0))} d’argent de poche versé sur son épargne.</p> : null}
                <p className="muted small">Dépôt de garantie de 900 CHF, remboursé fin juin 2027: pas un coût.</p>
              </section>
            );
          })() : null}

          {tab === 'immo' ? (() => {
            const T = (f: (p: Prop) => number) => invProps.reduce((t, p) => t + f(p), 0);
            const loyers = T((p) => p.loyers), charges = T((p) => p.charges), amort = T((p) => p.amort);
            const res = loyers - charges;
            const orphan = invProps.filter((p) => p.orphan && p.loyers > 0);
            const picked = props.find((p) => p.bien === immoOpen);
            const hyp = factsDebts.map((d) => ({ key: d.key, label: String(d.data.label ?? d.key), balance: Number(d.data.balance), rate: Number(d.data.rate ?? 0), variable: !!d.data.variable, note: String(d.data.note ?? '') })).sort((p, q) => q.balance - p.balance);
            const hypTotal = hyp.reduce((t, x) => t + x.balance, 0);
            const echeance = (x: { note: string; variable: boolean; rate: number }) => (x.variable ? `SARON${x.rate > 0 ? ` ${pctPlain(x.rate)}` : ''}` : `${pctPlain(x.rate)}${/fixe jusqu/i.test(x.note) ? `, ${x.note.replace(/^fixe/i, 'fixe')}` : ''}`);
            // Loyer contractuel brut: somme, pour chaque mois de la période, de chaque bail au prorata des jours couverts.
            const bauxOf = (bien: string) => (state.budget.baux ?? []).filter((b) => b.bien === bien);
            const brutPeriod = (bien: string) => rec.months.reduce((t, m) => {
              const [y, mo] = m.split('-').map(Number);
              const dim = new Date(y, mo, 0).getDate();
              const s = Date.UTC(y, mo - 1, 1), e = Date.UTC(y, mo - 1, dim);
              return t + bauxOf(bien).reduce((u, b) => {
                const f = Date.parse(b.from + 'T00:00:00Z'), g = b.to ? Date.parse(b.to + 'T00:00:00Z') : Infinity;
                const days = Math.max(0, Math.round((Math.min(e, g) - Math.max(s, f)) / 86400000) + 1);
                return u + ((b.net + b.charges) * days) / dim;
              }, 0);
            }, 0);
            const today = new Date().toISOString().slice(0, 10);
            const brutNow = (bien: string) => bauxOf(bien).filter((x) => x.from <= today && (!x.to || x.to >= today)).reduce((t, x) => t + x.net + x.charges, 0) * (unit === 'mois' ? 1 : 12);
            const brutTot = invProps.reduce((t, p) => t + brutPeriod(p.bien), 0);
            const earliest = (bien: string) => bauxOf(bien).map((b) => b.from).sort()[0] ?? '';
            const line = (p: Prop, r: number) => (
              <tr key={p.bien} className={'clk' + (immoOpen === p.bien ? ' on' : '')} onClick={() => setImmoOpen(immoOpen === p.bien ? '' : p.bien)} aria-expanded={immoOpen === p.bien}>
                <td>{p.orphan ? 'Non rattaché' : p.bien}{p.moisLoyer < mois && !p.orphan && !p.home ? <small>versements sur {p.moisLoyer} mois sur {mois}</small> : null}</td>
                <td>{!p.home && bauxOf(p.bien).length > 0 ? money(sc(brutPeriod(p.bien))) : ''}{!p.home && bauxOf(p.bien).length > 0 && Math.abs(brutNow(p.bien) - sc(brutPeriod(p.bien))) >= 1 ? <small>aujourd’hui {money(brutNow(p.bien))}</small> : null}{!p.home && bauxOf(p.bien).length > 0 && rec.months[0] && rec.months[0] + '-01' < earliest(p.bien) ? <small>baux connus dès {dateFr(earliest(p.bien))}</small> : null}</td>
                <td>{p.home ? '' : money(sc(p.loyers))}</td>
                <td>{money(sc(p.charges))}</td>
                <td className={p.home ? '' : r >= 0 ? 'pos' : 'neg'}>{p.home ? '' : money(sc(r))}{!p.home && p.amort > 0 ? <small>après capital {money(sc(r - p.amort))}</small> : null}</td>
              </tr>
            );
            return (
              <section className="immo">
                <p className="muted small">{unit === 'mois' ? 'Par mois' : 'Par an'}, au rythme de {periodLabel}. Touche un bien pour voir d’où viennent les montants.</p>
                <table className="cmp immotbl">
                  <thead><tr><th>Bien</th><th>Loyer contractuel<small>brut, selon les baux</small></th><th>Versé par la régie</th><th>Payé par toi</th><th>Résultat</th></tr></thead>
                  <tbody>
                    {invProps.map((p) => line(p, p.loyers - p.charges))}
                    <tr className="tot"><td>Investissements</td><td>{brutTot > 0 ? money(sc(brutTot)) : ''}</td><td>{money(sc(loyers))}</td><td>{money(sc(charges))}</td><td className={res >= 0 ? 'pos' : 'neg'}>{money(sc(res))}{amort > 0 ? <small>après capital {money(sc(res - amort))}</small> : null}</td></tr>
                    {homeProps.map((p) => line(p, 0))}
                  </tbody>
                </table>
                {picked ? renderProp(picked, true) : null}
                {orphan.length > 0 ? <p className="muted small">Attention: {money(sc(orphan.reduce((t, p) => t + p.loyers, 0)))} de loyers ne sont rattachés à aucun bien.</p> : null}
                {hyp.length > 0 ? (
                  <>
                    <h3 className="subtitle">Hypothèques</h3>
                    <table className="cmp immotbl">
                      <thead><tr><th>Prêt</th><th>Montant</th><th>Taux</th></tr></thead>
                      <tbody>
                        {hyp.map((x) => <tr key={x.key}><td>{x.label.replace(/^Hypothèque\s*/i, '')}</td><td>{money(x.balance)}</td><td>{echeance(x)}</td></tr>)}
                        <tr className="tot"><td>Total</td><td>{money(hypTotal)}</td><td /></tr>
                      </tbody>
                    </table>
                  </>
                ) : null}
                <p className="muted small">Loyer contractuel: loyer et forfait de charges prévus par les baux, mois par mois, vacances comprises. Versé par la régie: ce qui arrive réellement sur ton compte, après ses retenues (charges PPE, honoraires, impôts fonciers, entretien). Le détail brut → net n’est disponible qu’à titre de référence, pour la période du dernier décompte reçu (second semestre 2025). Payé par toi: intérêts, travaux et charges réglées directement. Rien n’est estimé: un mois sans versement compte pour zéro.</p>
                {bienNames.length === 0 ? <p className="muted small">Ajoute tes biens dans Documents, « Mes biens ».</p> : null}
              </section>
            );
          })() : null}
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
              <li key={r.re ?? r.key}>
                <span className="name">{r.name}<span className="muted small"> · {(r.re ?? r.key ?? '').replace(/\\(.)/g, '$1')}{r.category ? ` · ${LABEL[r.category] ?? r.category}` : ''}</span></span>
                <button className="btn small" onClick={() => removeFournisseur((r.re ?? r.key) as string)} aria-label={`Retirer ${r.name}`}>Retirer</button>
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

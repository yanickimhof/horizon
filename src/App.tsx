import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { CircleCheck, Eye, Hourglass, Info, LayoutDashboard, EyeOff, Sunrise, Wallet, FlaskConical, FolderUp, List, MessageCircle, Palette, ShieldCheck, Target, UserRound } from 'lucide-react';
import { api, setActiveCase, type CaseId, type Db, type State } from './api';
import { PALETTES, paletteCss } from './palettes';
import { Logo } from './components/Logo';
import { Accueil } from './views/Accueil';
import { Budget } from './views/Budget';
import { Horizons } from './views/Horizons';
import { Summary } from './views/Summary';
import { Retraite } from './views/Retraite';
import { Inbox } from './views/Inbox';
import { Data } from './views/Data';
import { Import } from './views/Import';
import { Coach } from './views/Coach';
import { Privacy } from './views/Privacy';
import { About } from './views/About';

type Tab = 'budget' | 'accueil' | 'horizons' | 'retraite' | 'summary' | 'inbox' | 'data' | 'import' | 'coach' | 'privacy' | 'about';

const read = <T extends string>(k: string, d: T): T => {
  try {
    return (localStorage.getItem(k) as T) || d;
  } catch {
    return d;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* stockage indisponible */
  }
};

const ICON = { size: 20, strokeWidth: 1.5 } as const;

export function App() {
  const [db, setDb] = useState<Db>(read('horizon.db', 'demo'));
  const [palette, setPalette] = useState<string>(read('horizon.palette', 'ocean'));
  const [caseId, setCaseId] = useState<CaseId>('base');
  const [hidden, setHiddenState] = useState<string[]>(() => { try { return JSON.parse(read('horizon.hidden', '["horizons","summary","accueil","retraite"]')) as string[]; } catch { return []; } });
  const [home, setHomeState] = useState<Tab>(read('horizon.home', 'budget'));
  const setHidden = (h: string[]) => { write('horizon.hidden', JSON.stringify(h)); setHiddenState(h); };
  const setHome = (h: Tab) => { write('horizon.home', h); setHomeState(h); };
  const [tab, setTab] = useState<Tab>(read('horizon.home', 'budget'));
  const [reveal, setReveal] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [state, setState] = useState<State | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    document.documentElement.dataset.palette = palette;
    write('horizon.palette', palette);
  }, [palette]);

  const load = useCallback(async () => {
    setActiveCase(caseId);
    try {
      setState(await api.state(db));
      setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [db, caseId]);

  useEffect(() => {
    load();
  }, [load]);

  const switchDb = (d: Db) => {
    write('horizon.db', d);
    setState(null);
    setDb(d);
    setTab(home);
  };

  const act = async (route: string, body: unknown) => {
    try {
      setState(await api.post(db, route, body));
      setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const tabs: { id: Tab; label: string; icon: ReactElement; badge?: number }[] = [
    { id: 'budget', label: 'Budget', icon: <Wallet {...ICON} /> },
    { id: 'accueil', label: 'Retraite', icon: <Sunrise {...ICON} /> },
    { id: 'horizons', label: 'Horizons', icon: <Target {...ICON} /> },
    { id: 'retraite', label: 'Scénarios', icon: <Hourglass {...ICON} /> },
    { id: 'summary', label: 'Patrimoine', icon: <LayoutDashboard {...ICON} /> },
    { id: 'inbox', label: 'À valider', icon: <CircleCheck {...ICON} />, badge: state?.inbox.length },
    { id: 'data', label: 'Données', icon: <List {...ICON} /> },
    ...(state?.access.remote ? [] : [{ id: 'import' as Tab, label: 'Importer', icon: <FolderUp {...ICON} /> }]),
    { id: 'coach', label: 'Coach', icon: <MessageCircle {...ICON} /> },
    { id: 'privacy', label: 'Confidentialité', icon: <ShieldCheck {...ICON} /> },
    { id: 'about', label: 'À propos', icon: <Info {...ICON} /> },
  ];

  // « À valider » n'apparaît que s'il y a quelque chose à valider; Budget, Données et Coach restent toujours visibles.
  const shown = tabs.filter((x) => (x.id === 'inbox' ? (x.badge ?? 0) > 0 || x.id === tab : !hidden.includes(x.id) || x.id === tab || x.id === 'coach'));
  return (
    <div className="app">
      <style>{paletteCss()}</style>
      <header className="top">
        <div className="brand"><Logo size={24} /><span>Horizon</span></div>
        <nav className="seg icons" aria-label="Sections">
          {shown.map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} aria-label={t.label} title={t.label} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
              {t.icon}
              {t.badge ? <span className="badge" aria-label={`${t.badge} à valider`}>{t.badge}</span> : null}
            </button>
          ))}
        </nav>
        <div className="tools">
          {db === 'demo' ? (
            <div className="seg icons small" role="group" aria-label="Jeu de données">
              <button className="on" aria-label="Exemple" title="Exemple" onClick={() => switchDb('demo')}><FlaskConical size={18} strokeWidth={1.5} /></button>
              <button aria-label="Mes données" title="Mes données" onClick={() => switchDb('real')}><UserRound size={18} strokeWidth={1.5} /></button>
            </div>
          ) : null}
          <button className={'icon-btn' + (reveal ? ' on' : '')} aria-pressed={reveal} aria-label={reveal ? 'Masquer les montants' : 'Afficher les montants'} title={reveal ? 'Masquer les montants' : 'Afficher les montants'} onClick={() => setReveal(!reveal)}>
            {reveal ? <Eye {...ICON} /> : <EyeOff {...ICON} />}
          </button>
          <div className="pal-wrap">
            <button className={'icon-btn' + (paletteOpen ? ' on' : '')} aria-label="Palette de couleurs" aria-expanded={paletteOpen} title="Palette de couleurs" onClick={() => setPaletteOpen(!paletteOpen)}>
              <Palette {...ICON} />
            </button>
            {paletteOpen && (
              <div className="pal-pop" role="menu" aria-label="Palettes">
                {PALETTES.map((p) => (
                  <button key={p.id} role="menuitemradio" aria-checked={palette === p.id} aria-label={p.name} title={p.name} className={'pal-opt' + (palette === p.id ? ' on' : '')} onClick={() => { setPalette(p.id); setPaletteOpen(false); }}>
                    {p.light.map((c) => <i key={c} style={{ background: c }} />)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <main>
        {err && <p className="error" role="alert">{err}</p>}
        {!state ? (
          <p className="muted center">Chargement…</p>
        ) : state.empty ? (
          <Welcome act={act} switchDb={switchDb} />
        ) : tab === 'budget' ? (
          <Budget db={db} state={state} setState={setState} reveal={reveal} />
        ) : tab === 'accueil' ? (
          <Accueil state={state} caseId={caseId} reveal={reveal} act={act} goto={(t) => setTab(t as Tab)} />
        ) : tab === 'horizons' ? (
          <Horizons state={state} caseId={caseId} setCase={setCaseId} goto={(t) => setTab(t as Tab)} />
        ) : tab === 'retraite' ? (
          <Retraite state={state} caseId={caseId} setCase={setCaseId} reveal={reveal} />
        ) : tab === 'summary' ? (
          <Summary state={state} reveal={reveal} />
        ) : tab === 'inbox' ? (
          <Inbox items={state.inbox} act={act} reveal={reveal} />
        ) : tab === 'data' ? (
          <Data db={db} state={state} setState={setState} act={act} reveal={reveal} />
        ) : tab === 'import' ? (
          <Import db={db} state={state} setState={setState} reveal={reveal} goto={(t) => setTab(t as Tab)} />
        ) : tab === 'coach' ? (
          <Coach db={db} state={state} />
        ) : tab === 'about' ? (
          <About state={state} goto={(t) => setTab(t as Tab)} hidden={hidden} setHidden={setHidden} home={home} setHome={(h) => setHome(h as Tab)} />
        ) : (
          <Privacy db={db} state={state} act={act} />
        )}
      </main>

      <footer className="foot">Aide à la réflexion, pas un conseil en placement. Valeurs standard et hypothèses indicatives.</footer>
    </div>
  );
}

function Welcome({ act, switchDb }: { act: (r: string, b: unknown) => Promise<void>; switchDb: (d: Db) => void }) {
  const [f, setF] = useState({ name: '', adults: 1, children: 0, owner: false, birthYear: 1980, monthlyIncome: '' });
  return (
    <div className="page narrow">
      <h1>Commençons par ton foyer</h1>
      <p className="lede">Quelques réponses suffisent. Le reste est estimé avec des valeurs standard, marquées comme telles, que tu corriges au fil des documents.</p>
      <div className="form">
        <label>Prénom ou nom du foyer<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>Adultes<input type="number" min={1} value={f.adults} onChange={(e) => setF({ ...f, adults: Number(e.target.value) })} /></label>
        <label>Enfants<input type="number" min={0} value={f.children} onChange={(e) => setF({ ...f, children: Number(e.target.value) })} /></label>
        <label>Année de naissance<input type="number" value={f.birthYear} onChange={(e) => setF({ ...f, birthYear: Number(e.target.value) })} /></label>
        <label>Revenu net mensuel du foyer (CHF)<input type="number" value={f.monthlyIncome} onChange={(e) => setF({ ...f, monthlyIncome: e.target.value })} placeholder="Approximatif" /></label>
        <label className="check"><input type="checkbox" checked={f.owner} onChange={(e) => setF({ ...f, owner: e.target.checked })} />Propriétaire de mon logement</label>
        <div className="actions">
          <button className="btn primary" onClick={() => act('bootstrap', { ...f, monthlyIncome: Number(f.monthlyIncome) || 0 })}>Créer mon profil</button>
          <button className="btn ghost" onClick={() => switchDb('demo')}>Explorer l’exemple</button>
        </div>
      </div>
    </div>
  );
}

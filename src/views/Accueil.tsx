import { useMemo, useState } from 'react';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { fmt, type CaseId, type State } from '../api';
import { CASES } from '../engine/assumptions';
import { assess, DEFAULT_PARAMS, isTaxLine, retirementMode, UNEMPLOYMENT_NET_MONTHLY, type RetirementParams, type YearRow } from '../engine/retirement';
import { robustness } from '../engine/sensitivity';
import { Retraits } from './Retraits';
import type { RetirementMode } from '../engine/types';
import '../accueil.css';

const shortName = (label: string) => label.replace(/^PPE\s+/i, '');
const nearest = (rows: YearRow[], a: number): YearRow => rows.reduce((best, r) => (Math.abs(r.age - a) < Math.abs(best.age - a) ? r : best), rows[0]);

const MODES: { id: RetirementMode; label: string }[] = [
  { id: 'gone', label: 'Disparaît' },
  { id: 'lower', label: 'Baisse' },
  { id: 'same', label: 'Pareil' },
  { id: 'higher', label: 'Hausse' },
];

type Level = 'ok' | 'fragile' | 'sales' | 'short';

/** Un soleil qui se lève: haut (OK), à mi-hauteur (fragile ou avec vente), sous l'horizon (pas OK). */
function Sun({ level }: { level: Level }) {
  const cy = level === 'ok' ? 46 : level === 'short' ? 92 : 66;
  const tone = level === 'ok' ? 'var(--pos)' : level === 'short' ? 'var(--neg)' : 'var(--warn-ink)';
  return (
    <svg viewBox="0 0 160 120" className="sun" role="img" aria-label={level === 'ok' ? 'Le soleil est levé' : level === 'short' ? 'Le soleil reste sous l’horizon' : 'Le soleil se lève'}>
      <defs>
        <clipPath id="sky"><rect x="0" y="0" width="160" height="84" /></clipPath>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={tone} stopOpacity="0.28" />
          <stop offset="100%" stopColor={tone} stopOpacity="0" />
        </radialGradient>
      </defs>
      <g clipPath="url(#sky)">
        <circle cx="80" cy={cy} r="52" fill="url(#glow)" />
        <circle cx="80" cy={cy} r="24" fill={tone} />
      </g>
      <line x1="10" y1="84" x2="150" y2="84" stroke="var(--line)" strokeWidth="1.5" />
      <line x1="30" y1="96" x2="130" y2="96" stroke="var(--line)" strokeWidth="1" opacity="0.6" />
      <line x1="52" y1="107" x2="108" y2="107" stroke="var(--line)" strokeWidth="1" opacity="0.35" />
    </svg>
  );
}

/**
 * Accueil: une réponse, puis trois blocs. Ce qu'il te faut par mois à la retraite, ce qui rentre sans travailler,
 * et ce que tu as de côté. Les montants suivent le bouton œil; les pourcentages restent visibles.
 */
export function Accueil({ state, caseId, reveal, act, goto }: { state: State; caseId: CaseId; reveal: boolean; act: (route: string, body: unknown) => Promise<void>; goto: (tab: string) => void }) {
  const snap = state.snapshot;
  const money = (n: number) => (reveal ? fmt.money(n) : '••••');
  const retireAge = snap.household.retirementAge || 65;
  const params: RetirementParams = useMemo(() => ({ ...DEFAULT_PARAMS, retireAge, unemploymentBenefit: UNEMPLOYMENT_NET_MONTHLY }), [retireAge]);
  const as = CASES[caseId].assumptions;
  const a = useMemo(() => assess(snap, params, as), [snap, params, as]);
  const rob = useMemo(() => robustness(snap, params, as), [snap, params, as]);
  const [open, setOpen] = useState(false);
  const endAge = params.endAge;

  const run = a.verdict === 'ok' ? a.noSale : a.withSales;
  const first = nearest(run.rows, retireAge + 1);
  const late = nearest(run.rows, Math.max(retireAge + 5, 70));
  const need = first.spending;
  const incomeFirst = first.income;
  const incomeLate = late.income;
  const reserves = nearest(run.rows, retireAge).liquid;
  const gap = Math.max(0, need - incomeFirst);
  const draw = reserves > 0 ? (gap * 12) / reserves : null;
  const coverage = need > 0 ? Math.min(1, incomeFirst / need) : 0;

  const worstAssess = useMemo(() => assess(snap, params, CASES.worst.assumptions), [snap, params]);
  // Fragile: peu de marge, ou une décennie difficile autour de la retraite oblige à vendre un bien ou ne suffit pas même en vendant.
  const fragile = a.verdict === 'ok' && (worstAssess.verdict !== 'ok' || rob.margin < 0.1);
  const level: Level = a.verdict === 'ok' ? (fragile ? 'fragile' : 'ok') : a.verdict;
  const word = { ok: 'OK', fragile: 'OK, mais fragile', sales: 'OK en vendant un bien', short: 'Pas OK' }[level];
  const brokeAge = Math.round(a.withSales.brokeAge ?? a.noSale.liquidityEndsAge ?? endAge);
  const why = {
    ok: `Tes revenus de retraite couvrent ${fmt.pct(coverage)} de ce qu’il te faut. Le reste vient de tes réserves, qui tiennent jusqu’à ${endAge} ans, même dans le pire cas.`,
    fragile: `Tes revenus de retraite couvrent ${fmt.pct(coverage)} de ce qu’il te faut et tes réserves tiennent jusqu’à ${endAge} ans. ${rob.margin < 0.1 ? 'Il reste très peu de marge sur le budget.' : worstAssess.verdict === 'sales' ? `Si une décennie difficile tombe autour de ta retraite (de 60 à 70 ans), il faudrait vendre ${worstAssess.withSales.sold.map((x) => shortName(x.label)).join(', ')}.` : 'Si une décennie difficile tombe autour de ta retraite (de 60 à 70 ans), même la vente de tous les biens ne suffirait pas.'}`,
    sales: `Sans vente, tes liquidités s’épuisent vers ${Math.round(a.noSale.liquidityEndsAge ?? endAge)} ans. Vendre ${a.withSales.sold.map((s) => shortName(s.label)).join(', ')} comble le manque.`,
    short: `Même en vendant tous les biens, il manque de l’argent vers ${brokeAge} ans. Il faut baisser les dépenses ou retarder le départ.`,
  }[level];

  const lines = useMemo(
    () => snap.expenses.filter((e) => !e.lump && e.monthly > 0).sort((p, q) => q.monthly - p.monthly),
    [snap.expenses],
  );
  const setMode = (key: string, mode: RetirementMode) => act('correct', { key, patch: { retirement: mode }, why: 'Choix pour la retraite' });

  return (
    <div className="page wide home">
      <section className={'hero-card ' + level}>
        <Sun level={level} />
        <div className="hero-text">
          <p className="kicker">Retraite à {retireAge} ans</p>
          <h1>{word}</h1>
          <p className="lede">{why}</p>
        </div>
      </section>

      <div className="three">
        <section className="tile">
          <h2>Il te faut</h2>
          <p className="big">{money(need)}</p>
          <p className="unit">par mois, impôts compris</p>
        </section>
        <section className="tile">
          <h2>Ça rentre</h2>
          <p className="big">{money(incomeFirst)}</p>
          <p className="unit">par mois sans travailler{incomeLate > incomeFirst + 1 ? `, ${money(incomeLate)} dès ${Math.round(late.age)} ans` : ''}</p>
          <div className="meter" aria-label={`Couverture ${fmt.pct(coverage)}`}><i style={{ width: `${coverage * 100}%` }} /></div>
        </section>
        <section className="tile">
          <h2>Tu as de côté</h2>
          <p className="big">{money(reserves)}</p>
          <p className="unit">à {retireAge} ans{draw === null ? '' : `, tu en utilises ${(draw * 100).toFixed(1).replace('.', ',')} % par an`}</p>
        </section>
      </div>

      <section className="tile">
        <button className="fold" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span>Ce qui change à la retraite</span>
          <ChevronDown size={18} strokeWidth={1.5} className={open ? 'up' : ''} />
        </button>
        {open ? (
          <ul className="changes">
            {lines.map((e) => {
              const mode = retirementMode(e);
              return (
                <li key={e.key}>
                  <span className="name">{e.label}</span>
                  <span className="amt">{money(e.monthly)}</span>
                  {isTaxLine(e) ? <span className="muted small">Recalculé à part</span> : <span className="seg" role="group" aria-label={`À la retraite: ${e.label}`}>
                    {MODES.map((m) => (
                      <button key={m.id} className={mode === m.id ? 'on' : ''} aria-pressed={mode === m.id} onClick={() => mode !== m.id && setMode(e.key, m.id)}>{m.label}</button>
                    ))}
                  </span>}
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      <Retraits snap={snap} as={as} retireAge={retireAge} reveal={reveal} />

      <div className="links">
        <button className="link" onClick={() => goto('retraite')}>Tester un scénario <ArrowRight size={16} strokeWidth={1.5} /></button>
      </div>
    </div>
  );
}

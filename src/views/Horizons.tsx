import { useState, type ReactElement } from 'react';
import { Bitcoin, Coins, Flag, Flame, House, Lightbulb, Minus, Percent, RotateCcw, TrendingDown, TrendingUp } from 'lucide-react';
import { fmt, RING_LABELS, type CaseId, type State } from '../api';
import { GROUPS, Rings } from '../components/Rings';

const I = { size: 20, strokeWidth: 1.5 } as const;

const SHOCK_ICON: Record<string, ReactElement> = {
  base: <RotateCcw {...I} />,
  krach: <TrendingDown {...I} />,
  crypto: <Bitcoin {...I} />,
  immobilier: <House {...I} />,
  taux: <Percent {...I} />,
  inflation: <Flame {...I} />,
  'franc-fort': <Coins {...I} />,
};

const CASE_ICON: Record<CaseId, ReactElement> = {
  worst: <TrendingDown {...I} />,
  base: <Minus {...I} />,
  best: <TrendingUp {...I} />,
};

export function Horizons({ state, caseId, setCase, goto }: { state: State; caseId: CaseId; setCase: (c: CaseId) => void; goto: (tab: string) => void }) {
  const [scenarioId, setScenarioId] = useState<string>('base');
  const [hl, setHl] = useState<number | null>(null);
  const scenario = state.scenarios.find((s) => s.id === scenarioId);
  const rings = scenario ? scenario.rings : state.rings;
  const runway = scenario ? scenario.runway : state.runway;
  const weakIdx = rings.findIndex((r) => r.coverage < 0.95);
  const shockLabel = scenario?.label ?? 'Aujourd’hui';
  const range = { worst: state.cases.worst.rings, best: state.cases.best.rings };

  const noSpending = !state.snapshot.expenses.some((e) => e.monthly > 0 || e.lump);
  const title = noSpending ? 'Il manque tes dépenses' : runway === null ? 'Tes revenus suffisent' : `Tu tiens ${fmt.months(runway)}`;
  const sub = noSpending ? 'Sans dépenses, il n’y a rien à couvrir: les anneaux restent vides' : weakIdx === -1 ? 'Tous les horizons sont couverts' : `À ${RING_LABELS[weakIdx]}, ${fmt.pct(rings[weakIdx].coverage)} de ton niveau de vie est couvert`;
  const runwayDelta = scenario && scenario.runway !== null && state.runway !== null ? scenario.runway - state.runway : null;

  return (
    <div className="horizons">
      <section className="hero">
        <h1>{title}</h1>
        <p className="lede">{noSpending ? '' : 'sans salaire. '}{sub}.</p>
        {noSpending && (
          <div className="actions">
            <button className="btn primary" onClick={() => goto('data')}>Saisir mes dépenses</button>
            <button className="btn ghost" onClick={() => goto('import')}>Les lire dans mes relevés</button>
          </div>
        )}
        {scenario && (
          <p className="lede-2">
            {scenario.summary}
            {runwayDelta !== null && runwayDelta !== 0 ? ` Tenue: ${runwayDelta > 0 ? '+' : '−'}${Math.abs(runwayDelta)} mois.` : ''}
          </p>
        )}
      </section>

      <div className="stage">
        <Rings rings={rings} base={state.rings} range={range} goals={state.goals} centerTop={runway === null ? '∞' : fmt.months(runway)} centerBottom="sans salaire" highlight={hl} onHighlight={setHl} />

        <div className="readout">
          {rings.map((r, i) => {
            const delta = scenario ? Math.round((r.coverage - state.rings[i].coverage) * 100) : 0;
            const lo = Math.round(state.cases.worst.rings[i].coverage * 100);
            const hi = Math.round(state.cases.best.rings[i].coverage * 100);
            const parts = GROUPS.map((g) => ({
              label: g.label,
              v: r.segments.filter((s) => (g.classes as readonly string[]).includes(s.class)).reduce((a, s) => a + s.share, 0),
            })).filter((p) => p.v >= 0.01);
            return (
              <div key={i} className={'readout-row' + (hl === i ? ' on' : '')} onMouseEnter={() => setHl(i)} onMouseLeave={() => setHl(null)}>
                <div className="readout-head">
                  <span className="readout-ring">{RING_LABELS[i]}</span>
                  <span className="readout-pct">
                    {fmt.pct(r.coverage)}
                    {delta !== 0 && <span className={'delta ' + (delta < 0 ? 'neg' : 'pos')}>{delta < 0 ? '−' : '+'}{Math.abs(delta)}</span>}
                  </span>
                </div>
                <div className="readout-sources">
                  {hi - lo >= 2 && <span title="Du pire au meilleur cas">{lo} à {hi}&#8239;% selon le cas. </span>}
                  {parts.length === 0 ? 'Aucune source mobilisable' : parts.map((p) => `${p.label} ${fmt.pct(p.v)}`).join(', ')}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <ul className="legend" aria-label="Légende">
        {GROUPS.map((g) => (
          <li key={g.key}>
            <span className={'swatch sw-' + g.key} aria-hidden="true" />
            {g.label}
          </li>
        ))}
        <li><span className="swatch-circle" aria-hidden="true" />Projet</li>
        <li><span className="swatch-range" aria-hidden="true" />Pire à meilleur cas</li>
      </ul>

      <div className="controls">
        <div className="seg icons" role="group" aria-label="Cas">
          {(['worst', 'base', 'best'] as CaseId[]).map((c) => (
            <button key={c} className={caseId === c ? 'on' : ''} aria-pressed={caseId === c} aria-label={state.cases[c].label} title={`${state.cases[c].label}: ${state.cases[c].summary}`} onClick={() => setCase(c)}>
              {CASE_ICON[c]}
            </button>
          ))}
        </div>
        <div className="shocks" role="group" aria-label="Choc à simuler">
          {[{ id: 'base', label: 'Aujourd’hui' }, ...state.scenarios].map((s) => (
            <button key={s.id} className={'round' + (scenarioId === s.id ? ' on' : '')} aria-pressed={scenarioId === s.id} aria-label={s.label} title={s.label} onClick={() => setScenarioId(s.id)}>
              {SHOCK_ICON[s.id] ?? <TrendingDown {...I} />}
            </button>
          ))}
        </div>
      </div>
      <p className="caption" aria-live="polite">
        {state.cases[caseId].label}
        {scenario ? `, ${shockLabel.toLowerCase()}` : ''}
      </p>

      {state.goals.length > 0 && (
        <details className="fold">
          <summary><Flag size={18} strokeWidth={1.5} aria-hidden="true" /><span>Projets</span><em>{state.goals.length}</em></summary>
          <ul className="list">
            {state.goals.map((g) => (
              <li key={g.key} className="row">
                <div className="row-main">
                  <div className="row-title">{g.label}</div>
                  <div className="row-sub">Horizon {RING_LABELS[g.ringIndex]}, environ {g.costInMonthsOfLife.toFixed(1).replace('.', ',')} mois de vie</div>
                </div>
                <div className="meter" role="img" aria-label={`Financé à ${fmt.pct(g.funded)}`}><span style={{ width: `${Math.round(g.funded * 100)}%` }} /></div>
                <div className="row-end">{fmt.pct(g.funded)}</div>
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="fold" open={state.gaps.some((g) => g.id === 'rates')}>
        <summary>
          <Lightbulb size={18} strokeWidth={1.5} aria-hidden="true" /><span>Pour affiner</span><em>{state.gaps.length}</em>
          <span className="reliab" title="Part des chiffres confirmés plutôt que supposés">
            <span className="meter small" aria-hidden="true"><span style={{ width: `${Math.round(state.reliability.score * 100)}%` }} /></span>
            {fmt.pct(state.reliability.score)}
          </span>
        </summary>
        {state.gaps.length === 0 ? (
          <p className="muted">Rien d’important ne manque.</p>
        ) : (
          <ul className="list">
            {state.gaps.slice(0, 5).map((g) => (
              <li key={g.id} className="row stack">
                <div className="row-title">{g.title}</div>
                <div className="row-sub">{g.why}</div>
                <div className="row-ask">{g.ask}</div>
              </li>
            ))}
          </ul>
        )}
        <div className="actions">
          <button className="btn" onClick={() => goto('import')}>Importer des documents</button>
          <button className="btn ghost" onClick={() => goto('coach')}>En parler au coach</button>
        </div>
      </details>

      <details className="assumptions">
        <summary>Hypothèses</summary>
        <ul>
          <li>{state.cases[caseId].summary} Croissances réelles par classe d’actifs, en francs d’aujourd’hui. Valeurs indicatives, à discuter.</li>
          <li>Les anneaux montrent la part du niveau de vie couverte si le salaire s’arrête, après les revenus qui continuent (loyers, rentes).</li>
          <li>Tout est converti en francs au dernier cours connu{state.stale.length ? `. Cours à mettre à jour: ${state.stale.join(', ')}` : ''}.</li>
          <li>Immobilier mobilisable après 5 ans, dette garantie déduite. Prévoyance mobilisable selon le type de compte (LPP à la retraite, 3a cinq ans avant, 401(k) à 59 ans et demi), avec une estimation de l’impôt à la sortie.</li>
          <li>Les situations de vie (études, grosse dépense, enfant à charge) comptent aux dates indiquées. Saisis ta rente AVS, LPP ou américaine comme « Rente à la retraite » pour qu’elle compte dès l’âge choisi.</li>
          <li>{state.reliability.weakest.length ? `Valeurs supposées qui pèsent le plus: ${state.reliability.weakest.join(', ')}.` : 'Toutes les valeurs importantes sont confirmées.'}</li>
        </ul>
      </details>
    </div>
  );
}

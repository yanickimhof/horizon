import { useMemo, useState, type ReactNode } from 'react';
import { fmt, type CaseId, type State } from '../api';
import { CASES } from '../engine/assumptions';
import { COUNTRY } from '../engine/country';
import { assess, DEFAULT_PARAMS, properties, UNEMPLOYMENT_NET_MONTHLY, type RetirementEvent, type RetirementParams, type YearRow } from '../engine/retirement';
import { robustness } from '../engine/sensitivity';
import { Solidity } from './Solidity';
import '../retraite.css';
import '../solidity.css';

const CASE_IDS: CaseId[] = ['worst', 'base', 'best'];
const age = (a: number) => `${Math.round(a)} ans`;
const nearest = (rows: YearRow[], a: number): YearRow | undefined => rows.reduce<YearRow | undefined>((best, r) => (best === undefined || Math.abs(r.age - a) < Math.abs(best.age - a) ? r : best), undefined);
const shortName = (label: string) => label.replace(/^PPE\s+/i, '').replace(/^Résidence principale \(PPE (.+)\)$/i, '$1 (résidence)');

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={'switch' + (on ? ' on' : '')} onClick={() => onChange(!on)}>
      <i />
    </button>
  );
}

function Stepper({ value, min, max, step = 1, unit, onChange, label }: { value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void; label: string }) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v * 100) / 100)));
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label="Diminuer" disabled={value <= min} onClick={() => set(value - step)}>−</button>
      <output>{value}{unit ? ` ${unit}` : ''}</output>
      <button type="button" aria-label="Augmenter" disabled={value >= max} onClick={() => set(value + step)}>+</button>
    </span>
  );
}

function Group({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="group">
      <header><h2>{title}</h2>{action}</header>
      <div className="group-body">{children}</div>
    </section>
  );
}

function Line({ title, sub, children, below }: { title: ReactNode; sub?: ReactNode; children?: ReactNode; below?: ReactNode }) {
  return (
    <div className="line">
      <div className="line-top">
        <div className="line-main">
          <div className="line-title">{title}</div>
          {sub ? <div className="line-sub">{sub}</div> : null}
        </div>
        <div className="line-end">{children}</div>
      </div>
      {below ? <div className="line-below">{below}</div> : null}
    </div>
  );
}

/**
 * Retraite: aura-t-on assez, et que change une vente, une hausse des taux ou un arrêt du salaire?
 * Tout est calculé dans le navigateur à partir de l'instantané: les réglages répondent tout de suite.
 * Les montants suivent le bouton œil (masqués par défaut), les proportions et les durées restent visibles.
 */
export function Retraite({ state, caseId, setCase, reveal }: { state: State; caseId: CaseId; setCase: (c: CaseId) => void; reveal: boolean }) {
  const snap = state.snapshot;
  const props = useMemo(() => properties(snap), [snap]);
  const defaultAge = snap.household.retirementAge || 65;
  const nowAge = Math.round(new Date(snap.asOf).getFullYear() - snap.household.birthYear);
  const [retireAge, setRetireAge] = useState(defaultAge);
  const [budgetText, setBudgetText] = useState('');
  const [rate, setRate] = useState(0);
  const [vacancy, setVacancy] = useState(Math.round(COUNTRY.tax.vacancyRate * 100));
  const [loss, setLoss] = useState(0);
  const [unemp, setUnemp] = useState(true);
  const [rollover, setRollover] = useState(false);
  const [sellOn, setSellOn] = useState<Record<string, boolean>>({});
  const [sellAge, setSellAge] = useState<Record<string, number>>({});
  const [hover, setHover] = useState<number | null>(null);

  const money = (n: number) => (reveal ? fmt.money(n) : '••••');
  const budgetNum = Number(budgetText.replace(/[^\d.]/g, ''));
  const params: RetirementParams = {
    ...DEFAULT_PARAMS,
    retireAge,
    monthlyBudget: budgetText.trim() !== '' && budgetNum > 0 ? budgetNum : null,
    rateShock: rate / 100,
    vacancyRate: vacancy / 100,
    salaryLossMonths: loss,
    unemploymentBenefit: unemp ? UNEMPLOYMENT_NET_MONTHLY : 0,
    rollover401k: rollover,
    sales: props.filter((p) => sellOn[p.asset.key]).map((p) => ({ key: p.asset.key, age: sellAge[p.asset.key] ?? retireAge })),
  };
  const a = useMemo(() => assess(snap, params, CASES[caseId].assumptions), [snap, caseId, retireAge, budgetText, rate, vacancy, loss, unemp, rollover, sellOn, sellAge]); // eslint-disable-line react-hooks/exhaustive-deps
  const rob = useMemo(() => robustness(snap, params, CASES[caseId].assumptions), [snap, caseId, retireAge, budgetText, rate, vacancy, loss, unemp, rollover, sellOn, sellAge]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = a.verdict === 'ok' ? a.noSale : a.withSales;
  const endAge = params.endAge;
  const atRetire = nearest(run.rows, retireAge + 1);
  const late = nearest(run.rows, retireAge + 4);
  const coverage = late && late.spending > 0 ? late.income / late.spending : null;
  const sold = a.withSales.sold;
  const anySale = props.some((p) => sellOn[p.asset.key]);
  const soldHome = sold.some((s) => props.find((p) => p.asset.key === s.key)?.asset.subtype === 'home');
  const changed = retireAge !== defaultAge || budgetText !== '' || rate > 0 || vacancy !== Math.round(COUNTRY.tax.vacancyRate * 100) || loss > 0 || rollover || anySale;

  let title: string;
  let lede: string;
  if (a.verdict === 'ok') {
    title = `Oui, tu tiens jusqu’à ${endAge} ans`;
    lede = `Départ à ${retireAge} ans, sans vendre de bien d’office. Les liquidités ne tombent jamais sous zéro.`;
  } else if (a.verdict === 'sales') {
    title = `Oui, en vendant ${sold.length > 1 ? `${sold.length} biens` : 'un bien'}`;
    lede = `Les liquidités s’épuisent vers ${age(a.noSale.liquidityEndsAge ?? endAge)}. ${sold.map((s) => `${shortName(s.label)} à ${age(s.age)}`).join(', ')} comble le manque jusqu’à ${endAge} ans.`;
  } else {
    title = `Non, il manque de l’argent vers ${age(a.withSales.brokeAge ?? a.noSale.liquidityEndsAge ?? endAge)}`;
    lede = `Même en vendant tous les biens, le budget n’est pas tenu jusqu’à ${endAge} ans. Baisse le budget, retarde le départ ou change d’hypothèse.`;
  }

  const pick = (list: typeof props) => {
    setSellOn(Object.fromEntries(list.map((p) => [p.asset.key, true])));
    setSellAge(Object.fromEntries(props.map((p) => [p.asset.key, sellAge[p.asset.key] ?? retireAge])));
  };

  const reset = () => {
    setRetireAge(defaultAge);
    setBudgetText('');
    setRate(0);
    setVacancy(Math.round(COUNTRY.tax.vacancyRate * 100));
    setLoss(0);
    setUnemp(true);
    setRollover(false);
    setSellOn({});
    setSellAge({});
  };

  const row = hover !== null ? run.rows[hover] : undefined;
  const metrics = [
    { label: 'Tenue', value: a.verdict === 'ok' ? `${endAge} ans` : age(a.noSale.liquidityEndsAge ?? endAge), note: a.verdict === 'ok' ? 'sans vendre' : 'liquidités épuisées' },
    { label: `Liquidités à ${retireAge} ans`, value: atRetire ? money(atRetire.liquid) : 'n.c.', note: 'prévoyance versée, impôt déduit' },
    { label: 'Revenus sur dépenses', value: coverage === null ? 'n.c.' : fmt.pct(coverage), note: `à ${retireAge + 4} ans, par mois` },
    { label: 'Marge de budget', value: `${rob.margin >= 0 ? '+' : '−'}${Math.abs(Math.round(rob.margin * 100))} %`, note: `budget maximal ${money(rob.breakEven)}` },
  ];

  return (
    <div className="page wide retraite">
      <section className="hero">
        <h1>{title}</h1>
        <p className="lede">{lede}</p>
      </section>

      <div className="ret-bar">
        <div className="seg" role="group" aria-label="Cas">
          {CASE_IDS.map((c) => (
            <button key={c} className={caseId === c ? 'on' : ''} aria-pressed={caseId === c} title={state.cases[c].summary} onClick={() => setCase(c)}>
              {state.cases[c].label}
            </button>
          ))}
        </div>
        {changed && <button className="btn ghost small" onClick={reset}>Revenir à ma situation</button>}
      </div>

      <dl className="metrics">
        {metrics.map((m) => (
          <div key={m.label} className="metric">
            <dt>{m.label}</dt>
            <dd>{m.value}</dd>
            <span>{m.note}</span>
          </div>
        ))}
      </dl>

      <section className="panel">
        <Chart rows={run.rows} events={run.events} retireAge={retireAge} reveal={reveal} hover={hover} setHover={setHover} mode="liquid" H={250} label="Liquidités et prévoyance par âge" />
        <Chart rows={run.rows} events={[]} retireAge={retireAge} reveal={reveal} hover={hover} setHover={setHover} mode="property" H={64} label="Immobilier net de dette par âge" />
        <p className="chart-read" aria-live="polite">
          {row
            ? `${age(row.age)}, ${row.year}. Liquidités ${money(row.liquid)}, prévoyance ${money(row.pensions)}, immobilier net ${money(row.realEstate)}. Revenus ${money(row.income)}, dépenses ${money(row.spending)} par mois.`
            : 'Survole le graphique pour lire une année.'}
        </p>
        <ul className="legend" aria-label="Légende">
          <li><span className="swatch sw-cash" aria-hidden="true" />Liquidités</li>
          <li><span className="swatch sw-pension" aria-hidden="true" />Prévoyance avant versement</li>
          <li><span className="swatch sw-real_estate" aria-hidden="true" />Immobilier net de dette, en bas</li>
          <li><span className="swatch sw-neg" aria-hidden="true" />Manque de liquidités</li>
        </ul>
      </section>

      <Solidity rob={rob} reveal={reveal} />

      <div className="ret-cols">
        <div className="ret-col">
          <Group title="Retraite">
            <Line title="Âge de départ" sub={`${snap.household.birthYear + retireAge}`}>
              <Stepper label="Âge de départ" value={retireAge} min={58} max={70} unit="ans" onChange={setRetireAge} />
            </Line>
            <Line title="Budget par mois" sub={budgetText.trim() === '' ? 'Dépenses actuelles hors impôts et études' : undefined}>
              <span className="field">
                <input inputMode="numeric" aria-label="Budget de retraite par mois" value={budgetText} placeholder={reveal ? String(Math.round(a.noSale.budget)) : '••••'} onChange={(e) => setBudgetText(e.target.value)} />
                <em>CHF</em>
              </span>
            </Line>
          </Group>

          <Group title="Chocs">
            <Line title="Hausse des taux" sub="Points ajoutés aux dettes variables">
              <Stepper label="Hausse des taux" value={rate} min={0} max={10} step={0.25} unit="pt" onChange={setRate} />
            </Line>
            <Line title="Vacance locative" sub="Part des loyers perdue chaque année">
              <Stepper label="Vacance locative" value={vacancy} min={0} max={30} step={1} unit="%" onChange={setVacancy} />
            </Line>
            <Line title="Sans salaire ni bonus" sub={loss > 0 ? `${loss} mois dès maintenant` : 'Dès maintenant'}>
              <Stepper label="Mois sans salaire" value={loss} min={0} max={120} step={6} unit="mois" onChange={setLoss} />
            </Line>
            {loss > 0 && (
              <Line title="Avec chômage" sub={`80 % du gain assuré (plafond de 148 200 par an), 400 indemnités, soit 18 mois${reveal ? `. Environ ${fmt.money(UNEMPLOYMENT_NET_MONTHLY)} net par mois` : ''}`}>
                <Switch label="Avec chômage" on={unemp} onChange={setUnemp} />
              </Line>
            )}
            <Line title="Racheter le 401(k) dans le 2e pilier" sub="Impôt de sortie réduit, perte de change">
              <Switch label="Racheter le 401(k)" on={rollover} onChange={setRollover} />
            </Line>
          </Group>
        </div>

        <div className="ret-col">
          <Group
            title="Vendre"
            action={
              <span className="group-actions">
                <button type="button" onClick={() => pick(props.filter((p) => p.asset.subtype !== 'home'))}>Locatifs</button>
                <button type="button" onClick={() => pick(props)}>Tout</button>
                <button type="button" onClick={() => setSellOn({})}>Rien</button>
              </span>
            }
          >
            {props.map((p) => {
              const k = p.asset.key;
              const on = Boolean(sellOn[k]);
              const debt = p.liabilities.reduce((s, l) => s + l.balance, 0);
              const equity = p.asset.value * (1 - p.asset.haircut) - debt;
              const rent = p.incomes.reduce((s, i) => s + i.monthly, 0);
              const sub = `Net ${money(equity)}${rent > 0 ? `, loyer ${money(rent)} par mois` : ', habité'}`;
              return (
                <Line
                  key={k}
                  title={shortName(p.asset.label)}
                  sub={sub}
                  below={on ? (
                    <span className="sell-when">
                      Vente à
                      <Stepper label={`Âge de vente de ${shortName(p.asset.label)}`} value={sellAge[k] ?? retireAge} min={nowAge} max={endAge - 1} unit="ans" onChange={(v) => setSellAge({ ...sellAge, [k]: v })} />
                    </span>
                  ) : undefined}
                >
                  <Switch
                    label={`Vendre ${shortName(p.asset.label)}`}
                    on={on}
                    onChange={(v) => {
                      setSellOn({ ...sellOn, [k]: v });
                      if (v && sellAge[k] === undefined) setSellAge({ ...sellAge, [k]: retireAge });
                    }}
                  />
                </Line>
              );
            })}
            {anySale && soldHome && (
              <p className="note">Vendre la résidence: le calcul ne prévoit pas de loyer de remplacement. Ajoute-le au budget.</p>
            )}
            {anySale && !soldHome && (
              <p className="note">Sans loyers, les revenus qui restent sont les rentes AVS et américaine.</p>
            )}
          </Group>

          {run.events.length > 0 && (
            <Group title="Étapes">
              <ol className="steps">
                {run.events.map((e, i) => (
                  <li key={i} className={'step ' + e.kind}>
                    <i aria-hidden="true" />
                    <div>
                      <b>{e.text}</b>
                      <span>{age(e.age)}, {e.year}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </Group>
          )}
        </div>
      </div>

      <details className="assumptions">
        <summary>Hypothèses</summary>
        <ul>
          <li>Tout est en francs d’aujourd’hui, sans inflation. Les rendements sont les rendements réels du cas choisi ({CASES[caseId].label.toLowerCase()}).</li>
          <li>Avant la retraite, le salaire et le bonus continuent et les liquidités s’alimentent de l’excédent mensuel. À la retraite, les avoirs LPP, 3a et 401(k) sont versés, impôt de sortie estimé déduit.</li>
          <li>Budget de retraite: {money(run.budget)} par mois, hors impôts sur le revenu et études. Les impôts de retraite sont calculés: impôt sur le revenu au taux moyen de tes taxations, impôt sur la fortune d’après le barème vaudois 2025, sur les liquidités et la valeur fiscale des biens. Les dettes variables sont comptées à {(params.normalRate * 100).toFixed(1).replace(".", ",")} % au moins, un taux normal à long terme.</li>
          <li>Les hypothèques ne sont pas remboursées: leurs intérêts restent dans le budget. Une vente rend la valeur du bien moins la décote et la dette, et supprime son loyer et ses charges.</li>
          <li>Sans vente choisie, un bien n’est vendu d’office que si les liquidités manquent: d’abord celui qui rapporte le moins par franc de fonds propres, la résidence en dernier.</li>
          <li>Les rentes AVS (rapport VZ de 2025) et américaine (estimation ssa.gov) sont comptées dès l’âge indiqué dans Données. Le salaire de la conjointe s’arrête à ton départ.</li>
          <li>Pas encore modélisés: la hausse des coûts de santé et l’inflation. Vacance locative de {vacancy} % des loyers. Le calcul ne remplace pas un avis fiscal ou de prévoyance.</li>
        </ul>
      </details>
    </div>
  );
}

function Chart({ rows, events, retireAge, reveal, hover, setHover, mode, H, label }: { rows: YearRow[]; events: RetirementEvent[]; retireAge: number; reveal: boolean; hover: number | null; setHover: (i: number | null) => void; mode: 'liquid' | 'property'; H: number; label: string }) {
  const W = 760;
  const L = 4;
  const prop = mode === 'property';
  const B = prop ? 4 : 24;
  const T = 8;
  if (rows.length === 0) return null;
  const pos = rows.map((r) => (prop ? Math.max(0, r.realEstate) : Math.max(0, r.liquid) + r.pensions));
  const neg = rows.map((r) => (prop ? Math.min(0, r.realEstate) : Math.min(0, r.liquid)));
  const top = Math.max(...pos, 1);
  const bottom = Math.min(...neg, 0);
  const span = top - bottom || 1;
  const y = (v: number) => T + ((top - v) / span) * (H - T - B);
  const bw = (W - L * 2) / rows.length;
  const x = (i: number) => L + i * bw;
  const first = rows[0].age;
  const xAge = (ag: number) => L + ((ag - first) / rows.length) * (W - L * 2);
  const ticks = rows.filter((r) => Math.round(r.age) % 10 === 0 || r.age === first);
  return (
    <svg className={'ret-chart' + (prop ? ' prop' : '')} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
      {!prop && <line x1={L} x2={W - L} y1={y(0)} y2={y(0)} className="ret-axis" />}
      {rows.map((r, i) => {
        const liq = prop ? 0 : Math.max(0, r.liquid);
        const re = prop ? Math.max(0, r.realEstate) : 0;
        let base = 0;
        const seg = (v: number, cls: string) => {
          const el = v > 0 ? <rect key={cls} x={x(i) + 1} width={Math.max(1, bw - 2)} y={y(base + v)} height={Math.max(0, y(base) - y(base + v))} rx={1.5} className={cls} /> : null;
          base += v;
          return el;
        };
        return (
          <g key={i} opacity={hover === null || hover === i ? 1 : 0.5} onMouseEnter={() => setHover(i)}>
            <rect x={x(i)} y={T} width={bw} height={H - T - B} fill="transparent" />
            {seg(liq, 'bar-cash')}
            {seg(prop ? 0 : r.pensions, 'bar-pension')}
            {seg(re, 'bar-re')}
            {!prop && r.liquid < 0 && <rect x={x(i) + 1} width={Math.max(1, bw - 2)} y={y(0)} height={Math.max(0, y(r.liquid) - y(0))} rx={1.5} className="bar-neg" />}
          </g>
        );
      })}
      {!prop && (
        <>
          <line x1={xAge(retireAge)} x2={xAge(retireAge)} y1={T} y2={H - B} className="ret-line" />
          <text x={xAge(retireAge) + 6} y={T + 10} className="ret-tick">Retraite</text>
          {events.filter((e) => e.kind === 'sale').map((e, i) => (
            <g key={i}>
              <line x1={xAge(e.age)} x2={xAge(e.age)} y1={T} y2={H - B} className="ret-sale" />
              <text x={xAge(e.age) + (xAge(e.age) > W * 0.75 ? -6 : 6)} y={T + 24 + i * 12} textAnchor={xAge(e.age) > W * 0.75 ? 'end' : 'start'} className="ret-tick">{e.text.replace('Vente de PPE ', 'Vente ')}</text>
            </g>
          ))}
          {ticks.map((r) => (
            <text key={r.age} x={x(rows.indexOf(r)) + bw / 2} y={H - 6} textAnchor="middle" className="ret-tick">{Math.round(r.age)}</text>
          ))}
          {reveal && <text x={W - L} y={T + 10} textAnchor="end" className="ret-tick">{fmt.money(top)}</text>}
        </>
      )}
    </svg>
  );
}

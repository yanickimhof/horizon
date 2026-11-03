import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, CalendarClock, Receipt } from 'lucide-react';
import { fmt, RING_LABELS, type State } from '../api';
import { summarize, type Slice } from '../engine/summary';
import { upcoming, type Upcoming } from '../engine/upcoming';
import { GROUPS, Rings } from '../components/Rings';

/**
 * Synthèse: les chiffres d'un côté, la vue en anneaux de l'autre.
 * Par défaut les montants sont masqués: les parts, ratios et durées restent visibles.
 */
export function Summary({ state, reveal }: { state: State; reveal: boolean }) {
  const s = useMemo(() => summarize(state.snapshot), [state.snapshot]);
  const [hl, setHl] = useState<number | null>(null);
  const money = (n: number) => (reveal ? fmt.money(n) : '••••');
  const pct = (x: number | null) => (x === null ? 'n.c.' : fmt.pct(x));

  const figures = [
    { label: 'Patrimoine net', value: money(s.netWorth), note: s.grossAssets > 0 ? `${fmt.pct(s.netWorth / s.grossAssets)} des actifs` : '' },
    { label: 'Actifs', value: money(s.grossAssets), note: `${state.snapshot.assets.length} ligne${state.snapshot.assets.length > 1 ? 's' : ''}` },
    { label: 'Dettes', value: money(s.debts), note: s.debtToAssets === null ? '' : `${pct(s.debtToAssets)} des actifs` },
    { label: 'Revenus par mois', value: money(s.income), note: '' },
    { label: 'Dépenses par mois', value: money(s.expenses), note: s.income > 0 ? `${fmt.pct(s.expenses / s.income)} des revenus` : '' },
    { label: 'Marge par mois', value: money(s.surplus), note: s.savingsRate === null ? '' : `${pct(s.savingsRate)} des revenus` },
  ];
  const weak = state.reliability.weakest;
  const ahead = useMemo(() => upcoming(state.snapshot), [state.snapshot]);

  return (
    <div className="page wide">
      <h1>Synthèse</h1>
      <p className="lede">
        {reveal ? 'Tout en francs suisses, au dernier cours connu.' : 'Les montants sont masqués. Les proportions, elles, restent visibles.'}
        {state.stale.length ? ` Cours à mettre à jour: ${state.stale.join(', ')}.` : ''}
      </p>

      <div className="figures">
        {figures.map((f) => (
          <div key={f.label} className="figure">
            <span className="figure-label">{f.label}</span>
            <strong>{f.value}</strong>
            <span className="figure-note">{f.note || ' '}</span>
          </div>
        ))}
      </div>

      <div className="summary-grid">
        <div className="summary-rings">
          <Rings rings={state.rings} base={state.rings} goals={state.goals} centerTop={state.runway === null ? '∞' : fmt.months(state.runway)} centerBottom="sans salaire" highlight={hl} onHighlight={setHl} />
          <ul className="mini-readout">
            {state.rings.map((r, i) => (
              <li key={i} className={hl === i ? 'on' : ''} onMouseEnter={() => setHl(i)} onMouseLeave={() => setHl(null)}>
                <span>{RING_LABELS[i]}</span>
                <b>{fmt.pct(r.coverage)}</b>
              </li>
            ))}
          </ul>
        </div>

        <div className="compo">
          <Composition title="Par type d’actif" slices={s.byClass} colored />
          <Composition title="Par devise" slices={s.byCurrency} />
          <Composition title="Par pays" slices={s.byRegion} />
          <div className="compo-block">
            <h2>Fiabilité</h2>
            <div className="reliab">
              <span className="meter" aria-hidden="true"><span style={{ width: `${Math.round(state.reliability.score * 100)}%` }} /></span>
              {fmt.pct(state.reliability.score)} des chiffres confirmés
            </div>
            {weak.length > 0 && <p className="muted small">À préciser en priorité: {weak.join(', ')}.</p>}
          </div>
        </div>
      </div>

      {ahead.length > 0 && (
        <section className="block">
          <div className="block-head"><h2>À venir</h2><CalendarClock size={18} strokeWidth={1.5} aria-hidden="true" /></div>
          <ul className="list">
            {ahead.map((u) => (
              <li key={u.key + u.kind} className="row">
                <span className="ev-icon" aria-hidden="true">{iconFor(u)}</span>
                <div className="row-main">
                  <div className="row-title">{u.label}</div>
                  <div className="row-sub">{describe(u)}</div>
                </div>
                <div className="row-end">{u.inMonths >= 24 ? `dans ${(u.inMonths / 12).toFixed(1).replace('.', ',')} ans` : `dans ${u.inMonths} mois`}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const iconFor = (u: Upcoming) => (u.kind === 'lump' ? <Receipt size={18} strokeWidth={1.5} /> : u.kind === 'end' || u.kind === 'income-start' ? <ArrowDownRight size={18} strokeWidth={1.5} /> : <ArrowUpRight size={18} strokeWidth={1.5} />);

/** Sans montant: le poids se dit en mois de vie ou en part du coût mensuel. */
function describe(u: Upcoming): string {
  const pct = Math.round(u.weight * 100);
  if (u.kind === 'lump') return `Dépense ponctuelle, environ ${u.weight.toFixed(1).replace('.', ',')} mois de vie`;
  if (u.kind === 'start') return `Début: ${pct} % du coût de vie mensuel en plus`;
  if (u.kind === 'end') return `Fin: libère ${pct} % du coût de vie mensuel`;
  return `Revenu stable qui démarre: couvre ${pct} % du coût de vie mensuel`;
}

const CLASS_KEY: Record<string, string> = { cash: 'cash', securities: 'securities', crypto: 'securities', real_estate: 'real_estate', pension: 'pension' };

function Composition({ title, slices, colored }: { title: string; slices: Slice[]; colored?: boolean }) {
  if (slices.length === 0) return null;
  const colorOf = (k: string) => (colored ? (CLASS_KEY[k] ? `var(--c-${CLASS_KEY[k]})` : 'var(--c-other)') : undefined);
  return (
    <div className="compo-block">
      <h2>{title}</h2>
      <div className="stack-bar" role="img" aria-label={slices.map((x) => `${x.label} ${fmt.pct(x.share)}`).join(', ')}>
        {slices.map((x, i) => (
          <span key={x.key} style={{ width: `${x.share * 100}%`, background: colorOf(x.key) ?? `color-mix(in srgb, var(--ink) ${Math.max(18, 78 - i * 16)}%, var(--bg))` }} title={`${x.label} ${fmt.pct(x.share)}`} />
        ))}
      </div>
      <ul className="compo-list">
        {slices.map((x, i) => (
          <li key={x.key}>
            <i className="dot" style={{ background: colorOf(x.key) ?? `color-mix(in srgb, var(--ink) ${Math.max(18, 78 - i * 16)}%, var(--bg))` }} aria-hidden="true" />
            <span>{x.label}</span>
            <b>{fmt.pct(x.share)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Les groupes d'anneaux servent de légende implicite: on garde l'import pour que les libellés restent synchrones.
void GROUPS;

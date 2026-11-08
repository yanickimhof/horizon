import { useMemo } from 'react';
import { fmt, type State } from '../api';
import { treasury, type TScenario } from '../engine/treasury';
import '../retraite.css';
import '../tresorerie.css';

const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '');

/**
 * Trésorerie de maintenant: ce que rapporte et coûte le foyer chaque mois avec le revenu actuel, sans chômage ni versement
 * unique, en trois hypothèses lisibles. Les montants suivent le bouton œil; les rapports (couverture, mois) restent visibles.
 */
export function Tresorerie({ state, reveal, goto }: { state: State; reveal: boolean; goto: (tab: string) => void }) {
  const t = useMemo(() => treasury(state.snapshot, state.budget), [state.snapshot, state.budget]);
  const money = (n: number) => (reveal ? fmt.money(n) : '••••');
  const signed = (n: number) => (reveal ? `${sign(n)}${fmt.money(Math.abs(n))}` : n >= 0 ? 'positive' : 'négative');
  const central = t.scenarios.find((s) => s.id === 'central') as TScenario;
  const prudent = t.scenarios.find((s) => s.id === 'prudent') as TScenario;
  const level = prudent.margin >= 0 ? 'ok' : central.margin >= 0 ? 'fragile' : 'short';
  const word = { ok: 'Solide', fragile: 'Équilibré, sans coussin', short: 'Déficitaire' }[level];
  const cover = central.outflow > 0 ? central.income / central.outflow : 0;
  const why = {
    ok: `Même dans le cas prudent, les revenus couvrent les sorties (${fmt.pct(prudent.outflow > 0 ? prudent.income / prudent.outflow : 0)}).`,
    fragile: `Dans le cas central, les revenus couvrent ${fmt.pct(cover)} des sorties. Sans bonus et avec des loyers en baisse, la marge devient négative: les liquidités tiennent ${prudent.reserveMonths ?? 0} mois à ce rythme.`,
    short: `Les revenus actuels couvrent ${fmt.pct(cover)} des sorties dans le cas central. Les liquidités tiennent ${central.reserveMonths ?? 0} mois à ce rythme.`,
  }[level];
  const obs = t.observed;
  const gapPct = obs && obs.factsSpendMonthly > 0 ? (obs.spendMonthly - obs.factsSpendMonthly) / obs.factsSpendMonthly : null;

  return (
    <div className="page wide tre">
      <section className={'tre-hero ' + level}>
        <div>
          <p className="kicker">Trésorerie maintenant</p>
          <h1>{word}</h1>
          <p className="lede">{why}</p>
        </div>
        <div className="tre-big">
          <span className="muted small">Marge mensuelle, cas central</span>
          <b>{signed(central.margin)}</b>
          <span className="muted small">Liquidités {money(t.liquid)}</span>
        </div>
      </section>

      <section className="tre-scen" aria-label="Trois hypothèses">
        {t.scenarios.map((s) => (
          <article key={s.id} className={'tre-card' + (s.id === 'central' ? ' main' : '')}>
            <header><h2>{s.label}</h2><span className={'tag ' + (s.margin >= 0 ? 'ok' : '')}>{s.margin >= 0 ? 'Marge positive' : `${s.reserveMonths} mois de réserve`}</span></header>
            <p className="tre-margin">{signed(s.margin)}<small> par mois</small></p>
            <dl>
              <div><dt>Entrées</dt><dd>{money(s.income)}</dd></div>
              <div><dt>Sorties</dt><dd>{money(s.outflow)}</dd></div>
            </dl>
            <p className="muted small">{s.rule}</p>
          </article>
        ))}
      </section>

      <div className="tre-cols">
        <div className="group">
          <header><h2>Ce qui rentre</h2></header>
          <div className="group-body">
            {t.incomeLines.map((l) => (
              <div key={l.key} className="line"><div className="line-top"><div className="line-main"><div className="line-title">{l.label}</div></div><div className="line-end">{money(l.monthly)}</div></div></div>
            ))}
            <div className="line total"><div className="line-top"><div className="line-main"><div className="line-title">Total</div><div className="line-sub">Chômage terminé, versement Nagravision exclu.</div></div><div className="line-end"><b>{money(t.salary + t.bonus + t.rents + t.other)}</b></div></div></div>
          </div>
        </div>
        <div className="group">
          <header><h2>Ce qui sort</h2></header>
          <div className="group-body">
            {t.outLines.map((l) => (
              <div key={l.key} className="line"><div className="line-top"><div className="line-main"><div className="line-title">{l.label}</div></div><div className="line-end">{money(l.monthly)}</div></div></div>
            ))}
            <div className="line total"><div className="line-top"><div className="line-main"><div className="line-title">Total hors solde d’impôt</div><div className="line-sub">{`Dont amortissements ${money(t.amortization)}, qui réduisent la dette.`}</div></div><div className="line-end"><b>{money(t.fixed)}</b></div></div></div>
          </div>
        </div>
      </div>

      <div className="group">
        <header><h2>Ce que les relevés disent</h2></header>
        <div className="group-body">
          {obs ? (
            <div className="line"><div className="line-top"><div className="line-main"><div className="line-title">Dépenses réelles des {obs.months} derniers mois complets</div><div className="line-sub">{`Moyenne ${money(obs.spendMonthly)} par mois, contre ${money(obs.factsSpendMonthly)} dans les faits${gapPct !== null ? ` (${sign(gapPct)}${Math.abs(Math.round(gapPct * 100))} %)` : ''}. Les relevés incluent les charges ponctuelles de l’année; les faits les lissent.`}</div></div></div></div>
          ) : (
            <div className="line"><div className="line-top"><div className="line-main"><div className="line-sub">Moins de six mois complets de relevés: pas de comparaison.</div></div></div></div>
          )}
          {t.rentalGap !== null && (
            <div className="line"><div className="line-top"><div className="line-main"><div className="line-title">Charges des biens locatifs au-delà du modèle</div><div className="line-sub">{t.rentalGap > 0 ? `Les relevés montrent ${money(t.rentalGap)} par an de plus que ce que les faits prévoient (soldes de gérance, travaux). Compté dans le cas prudent. À confirmer avec les décomptes 2026.` : 'Les faits couvrent les charges relevées.'}</div></div></div></div>
          )}
        </div>
      </div>

      <p className="note">{`Le net SICPA (${money(t.salary)} par mois) est une estimation tant que la première fiche de salaire complète n’est pas reçue. Le cas prudent reste positif jusqu’à ${money(t.breakEvenSalary)} par mois${t.salary > 0 ? `, soit ${fmt.pct(Math.max(0, 1 - t.breakEvenSalary / t.salary))} de moins` : ''}.`}</p>
      <p className="note">Le solde d’impôt de {money(t.taxSolde * 12)} par an vient de la taxation 2025, qui comprenait un revenu exceptionnel: il n’est pas garanti de se répéter. Le cas favorable le retire. <button className="link" onClick={() => goto('biens')}>Voir les biens</button></p>
    </div>
  );
}

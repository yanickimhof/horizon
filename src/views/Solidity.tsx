import { fmt } from '../api';
import type { Robustness } from '../engine/sensitivity';
import '../retraite.css';

const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '');
const pct = (x: number) => `${sign(x)}${Math.abs(Math.round(x * 100))} %`;

/**
 * Solidité du verdict: la marge de budget, la fourchette pire/base/meilleur cas et les facteurs classés.
 * Les montants suivent le bouton œil. Les pourcentages restent visibles.
 */
export function Solidity({ rob, reveal }: { rob: Robustness; reveal: boolean }) {
  const money = (n: number) => (reveal ? fmt.money(n) : '••••');
  const maxPct = Math.max(0.01, ...rob.factors.flatMap((f) => [Math.abs(f.low.pct), Math.abs(f.high.pct)]));
  const width = (x: number) => `${Math.round((Math.abs(x) / maxPct) * 100)}%`;
  return (
    <section className="solidity">
      <div className="group">
        <header><h2>Solidité du verdict</h2></header>
        <div className="group-body">
          <div className="line">
            <div className="line-top">
              <div className="line-main">
                <div className="line-title">Budget maximal tenable</div>
                <div className="line-sub">{rob.margin >= 0 ? `Tu pourrais dépenser ${pct(rob.margin).replace('+', '')} de plus par mois avant que les liquidités s’épuisent, sans vendre de bien.` : `Les liquidités s’épuisent: il faudrait dépenser ${pct(-rob.margin).replace('+', '')} de moins.`}</div>
              </div>
              <div className="line-end"><b>{money(rob.breakEven)}</b><span className="muted small">contre {money(rob.budget)}</span></div>
            </div>
          </div>
          {rob.cases.map((c) => (
            <div key={c.id} className="line">
              <div className="line-top">
                <div className="line-main">
                  <div className="line-title">{c.label}</div>
                  <div className="line-sub">Patrimoine à l’âge final {money(c.finalNetWorth)}</div>
                </div>
                <div className="line-end"><span className={'tag ' + (c.margin >= 0.2 ? 'ok' : c.margin >= 0 ? 'assumed' : '')}>Marge {pct(c.margin)}</span></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="group">
        <header><h2>Ce qui pèse le plus sur le patrimoine à l’âge final</h2></header>
        <div className="group-body factors">
          {rob.factors.map((f) => (
            <div key={f.id} className="factor">
              <div className="factor-label">{f.label}</div>
              <div className="factor-bars" role="img" aria-label={`${f.label}: ${f.low.label} ${pct(f.low.pct)}, ${f.high.label} ${pct(f.high.pct)}`}>
                <div className="fb left">{f.low.pct !== 0 && <i style={{ width: width(f.low.pct) }} className={f.low.pct < 0 ? 'neg' : 'pos'} />}</div>
                <div className="fb right">{f.high.pct !== 0 && <i style={{ width: width(f.high.pct) }} className={f.high.pct < 0 ? 'neg' : 'pos'} />}</div>
              </div>
              <div className="factor-vals">
                <span>{f.low.label}: <b>{pct(f.low.pct)}</b>{reveal && f.low.delta !== 0 ? ` (${sign(f.low.delta)}${fmt.money(Math.abs(f.low.delta))})` : ''}</span>
                <span>{f.high.label}: <b>{pct(f.high.pct)}</b>{reveal && f.high.delta !== 0 ? ` (${sign(f.high.delta)}${fmt.money(Math.abs(f.high.delta))})` : ''}</span>
              </div>
            </div>
          ))}
          <p className="note">Chaque facteur est modifié seul, les autres restent à leur valeur. Les pourcentages sont en part du patrimoine à l’âge final.</p>
        </div>
      </div>
    </section>
  );
}

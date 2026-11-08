import { useMemo } from 'react';
import { fmt, type State } from '../api';
import { portfolio, type Bien } from '../engine/biens';
import '../retraite.css';
import '../tresorerie.css';

const pct = (x: number | null, d = 1) => (x === null ? 'n/d' : `${(x * 100).toFixed(d).replace('.', ',')} %`);
const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '');

const dateFr = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** Appréciation courte d'un bien locatif, fondée sur la couverture de la dette et le levier. */
function verdict(b: Bien): { tone: 'ok' | 'warn' | 'bad'; text: string } {
  if (b.coverage === null) return { tone: 'ok', text: 'Sans dette' };
  if (b.coverage < 1) return { tone: 'bad', text: 'Le loyer ne couvre pas la dette' };
  if (b.ltvLow > 0.65) return { tone: 'warn', text: 'Levier élevé si la valeur est basse' };
  if (b.coverage < 1.5) return { tone: 'warn', text: 'Peu de marge sur la dette' };
  return { tone: 'ok', text: 'Couvre la dette avec de la marge' };
}

/**
 * Biens: une ligne par bien, avec valeur en fourchette, levier, couverture de la dette et cash-flow.
 * Le cash-flow modélisé vient des faits; l'observé vient des relevés des 12 derniers mois complets.
 */
export function Biens({ state, reveal }: { state: State; reveal: boolean }) {
  const p = useMemo(() => portfolio(state.snapshot, state.facts, state.budget), [state.snapshot, state.facts, state.budget]);
  const money = (n: number) => (reveal ? fmt.money(n) : '••••');
  const signed = (n: number) => (reveal ? `${sign(n)}${fmt.money(Math.abs(n))}` : '••••');
  const rentals = p.biens.filter((b) => !b.home);
  const rentTotal = rentals.reduce((s, b) => s + b.rent, 0);
  const afterDebt = rentals.reduce((s, b) => s + b.cashAfterDebt, 0);
  const rentalObs = rentals.filter((b) => b.observed);
  const observedNet = rentalObs.reduce((s, b) => s + (b.observed?.net ?? 0), 0);

  return (
    <div className="page wide tre">
      <section className="tre-hero">
        <div>
          <p className="kicker">Biens</p>
          <h1>{p.biens.length} biens, {pct(p.netConcentration, 0)} du patrimoine net</h1>
          <p className="lede">{`Dette ${pct(p.ltv, 0)} de la valeur estimée, dont ${pct(p.totalDebt > 0 ? p.variableDebt / p.totalDebt : 0, 0)} à taux variable. Un point de taux de plus coûte ${money(p.rateShock)} par an.${p.nextFixed ? ` Prochain taux fixe à renouveler: ${dateFr(p.nextFixed.date)}.` : ''}`}</p>
        </div>
        <div className="tre-big">
          <span className="muted small">Fonds propres dans l’immobilier</span>
          <b>{money(p.equity)}</b>
          <span className="muted small">Valeur {money(p.totalValue)}, dette {money(p.totalDebt)}</span>
        </div>
      </section>

      <div className="group">
        <header><h2>Par bien</h2></header>
        <div className="group-body bien-table">
          <div className="bien-row head">
            <span>Bien</span><span>Valeur (fourchette)</span><span>Dette / valeur</span><span>Loyer net perçu</span><span>Après dette</span><span>Rendement net</span>
          </div>
          {p.biens.map((b) => {
            const v = b.home ? null : verdict(b);
            return (
              <div key={b.key} className="bien-row">
                <span><b>{b.name}</b><small className="muted">{b.home ? 'Résidence principale' : b.commune ?? 'Locatif'}{v ? ` · ${v.text}` : ''}</small></span>
                <span>{money(b.value)}<small className="muted">{b.ranged ? `${money(b.low)} à ${money(b.high)}` : 'sans fourchette'}</small></span>
                <span>{pct(b.ltv, 0)}<small className="muted">{b.ltvLow > b.ltv + 0.005 ? `${pct(b.ltvLow, 0)} à la valeur basse` : ''}</small></span>
                <span>{b.home ? '—' : money(b.rent)}<small className="muted">{b.grossRent ? `brut locataire ${money(b.grossRent)}` : ''}</small></span>
                <span>{b.home ? '—' : signed(b.cashAfterDebt)}<small className="muted">{b.coverage !== null && !b.home ? `couverture ${b.coverage.toFixed(1).replace('.', ',')} x` : ''}</small></span>
                <span>{b.home ? '—' : pct(b.netYield)}<small className="muted">{b.grossYield !== null ? `brut ${pct(b.grossYield)}` : ''}</small></span>
              </div>
            );
          })}
          <div className="bien-row foot">
            <span><b>Locatifs</b></span><span></span><span></span><span>{money(rentTotal)}</span><span>{signed(afterDebt)}</span><span></span>
          </div>
        </div>
      </div>

      <div className="tre-cols">
        <div className="group">
          <header><h2>Ce que disent les relevés</h2></header>
          <div className="group-body">
            {rentals.map((b) => (
              <div key={b.key} className="line"><div className="line-top"><div className="line-main"><div className="line-title">{b.name}</div><div className="line-sub">{b.observed ? `Loyers reçus ${money(b.observed.rent)}, charges payées ${money(b.observed.charges)} sur 12 mois.` : 'Absent des relevés avec ce nom de bien.'}</div></div><div className="line-end">{b.observed ? <b>{signed(b.observed.net)}</b> : '—'}</div></div></div>
            ))}
            {rentalObs.length > 0 && (
              <div className="line total"><div className="line-top"><div className="line-main"><div className="line-title">Net observé, locatifs</div><div className="line-sub">{`Les faits donnent ${signed(afterDebt)} après dette, avant taxe foncière, assurance et travaux. L’écart vient des charges, des soldes de gérance et du calendrier des paiements.`}</div></div><div className="line-end"><b>{signed(observedNet)}</b></div></div></div>
            )}
          </div>
        </div>
        <div className="group">
          <header><h2>Risques</h2></header>
          <div className="group-body">
            <div className="line"><div className="line-top"><div className="line-main"><div className="line-title">Concentration</div><div className="line-sub">{`L’immobilier pèse ${pct(p.concentration, 0)} de l’actif et ${pct(p.netConcentration, 0)} du patrimoine net, sur ${new Set(p.biens.map((b) => b.commune).filter(Boolean)).size || 'quelques'} communes vaudoises.`}</div></div></div></div>
            <div className="line"><div className="line-top"><div className="line-main"><div className="line-title">Taux</div><div className="line-sub">{`${money(p.variableDebt)} de dette sont au taux variable (SARON). Un point de plus ajoute ${money(p.rateShock)} d’intérêts par an, soit ${rentTotal > 0 ? pct(p.rateShock / rentTotal, 0) : 'n/d'} des loyers nets perçus. Le taux variable est le SARON plus la marge de la banque (0,80 %). Le SARON est proche de 0 % aujourd’hui, donc le taux payé est la marge seule. Avec un SARON à 0,7 %, il serait d’environ 1,5 % et les intérêts monteraient de ${money(p.variableDebt * 0.007)} par an.`}</div></div></div></div>
            <div className="line"><div className="line-top"><div className="line-main"><div className="line-title">Valeur</div><div className="line-sub">Les valeurs sont des estimations de modèle, avec la fourchette déclarée quand elle existe. Les valeurs fiscales 2025 sont plus basses et ne servent pas de référence de marché.</div></div></div></div>
          </div>
        </div>
      </div>
    </div>
  );
}

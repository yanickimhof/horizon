import { useMemo } from 'react';
import { fmt } from '../api';
import type { Assumptions } from '../engine/assumptions';
import type { Snapshot } from '../engine/types';
import { withdrawals } from '../engine/withdrawals';
import '../retraite.css';
import '../tresorerie.css';

const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')} %`;

/**
 * Impôt sur les capitaux de prévoyance (2e pilier, 3e pilier a): même année contre échelonné. Taux tirés du calculateur
 * fédéral (Lausanne 2026, couple), bornés par le barème d'une personne seule. Les montants suivent le bouton œil.
 */
export function Retraits({ snap, as, retireAge, reveal }: { snap: Snapshot; as: Assumptions; retireAge: number; reveal: boolean }) {
  const w = useMemo(() => withdrawals(snap, as, retireAge), [snap, as, retireAge]);
  if (!w) return null;
  const money = (n: number) => (reveal ? fmt.money(n) : '••••');
  const once = w.plans[0];
  const sep = w.plans[1];
  const split = w.plans[2];

  return (
    <section className="tile ret">
      <h2>Impôt sur les capitaux de prévoyance</h2>
      <p className="lede">
        {`À ${retireAge} ans, vos capitaux suisses de prévoyance (2e pilier et 3e pilier a) atteignent environ ${money(w.total)}. Sortis la même année, ils coûtent environ ${money(once.tax)} d’impôt (${pct(once.rate)}). Un 3e pilier a retiré chaque année avant la retraite économise environ ${money(sep.saving)}.`}
      </p>
      <div className="group">
        <div className="group-body bien-table">
          <div className="ret-row head"><span>Façon de sortir</span><span>Impôt estimé</span><span>Taux</span><span>Économie</span><span>Calendrier</span></div>
          {w.plans.map((p) => (
            <div key={p.id} className="ret-row">
              <span><b>{p.label}</b><small className="muted">{p.rule}</small></span>
              <span>{money(p.tax)}<small className="muted">{`jusqu’à ${money(p.taxHigh)} (barème personne seule)`}</small></span>
              <span>{pct(p.rate)}</span>
              <span>{p.saving > 0 ? money(p.saving) : '—'}</span>
              <span>{p.years.map((y) => <small key={y.age} className="muted">{`${y.age} ans: ${money(y.capital)}`}</small>)}</span>
            </div>
          ))}
        </div>
      </div>
      <ul className="ret-notes">
        <li>{`Le moteur de retraite retient aujourd’hui en moyenne ${pct(w.engineRate)} de décote sur ces capitaux (10 % pour le 2e pilier, 8 % pour le 3e pilier a): c’est ${w.engineRate > once.rate ? 'un peu plus prudent que' : 'proche de'} le calcul ci-dessus pour une sortie la même année.`}</li>
        <li>{`« ${split.label} » suppose de sortir le 2e pilier en deux temps. Le règlement de la caisse SICPA (CRPS, 2026) le permet seulement par une retraite partielle: trois étapes au plus, d’un commun accord avec l’employeur, la prestation étant proportionnelle au taux d’occupation abandonné. Il autorise aussi la retraite anticipée dès 58 ans et le capital total ou partiel (demande écrite six mois avant, signature du conjoint authentifiée).`}</li>
        <li>Barème: Vaud, couple, un seul conjoint perçoit un capital, Lausanne 2026 (calculateur de l’Administration fédérale des contributions, relevé le 15.10.2026 par ibani.com). La taxation d’Echallens peut différer. Les capitaux sont projetés avec la croissance réelle du cas choisi et les cotisations du certificat.</li>
        {w.excluded.map((x) => <li key={x}>{x}</li>)}
      </ul>
    </section>
  );
}

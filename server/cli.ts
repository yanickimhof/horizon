import { mkdirSync } from 'node:fs';
import { Ledger } from './ledger';
import { loadDemo } from './demo';
import { project } from '../src/core/project';
import { rings, runwayMonths } from '../src/engine/horizons';
import { runScenarios } from '../src/engine/stress';
import { reliability } from '../src/engine/reliability';
import { goalMarkers } from '../src/engine/goals';
import type { FactDraft } from '../src/core/types';
import { getTerms } from './egress';
import { restoreDeep } from '../src/core/pseudonym';

/**
 * Usage : npm run ledger -- <commande>
 *   demo                 charge la famille fictive dans data/demo.db
 *   rings [demo]         affiche anneaux, chocs, fiabilité (base réelle data/horizon.db par défaut)
 *   facts                liste les faits en vigueur
 *   inbox                liste les propositions à valider
 *   confirm <id> [json]  valide une proposition, avec correction éventuelle
 *   reject <id>          refuse une proposition
 *   add <json>           propose un fait (status proposed)
 */
const pct = (x: number) => `${Math.round(x * 100)} %`;
const months = (m: number) => (m === Infinity ? 'indéfiniment' : m >= 24 ? `${(m / 12).toFixed(1)} ans` : `${m} mois`);
const LABELS = ['3 mois', '1 an', '5 ans', '20 ans'];

function open(demo: boolean): Ledger {
  mkdirSync('data', { recursive: true });
  return new Ledger(demo ? 'data/demo.db' : 'data/horizon.db');
}

const [cmd, ...args] = process.argv.slice(2);
const useDemo = args.includes('demo') || cmd === 'demo';

if (cmd === 'demo') {
  const l = open(true);
  if (l.current().length === 0) loadDemo(l);
  console.log(`Démo chargée: ${l.current().length} faits en vigueur dans data/demo.db`);
} else if (cmd === 'rings') {
  const l = open(useDemo);
  const s = project(l.current(), new Date(), l.rates());
  const { base, baseRunway, results } = runScenarios(s);
  console.log(`\nSans salaire, tenue: ${months(runwayMonths(s))}  (fiabilité des données ${pct(reliability(s).score)})\n`);
  console.log('Anneau'.padEnd(10) + 'Couverture'.padEnd(12) + 'Sources');
  base.forEach((r, i) =>
    console.log(LABELS[i].padEnd(10) + pct(r.coverage).padEnd(12) + r.segments.map((x) => `${x.class} ${pct(x.share)}`).join(', ')),
  );
  console.log('\nChoc'.padEnd(24) + LABELS.map((x) => x.padEnd(9)).join('') + 'Tenue');
  for (const r of results) {
    console.log(r.scenario.label.padEnd(23) + r.rings.map((x) => pct(x.coverage).padEnd(9)).join('') + months(r.runwayMonths));
  }
  console.log(`\nBase`.padEnd(24) + base.map((x) => pct(x.coverage).padEnd(9)).join('') + months(baseRunway));
  const rel = reliability(s);
  if (rel.weakest.length) console.log(`\nÀ préciser en priorité: ${rel.weakest.join(', ')}`);
  for (const g of goalMarkers(s)) {
    console.log(`Rêve "${g.label}": anneau ${LABELS[g.ringIndex]}, coût ≈ ${g.costInMonthsOfLife.toFixed(1)} mois de vie, financé à ${pct(g.funded)}`);
  }
} else if (cmd === 'facts') {
  for (const f of open(useDemo).current()) console.log(`${f.status.padEnd(10)} ${f.key.padEnd(34)} ${f.why ?? ''}`);
} else if (cmd === 'inbox') {
  for (const f of open(useDemo).inbox()) console.log(`${f.id}  ${f.key}  ${JSON.stringify(f.data)}  « ${f.excerpt ?? ''} »`);
} else if (cmd === 'confirm') {
  const f = open(false).confirm(args[0], args[1] ? JSON.parse(args[1]) : {});
  console.log(`Confirmé: ${f.key}`);
} else if (cmd === 'reject') {
  open(false).reject(args[0]);
  console.log('Refusé');
} else if (cmd === 'add') {
  const l = open(false);
  const d = restoreDeep(JSON.parse(args[0]) as Partial<FactDraft> & Pick<FactDraft, 'kind' | 'key' | 'data'>, getTerms(l));
  const f = l.propose({ confidence: 0.7, sourceId: null, excerpt: null, why: null, origin: 'document', ...d, status: 'proposed' });
  console.log(`Proposé: ${f.id} (${f.key})`);
} else if (cmd === 'egress') {
  for (const e of open(useDemo).egressLog(30)) console.log(`${e.at}  ${e.allowed ? 'ENVOYÉ ' : 'BLOQUÉ '} ${e.destination}  ${e.purpose}  ${e.bytes} o  ${e.summary}${e.reason ? '  (' + e.reason + ')' : ''}`);
} else {
  console.log('Commandes: egress | demo | rings [demo] | facts | inbox | confirm <id> [json] | reject <id> | add <json>');
}

import { useMemo } from 'react';
import type { State } from '../api';
import '../retraite.css';
import '../about.css';

type Status = 'ok' | 'partial' | 'missing';

interface Item {
  id: string;
  title: string;
  status: Status;
  detail: string;
  where: string;
  optional?: boolean;
}

const LABEL: Record<Status, string> = { ok: 'Renseigné', partial: 'À compléter', missing: 'Manquant' };

/** État de chaque famille d'informations, déduit des faits en vigueur. Rien n'est envoyé nulle part. */
function checklist(state: State): Item[] {
  const s = state.snapshot;
  const has = (re: RegExp, ...texts: string[]) => texts.some((t) => re.test(t));
  const members = state.facts.find((f) => f.key === 'household' && f.status !== 'rejected' && f.status !== 'superseded')?.data.members;
  const memberCount = Array.isArray(members) ? members.length : 0;
  const cash = s.assets.filter((a) => a.class === 'cash');
  const invest = s.assets.filter((a) => a.class === 'securities' || a.class === 'crypto');
  const lpp = s.assets.filter((a) => a.account === 'lpp');
  const p3a = s.assets.filter((a) => a.account === '3a');
  const life = s.assets.filter((a) => a.subtype === 'life-insurance');
  const foreign = s.assets.filter((a) => ['401k', 'ira', 'roth'].includes(a.account ?? '')).length + s.incomes.filter((i) => has(/social security|sécurité sociale/i, i.label)).length;
  const avs = s.incomes.filter((i) => has(/avs/i, i.label));
  const homes = s.assets.filter((a) => a.class === 'real_estate');
  const withDebt = homes.filter((h) => s.liabilities.some((l) => l.securedBy === h.key));
  const cardLiab = s.liabilities.filter((l) => has(/carte|visa|mastercard|amex/i, l.label));
  const cardExp = s.expenses.filter((e) => has(/carte|visa|mastercard|amex/i, e.label));
  const salary = s.incomes.filter((i) => !i.stable);
  const recurring = s.expenses.filter((e) => !e.lump);
  const taxes = s.expenses.filter((e) => e.category === 'tax' || has(/imp[ôo]t/i, e.label));

  const vehicles = s.expenses.filter((e) => has(/leasing|voiture|v[ée]hicule|tesla|fiat|auto\b/i, e.label));
  const kids = s.expenses.filter((e) => has(/enfant|[ée]tude|garde|[ée]tudiant/i, e.label));
  const unemployment = s.incomes.filter((i) => has(/ch[ôo]mage|indemnit/i, i.label));
  const bankFees = s.expenses.filter((e) => has(/coffre|forfait|frais bancaire|tenue de compte/i, e.label)).length + s.assets.filter((a) => has(/part sociale|coop[ée]rative/i, a.label)).length;
  const st = (ok: boolean, partial = false): Status => (ok ? 'ok' : partial ? 'partial' : 'missing');
  const items: Item[] = [
    { id: 'foyer', title: 'Foyer', status: st(memberCount >= 2, memberCount >= 1 || s.household.birthYear > 0), detail: memberCount ? `${memberCount} personne${memberCount > 1 ? 's' : ''}` : 'Adultes, enfants, années de naissance, âge de retraite', where: 'Pièce d’identité, livret de famille' },
    { id: 'comptes', title: 'Comptes courants et épargne', status: st(cash.length > 0), detail: cash.length ? `${cash.length} compte${cash.length > 1 ? 's' : ''}` : 'Soldes de chaque compte, y compris les comptes secondaires et d’autres banques. Les virements entre tes comptes sont à marquer comme internes', where: 'Relevés bancaires, e-banking' },
    { id: 'cartes', title: 'Cartes de crédit', status: cardLiab.length ? 'ok' : st(false, cardExp.length > 0), detail: cardLiab.length ? 'Soldes dus renseignés' : cardExp.length ? 'Seulement une dépense moyenne: ajoute les relevés détaillés' : 'Relevés détaillés, pour classer les dépenses', where: 'Relevés mensuels de la carte' },
    { id: 'placements', title: 'Titres, fonds et crypto', status: st(invest.length > 0), detail: invest.length ? `${invest.length} ligne${invest.length > 1 ? 's' : ''}` : 'Si tu en as: quantités et symboles', where: 'Relevé de dépôt, application de courtage', optional: true },
    { id: 'avs', title: 'AVS (1er pilier)', status: st(avs.length > 0), detail: avs.length ? 'Rente estimée renseignée' : 'Rente attendue et âge de départ', where: 'Extrait de compte individuel, rapport de prévoyance' },
    { id: 'lpp', title: 'LPP (2e pilier)', status: lpp.length ? (lpp.some((a) => a.contribution) ? 'ok' : 'partial') : 'missing', detail: lpp.length ? (lpp.some((a) => a.contribution) ? 'Avoir et cotisations' : 'Avoir seulement: ajoute les cotisations du certificat') : 'Avoir de vieillesse, cotisations, capital projeté, rachat possible', where: 'Certificat de prévoyance annuel' },
    { id: '3a', title: '3e pilier A', status: st(p3a.length > 0), detail: p3a.length ? `${p3a.length} compte${p3a.length > 1 ? 's' : ''}` : 'Soldes et versements annuels', where: 'Attestation fiscale du 3a au 31.12' },
    { id: '3b', title: 'Assurances vie et épargne 3b', status: st(life.length > 0), detail: life.length ? `${life.length} contrat${life.length > 1 ? 's' : ''}` : 'Valeur de rachat et échéance', where: 'Valeurs fiscales de l’assureur', optional: true },
    { id: 'etranger', title: 'Prévoyance à l’étranger', status: st(foreign > 0), detail: foreign ? 'Renseignée' : 'Par exemple 401(k), IRA ou rente américaine', where: 'Relevé du plan, ssa.gov', optional: true },
    { id: 'immo', title: 'Immobilier', status: homes.length === 0 ? 'missing' : st(withDebt.length === homes.length, true), detail: homes.length ? `${homes.length} bien${homes.length > 1 ? 's' : ''}, ${withDebt.length} avec hypothèque liée` : 'Valeur, adresse, surface, prix d’achat, loyers, charges', where: 'Déclaration d’impôts, décomptes de gérance et de PPE' },
    { id: 'dettes', title: 'Hypothèques et autres dettes', status: s.liabilities.length ? 'ok' : homes.length ? 'missing' : 'ok', detail: s.liabilities.length ? `${s.liabilities.length} dette${s.liabilities.length > 1 ? 's' : ''}` : 'Solde, taux, échéance du taux fixe, amortissement (souvent nul en Suisse)', where: 'Relevé hypothécaire, contrat de crédit' },
    { id: 'revenus', title: 'Salaire et autres revenus', status: st(salary.length > 0), detail: salary.length ? 'Salaire renseigné' : 'Salaire net, bonus, loyers, rentes futures', where: 'Fiche de salaire, décompte de gérance' },
    { id: 'depenses', title: 'Dépenses courantes', status: st(recurring.length >= 5, recurring.length > 0), detail: recurring.length ? `${recurring.length} ligne${recurring.length > 1 ? 's' : ''}` : 'Assurances, logement, vie courante, loisirs', where: 'Relevés bancaires et de cartes sur 12 mois' },
    { id: 'impots', title: 'Impôts', status: st(taxes.length > 0), detail: taxes.length ? 'Acomptes ou solde renseignés' : 'Montant annuel, acomptes mensuels, solde à payer en plus, fortune imposable', where: 'Taxation, bordereau, acomptes' },
    { id: 'historique', title: 'Historique fiscal', status: taxes.length >= 2 ? 'ok' : taxes.length ? 'partial' : 'missing', detail: 'Les 3 à 4 dernières années: revenu et fortune imposables, impôts cantonal et fédéral, solde', where: 'Déclarations d’impôts et décisions de taxation', optional: true },
    { id: 'vehicules', title: 'Véhicules et leasings', status: st(vehicles.length > 0), detail: vehicles.length ? `${vehicles.length} ligne${vehicles.length > 1 ? 's' : ''}` : 'Mensualité, date de fin, valeur de reprise ou résiduelle, assurance', where: 'Contrat de leasing, police d’assurance', optional: true },
    { id: 'enfants', title: 'Enfants et études', status: st(kids.length > 0), detail: kids.length ? `${kids.length} ligne${kids.length > 1 ? 's' : ''}` : 'Loyer d’étudiant, argent de poche, frais d’études, garde', where: 'Bail, relevés, ordres permanents', optional: true },
    { id: 'chomage', title: 'Chômage et revenu de remplacement', status: st(unemployment.length > 0), detail: unemployment.length ? 'Indemnités renseignées' : 'Gain assuré, taux, nombre d’indemnités restantes', where: 'Décision de la caisse de chômage', optional: true },
    { id: 'frais-fixes', title: 'Frais bancaires et parts sociales', status: st(bankFees > 0), detail: bankFees ? 'Renseignés' : 'Coffre-fort, forfaits, parts sociales (valeur et intérêt)', where: 'Relevés de la banque', optional: true },
    { id: 'sources', title: 'Documents importés', status: st(state.sources.length > 0), detail: state.sources.length ? `${state.sources.length} source${state.sources.length > 1 ? 's' : ''}` : 'Chaque chiffre est relié à son document', where: 'Onglet Importer', optional: true },
  ];
  // La prévoyance à l'étranger n'est proposée que si elle existe, ou si des comptes en devises sont déjà lus.
  return items.filter((i) => i.id !== 'etranger' || foreign > 0 || state.budget.currencies.some((c) => c !== 'CHF'));
}

const VIEWS: { id: string; label: string; hint: string }[] = [
  { id: 'accueil', label: 'Retraite', hint: 'Une réponse: OK ou pas, ce qu’il te faut par mois, ce qui rentre, ce que tu as de côté' },
  { id: 'tresorerie', label: 'Trésorerie', hint: 'Marge mensuelle avec le revenu actuel, en trois hypothèses' },
  { id: 'biens', label: 'Biens', hint: 'Valeur en fourchette, levier, couverture de la dette et cash-flow par bien' },
  { id: 'summary', label: 'Patrimoine', hint: 'Chiffres, composition par type, devise et pays' },
];

export function About({ state, goto, hidden, setHidden, home, setHome }: { state: State; goto: (tab: string) => void; hidden: string[]; setHidden: (h: string[]) => void; home: string; setHome: (h: string) => void }) {
  const items = useMemo(() => checklist(state), [state]);
  const required = items.filter((i) => !i.optional);
  const done = required.filter((i) => i.status === 'ok').length;
  const todo = items.filter((i) => i.status !== 'ok');

  return (
    <div className="page about">
      <section className="hero">
        <h1>À propos</h1>
        <p className="lede">Horizon dit si ton patrimoine porte la vie de ton foyer, aujourd’hui et à la retraite, et ce qui change quand le monde bouge. Tout reste sur ton ordinateur.</p>
      </section>

      <div className="about-score">
        <strong>{done} sur {required.length}</strong>
        <span>informations essentielles renseignées</span>
        <i aria-hidden="true"><b style={{ width: `${Math.round((done / required.length) * 100)}%` }} /></i>
      </div>

      <div className="about-actions">
        <button type="button" className="btn primary" onClick={() => goto('import')}>Déposer mes documents</button>
        <button type="button" className="btn ghost" onClick={() => goto('data')}>Voir mes données</button>
      </div>

      <section className="group">
        <header><h2>Ce qu’il faut apporter</h2></header>
        <div className="group-body">
          {items.map((i) => (
            <div key={i.id} className="line">
              <div className="line-top">
                <div className="line-main">
                  <div className="line-title">{i.title}{i.optional ? <span className="about-opt">facultatif</span> : null}</div>
                  <div className="line-sub">{i.detail}</div>
                  {i.status !== 'ok' && <div className="line-sub about-where">Où le trouver: {i.where}</div>}
                </div>
                <div className="line-end">
                  <span className={'tag ' + (i.status === 'ok' ? 'ok' : i.status === 'partial' ? 'assumed' : '')}>{LABEL[i.status]}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="note">{todo.length === 0 ? 'Tout est renseigné. Relis la vue Retraite et ses hypothèses.' : 'Les relevés bancaires s’analysent dans Importer. Les autres chiffres se saisissent dans Données ou se font lire par un assistant (voir docs/ASSISTANT.md).'}</p>
      </section>

      <section className="group">
        <header><h2>Vues optionnelles</h2></header>
        <div className="group-body">
          {VIEWS.map((v) => {
            const on = !hidden.includes(v.id);
            return (
              <div key={v.id} className="line">
                <div className="line-top">
                  <div className="line-main">
                    <div className="line-title">{v.label}</div>
                    <div className="line-sub">{v.hint}</div>
                  </div>
                  <div className="line-end">
                    {on && home !== v.id && <button type="button" className="btn ghost small" onClick={() => setHome(v.id)}>Vue d’accueil</button>}
                    {home === v.id && <span className="tag ok">Accueil</span>}
                    <button type="button" role="switch" aria-checked={on} aria-label={`Afficher ${v.label}`} className={'switch' + (on ? ' on' : '')} onClick={() => setHidden(on ? [...hidden, v.id] : hidden.filter((x) => x !== v.id))}><i /></button>
                  </div>
                </div>
              </div>
            );
          })}
          <p className="note">Budget et Coach sont toujours là. Horizons, Scénarios, Données, Importer, Confidentialité et À propos se trouvent dans le menu « Plus » (trois points). « À valider » apparaît seulement quand il y a quelque chose à valider.</p>
        </div>
      </section>

      <div className="about-cols">
        <section className="group">
          <header><h2>Comment ça marche</h2></header>
          <div className="group-body about-text">
            <p><b>1. Les faits.</b> Chaque information est un fait daté, avec son origine (toi, un document, une estimation) et son historique. Une valeur supposée est signalée jusqu’à ce que la vraie arrive.</p>
            <p><b>2. Le calcul.</b> Horizon relie actifs, dettes, revenus et dépenses, puis projette ta retraite mois par mois. Il montre la fourchette, pas un chiffre unique.</p>
            <p><b>3. Les simulations.</b> Vendre un bien, perdre ton salaire, voir les taux monter: tu changes un réglage et tu vois l’effet tout de suite.</p>
          </div>
        </section>

        <section className="group">
          <header><h2>Confidentialité</h2></header>
          <div className="group-body about-text">
            <p>Les données vivent dans le dossier <code>data/</code> de ton ordinateur et ne sont jamais versionnées.</p>
            <p>Rien ne sort sans ton accord. Le coach peut tourner sur un modèle local. Les seuls appels externes sont les cours publics et, si tu l’autorises, Claude, avec un plafond mensuel. Chaque envoi est journalisé.</p>
            <p>Les noms et adresses sont masqués avant tout envoi à un service externe.</p>
          </div>
        </section>
      </div>

      <section className="group about-share">
        <header><h2>Partager l’outil</h2></header>
        <div className="group-body about-text">
          <p>Le code se partage par Git, les données restent chez chacun. Un nouvel utilisateur clone le dépôt, lance l’exemple fictif, puis crée ses propres données.</p>
          <pre><code>git clone &lt;adresse du dépôt&gt;
cd horizon
npm install
npm run hooks   # bloque tout commit de données personnelles
npm run dev     # exemple fictif sur http://127.0.0.1:5173</code></pre>
          <p>Le guide complet est dans <code>README.md</code> et la liste détaillée des informations dans <code>docs/DONNEES.md</code>.</p>
        </div>
      </section>

      <p className="about-foot">Horizon aide à réfléchir. Ce n’est pas un conseil en placement, fiscal ou juridique.</p>
    </div>
  );
}

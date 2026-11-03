import { useEffect, useState } from 'react';
import { api, type Db, type PrivacyView, type State } from '../api';
import '../stmts.css';

type Act = (route: string, body: unknown) => Promise<void>;

const KINDS = { personne: 'Personne', employeur: 'Employeur', adresse: 'Adresse', autre: 'Autre' } as const;

export function Privacy({ db, state, act }: { db: Db; state: State; act: Act }) {
  const [p, setP] = useState<PrivacyView | null>(null);
  const [read, setRead] = useState(false);
  const [term, setTerm] = useState('');
  const [kind, setKind] = useState<keyof typeof KINDS>('personne');
  const pv = state.privacy;

  useEffect(() => {
    api.privacy(db).then(setP).catch(() => setP(null));
  }, [db, state.facts.length, pv.terms.length]);

  const provider = state.llm.provider;
  const lede = pv.envLocked
    ? 'Mode local imposé: Horizon n’émet aucune requête vers l’extérieur et ne peut pas être autorisé à le faire.'
    : pv.mode === 'local'
      ? 'Rien ne sort de cet ordinateur. C’est le réglage par défaut.'
      : pv.consentCoach
        ? 'Le coach en ligne est autorisé. Chaque envoi est consigné dans le journal ci-dessous.'
        : 'Mode assisté, mais aucun accord donné: rien ne sort tant que tu ne l’as pas autorisé.';

  const rows = [
    { name: 'Base de données', out: false, text: 'Un fichier sur ton disque (data/). Pas de compte, pas de synchronisation.' },
    { name: 'Lecture et index des documents', out: false, text: 'Faits ici. Identifiants masqués et noms remplacés par des jetons avant toute écriture. L’index de recherche ne contient jamais le brut.' },
    { name: 'Calculs: anneaux, chocs, cas, estimation de biens', out: false, text: 'Moteur déterministe local, sans modèle. Aucune adresse ni valeur de bien n’est jamais envoyée.' },
    { name: 'Cours publics', out: pv.consentMarket !== null && !pv.envLocked, text: 'Requête de lecture de la liste complète des devises et cryptos, sans donnée personnelle, seulement avec ton accord. Sinon, saisie manuelle.' },
    { name: 'Interface', out: false, text: 'Aucune police, image ni script chargé depuis Internet.' },
    {
      name: 'Coach',
      out: provider === 'anthropic',
      text:
        provider === 'ollama'
          ? 'Modèle local sur cet ordinateur.'
          : provider === 'anthropic'
            ? 'Anthropic via l’API, avec ton accord: proportions et jetons seulement.'
            : 'Désactivé tant que rien n’est autorisé.',
    },
    { name: 'Conversation avec Claude', out: true, text: 'Hors d’Horizon: ce que tu y partages est traité par Anthropic. Ne partage que le texte déjà masqué de inbox/extracted.' },
  ];

  return (
    <div className="page">
      <h1>Confidentialité</h1>
      <p className="lede">{lede}</p>

      <section className="block">
        <h2>Mode</h2>
        <div className="seg" role="group" aria-label="Mode de confidentialité">
          <button className={pv.mode === 'local' ? 'on' : ''} onClick={() => act('privacy/mode', { mode: 'local' })}>Strict local</button>
          <button className={pv.mode === 'assisted' ? 'on' : ''} disabled={pv.envLocked} onClick={() => act('privacy/mode', { mode: 'assisted' })}>Assisté</button>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          Strict local: aucune donnée personnelle ne sort, jamais (seuls les cours publics, si tu les autorises). Assisté: le coach peut interroger Anthropic, uniquement après ton accord, et chaque envoi est journalisé.
        </p>

        {!pv.envLocked && (
          <div className="consent" style={{ marginTop: 14 }}>
            <label className="check-row">
              <input type="checkbox" checked={Boolean(pv.consentMarket)} onChange={(e) => act('privacy/consent', { purpose: 'market', value: e.target.checked })} />
              <span>Autoriser la récupération des cours publics (devises, cryptos), même en mode strict local. La requête demande la liste complète, jamais ce que tu détiens, et ne contient aucune donnée personnelle.</span>
            </label>
          </div>
        )}

        {pv.mode === 'assisted' && !pv.envLocked && (
          <div className="callout">
            {!pv.hasKey && <p>Aucune clé d’API n’est configurée. Dans un terminal, lance <code>bash scripts/set-key.sh</code>: macOS te demande la clé et la garde dans le trousseau, sans l’écrire dans un fichier. Les requêtes passent par ta propre clé, sans intermédiaire.</p>}
            <div className="consent">
              <label className="check-row">
                <input type="checkbox" checked={Boolean(pv.consentDocs)} onChange={(e) => act('privacy/consent', { purpose: 'coachDocs', value: e.target.checked })} />
                <span>Autoriser l’envoi d’extraits de mes documents au coach en ligne. Ils contiennent de vrais montants (identifiants masqués, noms remplacés par des jetons). Sans cet accord, le coach en ligne ne voit que des proportions.</span>
              </label>
            </div>
            <div className="consent">
              <label className="check-row">
                <input type="checkbox" checked={Boolean(pv.consentAnalysis)} onChange={(e) => act('privacy/consent', { purpose: 'analysis', value: e.target.checked })} />
                <span>Autoriser Claude à classer les libellés inconnus de mes relevés. Seuls des libellés réduits partent, numérotés, avec les noms remplacés par des jetons. Jamais de montant ni de date.</span>
              </label>
            </div>
            {pv.consentCoach ? (
              <>
                <strong>Accord donné le {new Date(pv.consentCoach).toLocaleString('fr-CH')}.</strong>
                <div className="actions"><button className="btn" onClick={() => act('privacy/consent', { purpose: 'coach', value: false })}>Révoquer l’accord</button></div>
              </>
            ) : (
              <>
                <label className="check-row">
                  <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} />
                  <span>J’ai relu le texte exact ci-dessous et j’autorise son envoi à Anthropic via l’API.</span>
                </label>
                <div className="actions">
                  <button className="btn primary" disabled={!read} onClick={() => act('privacy/consent', { purpose: 'coach', value: true })}>Autoriser le coach en ligne</button>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {pv.mode === 'assisted' && !pv.envLocked && (
        <section className="block">
          <h2>Dépenses Claude</h2>
          <p className="muted">
            Ce mois: {pv.usage.monthChf.toFixed(2)} CHF sur {pv.usage.capChf.toFixed(0)} CHF, {pv.usage.calls} appel{pv.usage.calls > 1 ? 's' : ''}. Au plafond, Horizon cesse d’appeler Claude jusqu’au mois suivant ou jusqu’à ce que tu l’augmentes.
          </p>
          <div className={'usage-bar' + (pv.usage.monthChf / pv.usage.capChf > 0.8 ? ' hot' : '')} role="img" aria-label="Part du plafond mensuel utilisée"><b style={{ width: `${Math.min(100, Math.round((pv.usage.monthChf / pv.usage.capChf) * 100))}%` }} /></div>
          <label className="usage-cap">Plafond par mois, en CHF
            <input type="number" min={1} max={1000} defaultValue={pv.usage.capChf} key={pv.usage.capChf} onBlur={(e) => { const v = Number(e.target.value); if (v > 0 && v !== pv.usage.capChf) act('privacy/cap', { capChf: v }); }} />
          </label>
          <p className="muted small" style={{ marginTop: 10 }}>Fixe aussi une limite dans la console Anthropic: c’est le garde-fou principal.</p>
        </section>
      )}

      <section className="block">
        <h2>Où vont tes données</h2>
        <ul className="list">
          {rows.map((r) => (
            <li key={r.name} className="row">
              <div className="row-main">
                <div className="row-title">{r.name}</div>
                <div className="row-sub">{r.text}</div>
              </div>
              <span className={'tag ' + (r.out ? 'assumed' : 'ok')}>{r.out ? 'Peut sortir' : 'Reste ici'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="block">
        <h2>Noms à protéger</h2>
        <p className="muted">
          Chaque nom, employeur ou adresse listé ici est remplacé par un jeton avant tout envoi, puis restauré chez toi dans la réponse. Le modèle ne voit jamais le terme.
        </p>
        {pv.terms.length > 0 && (
          <ul className="list" style={{ marginBottom: 12 }}>
            {pv.terms.map((t) => (
              <li key={`${t.kind}${t.n}`} className="row">
                <div className="row-main">
                  <div className="row-title">{t.term}</div>
                  <div className="row-sub">devient <code>[{t.kind.toUpperCase()}_{t.n}]</code></div>
                </div>
                <button className="btn ghost small" onClick={() => act('privacy/terms', { remove: { kind: t.kind, n: t.n } })} aria-label={`Retirer ${t.term}`}>Retirer</button>
              </li>
            ))}
          </ul>
        )}
        <form className="form inline" onSubmit={(e) => { e.preventDefault(); if (term.trim()) { act('privacy/terms', { term, kind }); setTerm(''); } }}>
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Par exemple: un prénom, un employeur, une rue" aria-label="Terme à protéger" />
          <select value={kind} onChange={(e) => setKind(e.target.value as keyof typeof KINDS)} aria-label="Type">
            {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn">Ajouter</button>
        </form>
        <p className="muted small">Les numéros AVS, IBAN, cartes, emails et téléphones sont déjà masqués automatiquement, sans que tu aies à les lister.</p>
      </section>

      <section className="block">
        <h2>Ce que le coach recevrait</h2>
        <p className="muted">Jamais de montant en francs: des parts, des ratios et des durées. {p ? `${p.replaced} terme${p.replaced > 1 ? 's' : ''} remplacé${p.replaced > 1 ? 's' : ''} par des jetons.` : ''}</p>
        <details className="assumptions">
          <summary>Voir le texte exact, tel qu’il serait envoyé</summary>
          <pre className="payload">{p ? p.payload : 'Chargement…'}</pre>
        </details>
      </section>

      <section className="block">
        <h2>Journal des envois</h2>
        {pv.egress.length === 0 ? (
          <p className="muted">Rien n’est jamais sorti de cet ordinateur.</p>
        ) : (
          <ul className="list">
            {pv.egress.map((e) => (
              <li key={e.id} className="row">
                <div className="row-main">
                  <div className="row-title">{e.destination}<span className="muted small"> {e.summary}</span></div>
                  <div className="row-sub">
                    {new Date(e.at).toLocaleString('fr-CH')}, {e.bytes.toLocaleString('fr-CH')} octets, empreinte {e.sha256.slice(0, 10)}
                    {e.reason ? `. ${e.reason}` : ''}
                  </div>
                </div>
                <span className={'tag ' + (e.allowed ? 'assumed' : 'ok')}>{e.allowed ? 'Envoyé' : 'Bloqué'}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small" style={{ marginTop: 10 }}>Le journal garde la taille et l’empreinte de chaque envoi, jamais son contenu.</p>
      </section>
    </div>
  );
}

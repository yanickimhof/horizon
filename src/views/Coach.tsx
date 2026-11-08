import { useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { api, type CoachReply, type Db, type State } from '../api';

interface Msg { role: 'user' | 'assistant'; content: string; meta?: Omit<CoachReply, 'text'> }

const IDEAS = [
  'Mon budget est-il équilibré sur 12 mois ?',
  'Où part mon argent, et qu’est-ce qui augmente ?',
  'Mes biens locatifs rapportent-ils vraiment ?',
  'Quelle marge ai-je pour une grosse dépense ?',
];

export function Coach({ db, state }: { db: Db; state: State }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const end = useRef<HTMLDivElement>(null);

  const send = async (m: string) => {
    if (!m.trim() || busy) return;
    const history = msgs;
    setMsgs([...history, { role: 'user', content: m }]);
    setText('');
    setBusy(true);
    setErr('');
    try {
      const r = await api.coach(db, m, history.map(({ role, content }) => ({ role, content })));
      setMsgs((x) => [...x, { role: 'assistant', content: r.text, meta: r }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  };

  if (state.llm.provider === 'off') {
    return (
      <div className="page">
        <h1>Coach</h1>
        <p className="lede">Le coach répond à partir de ta situation réelle, en distinguant ce qui est confirmé de ce qui est supposé.</p>
        <div className="callout">
          <strong>Le coach est désactivé: rien n’est autorisé à sortir.</strong>
          <p>Deux façons de l’activer, à ton choix. Entièrement local: installe ollama puis lance <code>HORIZON_LLM=ollama npm run dev</code>, rien ne quitte l’ordinateur. En ligne: passe en mode assisté dans l’onglet Confidentialité, relis le texte envoyé et donne ton accord.</p>
          <p>En attendant, la conversation avec Claude joue ce rôle et peut écrire dans la même base.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page coach">
      <h1>Coach</h1>
      <div className="thread" aria-live="polite">
        {msgs.length === 0 && (
          <div className="chips">
            {IDEAS.map((i) => <button key={i} className="chip" onClick={() => send(i)}>{i}</button>)}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={'bubble ' + m.role}>
            {m.content}
            {m.role === 'assistant' && m.meta && (
              <div className="cites">
                {m.meta.sources.length > 0
                  ? m.meta.sources.map((x) => (
                      <span key={x.n} className="cite" title={x.name}>
                        <FileText size={13} strokeWidth={1.5} aria-hidden="true" />[{x.n}] {x.name.split('/').pop()}{x.year ? ` ${x.year}` : ''}
                      </span>
                    ))
                  : m.meta.docsAvailable && !m.meta.docsAllowed
                    ? <span className="cite muted">Documents non consultés: autorise l’envoi d’extraits dans Confidentialité.</span>
                    : m.meta.docsAvailable
                      ? <span className="cite muted">Aucun passage pertinent trouvé dans tes documents.</span>
                      : null}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="bubble assistant muted">Réflexion…</div>}
        {err && <p className="error" role="alert">{err}</p>}
        <div ref={end} />
      </div>
      <form className="form inline" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Pose une question sur ta situation" aria-label="Question" />
        <button className="btn primary" disabled={busy}>Envoyer</button>
      </form>
    </div>
  );
}

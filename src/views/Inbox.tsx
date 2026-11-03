import { useState } from 'react';
import type { Fact } from '../core/types';
import { fmt } from '../api';

const KIND: Record<string, string> = {
  asset: 'Actif', liability: 'Dette', income: 'Revenu', expense: 'Dépense', goal: 'Projet', household: 'Foyer',
};
const VALUE_FIELD: Record<string, string> = {
  asset: 'value', liability: 'balance', income: 'amount', expense: 'amount', goal: 'targetAmount',
};

export function Inbox({ items, act, reveal }: { items: Fact[]; act: (route: string, body: unknown) => Promise<void>; reveal: boolean }) {
  if (items.length === 0) {
    return (
      <div className="empty">
        <h1>Rien à valider</h1>
        <p>Quand tu importes un document ou que tu dis quelque chose à Claude, ce qu’il en tire arrive ici avant d’entrer dans les calculs.</p>
      </div>
    );
  }
  return (
    <div className="page">
      <h1>À valider</h1>
      <p className="lede">Chaque proposition vient d’un extrait précis. Rien n’entre dans les calculs avant ton accord.</p>
      <ul className="list">
        {items.map((f) => (
          <Proposal key={f.id} f={f} act={act} reveal={reveal} />
        ))}
      </ul>
    </div>
  );
}

function Proposal({ f, act, reveal }: { f: Fact; act: (route: string, body: unknown) => Promise<void>; reveal: boolean }) {
  const field = VALUE_FIELD[f.kind];
  const initial = field ? Number(f.data[field] ?? 0) : 0;
  const [val, setVal] = useState(String(initial));
  const label = String(f.data.label ?? f.key);
  return (
    <li className="row stack">
      <div className="row-line">
        <div className="row-title">{label}</div>
        <span className="tag">{KIND[f.kind] ?? f.kind}</span>
      </div>
      {f.excerpt && <blockquote className="excerpt">{f.excerpt}</blockquote>}
      {f.why && <div className="row-sub">{f.why}</div>}
      {field && (
        <label className="inline-field">
          <span>{reveal ? 'Montant' : 'Montant (masqué ailleurs)'}</span>
          <input type="number" value={val} onChange={(e) => setVal(e.target.value)} />
          {f.data.frequency ? <em>{String(f.data.frequency)}</em> : null}
        </label>
      )}
      <div className="actions">
        <button className="btn primary" onClick={() => act('confirm', { id: f.id, patch: field ? { [field]: Number(val) } : {} })}>
          Confirmer{field && Number(val) !== initial ? ' avec la correction' : ''}
        </button>
        <button className="btn ghost" onClick={() => act('reject', { id: f.id })}>
          Refuser
        </button>
        <span className="muted small">Certitude de l’extraction {fmt.pct(f.confidence)}</span>
      </div>
    </li>
  );
}

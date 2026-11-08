import { useState } from 'react';
import { Baby, Calculator, ChevronDown, ChevronRight, Trash2, GraduationCap, Hammer, History, Pencil, PiggyBank, Plus, RefreshCw, X } from 'lucide-react';
import type { Fact } from '../core/types';
import { api, fmt, type Db, type State } from '../api';
import { ACCOUNT_TYPES } from '../engine/accounts';
import { ASSET_CATALOG, CATALOG_GROUPS, catalogEntry } from '../engine/catalog';
import { CASES, type CaseId } from '../engine/assumptions';
import { comparablesStats, estimateProperty, projectValue, propertyInputFromData, type Comparable, type PropertyInput } from '../engine/property';
import { LIFE_EVENTS, type LifeEventDef } from '../engine/events';

type Act = (route: string, body: unknown) => Promise<void>;

const FREQ: Record<string, string> = {
  weekly: 'par semaine', monthly: 'par mois', quarterly: 'par trimestre', semiannual: 'par semestre', annual: 'par an', once: 'une fois',
};
const CLASSES: Record<string, string> = {
  cash: 'Liquidités', securities: 'Titres', crypto: 'Crypto', real_estate: 'Immobilier', pension: 'Prévoyance', business: 'Entreprise', other: 'Autre',
};
const EXPENSE_CATEGORIES: Record<string, string> = {
  housing: 'Logement', food: 'Alimentation', insurance: 'Assurances', mobility: 'Mobilité', family: 'Famille et enfants', lifestyle: 'Loisirs et style de vie', tax: 'Impôts', health: 'Santé', other: 'Autre',
};
const CURRENCIES = ['CHF', 'EUR', 'USD', 'GBP', 'JPY', 'CAD', 'AUD'];
const IC = { size: 16, strokeWidth: 1.5 } as const;

interface Section {
  kind: 'asset' | 'liability' | 'income' | 'expense' | 'goal';
  title: string;
  field: string;
  flow?: boolean;
}
const SECTIONS: Section[] = [
  { kind: 'asset', title: 'Actifs', field: 'value' },
  { kind: 'liability', title: 'Dettes', field: 'balance' },
  { kind: 'income', title: 'Revenus', field: 'amount', flow: true },
  { kind: 'expense', title: 'Dépenses', field: 'amount', flow: true },
  { kind: 'goal', title: 'Projets', field: 'targetAmount' },
];

const mask = (reveal: boolean, text: string) => (reveal ? text : '••••');

export function Data({ db, state, setState, act, reveal }: { db: Db; state: State; setState: (s: State) => void; act: Act; reveal: boolean }) {
  return (
    <div className="page">
      <h1>Données</h1>
      <p className="lede">
        Tout ce que l’outil sait de ta situation. Les lignes <span className="tag assumed">Supposé</span> sont des valeurs standard ou des estimations: corrige-les dès que tu as la vraie.
      </p>
      <Household fact={state.facts.find((f) => f.kind === 'household')} act={act} />
      <LifeEvents act={act} />
      {SECTIONS.map((s) => (
        <Block key={s.kind} db={db} section={s} facts={state.facts.filter((f) => f.kind === s.kind)} state={state} act={act} reveal={reveal} />
      ))}
      <Rates db={db} state={state} setState={setState} act={act} />
    </div>
  );
}

interface Member { name: string; role: 'adult' | 'child'; birthYear: string; retirementAge: string; note: string }

function Household({ fact, act }: { fact?: Fact; act: Act }) {
  const d = (fact?.data ?? {}) as Record<string, any>;
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ owner: Boolean(d.owner), retirementAge: d.retirementAge ?? 65, birthYear: d.birthYear ?? 1980 });
  const fromData = (): Member[] =>
    Array.isArray(d.members) && d.members.length
      ? d.members.map((m: any) => ({ name: String(m.name ?? ''), role: m.role === 'child' ? 'child' : 'adult', birthYear: m.birthYear ? String(m.birthYear) : '', retirementAge: m.retirementAge ? String(m.retirementAge) : '', note: String(m.note ?? '') }))
      : [
          ...Array.from({ length: d.adults ?? 1 }, (_, i): Member => ({ name: '', role: 'adult', birthYear: i === 0 && d.birthYear ? String(d.birthYear) : '', retirementAge: i === 0 && d.retirementAge ? String(d.retirementAge) : '', note: '' })),
          ...Array.from({ length: d.children ?? 0 }, (): Member => ({ name: '', role: 'child', birthYear: '', retirementAge: '', note: '' })),
        ];
  const [members, setMembers] = useState<Member[]>(fromData);
  if (!fact) return null;
  const upd = (i: number, patch: Partial<Member>) => setMembers(members.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const save = async () => {
    const clean = members.filter((m) => m.name.trim() || m.birthYear);
    const adults = clean.filter((m) => m.role === 'adult');
    const main = adults[0];
    await act('correct', {
      key: 'household',
      patch: {
        members: clean.map((m) => ({ name: m.name.trim(), role: m.role, ...(m.birthYear ? { birthYear: Number(m.birthYear) } : {}), ...(m.retirementAge ? { retirementAge: Number(m.retirementAge) } : {}), ...(m.note.trim() ? { note: m.note.trim() } : {}) })),
        adults: Math.max(1, adults.length),
        children: clean.filter((m) => m.role === 'child').length,
        owner: f.owner,
        birthYear: main?.birthYear ? Number(main.birthYear) : f.birthYear,
        retirementAge: main?.retirementAge ? Number(main.retirementAge) : f.retirementAge,
      },
      why: 'Corrigé par l’utilisateur',
    });
    setEdit(false);
  };
  const year = new Date().getFullYear();
  return (
    <section className="block">
      <div className="block-head">
        <h2>Famille</h2>
        <button className="icon-btn small" aria-label={edit ? 'Fermer' : 'Modifier la famille'} title={edit ? 'Fermer' : 'Modifier'} onClick={() => setEdit(!edit)}>{edit ? <X {...IC} /> : <Pencil {...IC} />}</button>
      </div>
      {!edit ? (
        <>
          {Array.isArray(d.members) && d.members.length > 0 ? (
            <ul className="list">
              {d.members.map((m: any, i: number) => (
                <li key={i} className="row">
                  <div className="row-main">
                    <div className="row-title">{m.name || (m.role === 'child' ? 'Enfant' : 'Adulte')}</div>
                    <div className="row-sub">{[m.role === 'child' ? 'enfant' : 'adulte', m.birthYear ? `${year - m.birthYear} ans (né${m.role === 'child' ? '' : ''} en ${m.birthYear})` : 'âge à renseigner', m.retirementAge ? `retraite à ${m.retirementAge} ans` : '', m.note].filter(Boolean).join(', ')}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="muted small">
            {d.adults} adulte{d.adults > 1 ? 's' : ''}, {d.children} enfant{d.children > 1 ? 's' : ''}, {d.owner ? 'propriétaire' : 'locataire'}. Les noms restent sur ce Mac et sont remplacés par des jetons dans tout ce qui part vers un modèle.
          </p>
        </>
      ) : (
        <div className="form">
          {members.map((m, i) => (
            <div key={i} className="est-grid">
              <label>Nom<input value={m.name} onChange={(e) => upd(i, { name: e.target.value })} /></label>
              <label>Rôle
                <select value={m.role} onChange={(e) => upd(i, { role: e.target.value as Member['role'] })}>
                  <option value="adult">Adulte</option>
                  <option value="child">Enfant</option>
                </select>
              </label>
              <label>Année de naissance<input type="number" value={m.birthYear} onChange={(e) => upd(i, { birthYear: e.target.value })} /></label>
              {m.role === 'adult' && <label>Âge de la retraite<input type="number" value={m.retirementAge} onChange={(e) => upd(i, { retirementAge: e.target.value })} /></label>}
              <label>Précision (études, situation)<input value={m.note} onChange={(e) => upd(i, { note: e.target.value })} /></label>
              <button className="icon-btn small" onClick={() => setMembers(members.filter((_, j) => j !== i))} aria-label="Retirer cette personne" title="Retirer"><Trash2 {...IC} /></button>
            </div>
          ))}
          <div className="actions">
            <button className="btn small" onClick={() => setMembers([...members, { name: '', role: 'adult', birthYear: '', retirementAge: '', note: '' }])}>Ajouter une personne</button>
          </div>
          <label className="check"><input type="checkbox" checked={f.owner} onChange={(e) => setF({ ...f, owner: e.target.checked })} />Propriétaire</label>
          <button className="btn primary" onClick={save}>Enregistrer</button>
        </div>
      )}
    </section>
  );
}

function Block({ db, section, facts, state, act, reveal }: { db: Db; section: Section; facts: Fact[]; state: State; act: Act; reveal: boolean }) {
  const [adding, setAdding] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const assumedKeys = section.kind === 'expense' || section.kind === 'income' ? facts.filter((f) => f.status === 'assumed').map((f) => f.key) : [];
  return (
    <section className="block">
      <div className="block-head">
        <h2>{section.title}</h2>
        {assumedKeys.length > 0 && (confirmAll ? (
          <span className="row-edit">
            <span className="muted small">Retirer {assumedKeys.length} ligne{assumedKeys.length > 1 ? 's' : ''} supposée{assumedKeys.length > 1 ? 's' : ''} ?</span>
            <button className="btn small" onClick={async () => { await act('retire', { keys: assumedKeys }); setConfirmAll(false); }}>Oui</button>
            <button className="icon-btn small" onClick={() => setConfirmAll(false)} aria-label="Annuler" title="Annuler"><X {...IC} /></button>
          </span>
        ) : (
          <button className="btn small" onClick={() => setConfirmAll(true)} title="Retirer toutes les lignes marquées « supposé »">Retirer les {assumedKeys.length} supposées</button>
        ))}
        <button className="icon-btn small" aria-label={adding ? 'Fermer' : `Ajouter: ${section.title}`} title={adding ? 'Fermer' : 'Ajouter'} onClick={() => setAdding(!adding)}>{adding ? <X {...IC} /> : <Plus {...IC} />}</button>
      </div>
      {adding && <AddForm section={section} act={act} done={() => setAdding(false)} />}
      {facts.length === 0 ? (
        <p className="muted">Rien pour l’instant.</p>
      ) : (
        <ul className="list">
          {[...facts].sort((a, b) => String(a.data.label).localeCompare(String(b.data.label), 'fr')).map((f) => (
            <Line key={f.id} db={db} f={f} section={section} state={state} act={act} reveal={reveal} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Line({ db, f, section, state, act, reveal }: { db: Db; f: Fact; section: Section; state: State; act: Act; reveal: boolean }) {
  const d = f.data as Record<string, any>;
  const field = section.kind === 'asset' && d.symbol ? 'quantity' : section.field;
  const [edit, setEdit] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [val, setVal] = useState(String(d[field] ?? 0));
  const [label, setLabel] = useState(String(d.label ?? ''));
  const [category, setCategory] = useState(String(d.category ?? 'other'));
  const [essential, setEssential] = useState(d.essential !== false);
  const [stable, setStable] = useState(Boolean(d.stable));
  const [startYear, setStartYear] = useState(d.startYear ? String(d.startYear) : '');
  const [endYear, setEndYear] = useState(d.endYear ? String(d.endYear) : '');
  const [ccyEdit, setCcyEdit] = useState(String(d.currency ?? 'CHF'));
  const [confirmDel, setConfirmDel] = useState(false);
  const [subtypeEdit, setSubtypeEdit] = useState(String(d.subtype ?? ''));
  const [shareEdit, setShareEdit] = useState(typeof d.share === 'number' ? String(Math.round(d.share * 100)) : '100');
  const [rateEdit, setRateEdit] = useState(typeof d.rate === 'number' ? String(Math.round(d.rate * 10000) / 100) : '');
  const [variableEdit, setVariableEdit] = useState(Boolean(d.variable));
  const [targetYearEdit, setTargetYearEdit] = useState(d.targetYear ? String(d.targetYear) : '');
  const [savedEdit, setSavedEdit] = useState(d.saved !== undefined ? String(d.saved) : '');
  const [hist, setHist] = useState<Awaited<ReturnType<typeof api.history>>['versions'] | null>(null);
  const [freq, setFreq] = useState(String(d.frequency ?? 'monthly'));
  const assumed = f.status === 'assumed' || f.origin === 'inferred';
  const snap = section.kind === 'asset' ? state.snapshot.assets.find((a) => a.key === f.key) : section.kind === 'liability' ? state.snapshot.liabilities.find((a) => a.key === f.key) : undefined;
  const ccy = String(d.currency ?? 'CHF');
  const account = ACCOUNT_TYPES.find((a) => a.id === d.account)?.label;
  const sub =
    section.kind === 'asset' ? [catalogEntry(d.subtype)?.label ?? CLASSES[d.class] ?? d.class, account && !catalogEntry(d.subtype) ? account : '', d.symbol, ccy !== 'CHF' && !d.symbol ? ccy : '', typeof d.share === 'number' && d.share < 1 ? `part ${Math.round(d.share * 100)} %` : ''].filter(Boolean).join(', ')
    : section.flow ? [d.frequency === 'once' ? `ponctuelle${d.startYear ? ' en ' + d.startYear : ''}` : FREQ[d.frequency] ?? d.frequency, d.frequency !== 'once' && d.startYear ? `dès ${d.startYear}` : d.startAge ? `dès ${d.startAge} ans` : '', d.frequency !== 'once' && d.endYear ? `jusqu’en ${d.endYear}` : ''].filter(Boolean).join(', ')
    : section.kind === 'goal' ? `pour ${d.targetYear}`
    : `taux ${(Number(d.rate) * 100).toFixed(2).replace('.', ',')} %${d.variable ? ', variable' : ''}${ccy !== 'CHF' ? ', ' + ccy : ''}`;
  const display = d.symbol ? `${d[field]} ${d.symbol}` : ccy !== 'CHF' ? fmt.money(Number(d[field] ?? 0), ccy) : fmt.money(Number(d[field] ?? 0));

  const recalc = async () => {
    const est = estimateProperty(propertyInputFromData(d));
    if (!est) return;
    await act('correct', {
      key: f.key,
      patch: { value: Math.round(est.central), valueSource: 'estimate', estimateLow: Math.round(est.low), estimateHigh: Math.round(est.high), valueNote: `Estimation recalculée le ${new Date().toLocaleDateString('fr-CH')}` },
      origin: 'inferred',
      why: `Estimation: ${est.methods.map((m) => m.label.toLowerCase()).join(', ')}`,
    });
  };
  const save = async () => {
    const patch: Record<string, unknown> = { [field]: Number(val) };
    if (label.trim() && label.trim() !== d.label) patch.label = label.trim();
    if (section.flow) {
      patch.frequency = freq;
      patch.startYear = startYear === '' ? null : Number(startYear);
      patch.endYear = endYear === '' ? null : Number(endYear);
    }
    if (section.kind === 'expense') { patch.category = category; patch.essential = essential; }
    if (section.kind === 'income') patch.stable = stable;
    if (section.kind === 'asset' && !d.symbol && subtypeEdit && subtypeEdit !== d.subtype) {
      const ce = catalogEntry(subtypeEdit);
      if (ce) { patch.subtype = subtypeEdit; patch.class = ce.class; }
    }
    if (section.kind === 'asset' || section.kind === 'liability') {
      const sh = Math.min(100, Math.max(0, Number(shareEdit) || 100)) / 100;
      patch.share = sh;
    }
    if (section.kind === 'liability') {
      if (rateEdit !== '') patch.rate = Number(rateEdit) / 100;
      patch.variable = variableEdit;
    }
    if (section.kind === 'goal') {
      if (targetYearEdit !== '') patch.targetYear = Number(targetYearEdit);
      if (savedEdit !== '') patch.saved = Number(savedEdit);
    }
    if ((section.kind === 'asset' || section.kind === 'liability') && !d.symbol && ccyEdit !== (d.currency ?? 'CHF')) patch.currency = ccyEdit;
    await act('correct', { key: f.key, patch, why: 'Corrigé par l’utilisateur' });
    setEdit(false);
  };
  return (
    <li className="row wrap">
      <div className="row-main">
        <div className="row-title">
          {d.label}
          {assumed && <span className="tag assumed" title={f.why ?? ''}>Supposé</span>}
          {snap && 'rateMissing' in snap && snap.rateMissing && <span className="tag assumed">Cours manquant</span>}
        </div>
        <div className="row-sub">
          {sub}
          {assumed && f.why ? `. ${f.why}` : ''}
          {snap && 'accessNote' in snap && snap.accessNote ? `. ${snap.accessNote}` : ''}
        </div>
      </div>
      {!edit ? (
        <>
          <div className="row-end amount">{mask(reveal, display)}</div>
          {section.kind === 'asset' && d.class === 'real_estate' && (
            <button className="icon-btn small" aria-label={`Recalculer ${d.label}`} title="Recalculer avec les données enregistrées" onClick={recalc}><RefreshCw {...IC} /></button>
          )}
          {section.kind === 'asset' && d.class === 'real_estate' && (
            <button className="icon-btn small" aria-label={`Estimer ${d.label}`} title="Estimer la valeur" onClick={() => setEstimating(!estimating)}><Calculator {...IC} /></button>
          )}
          <button className="icon-btn small" onClick={async () => setHist(hist ? null : (await api.history(db, f.key)).versions)} aria-label={`Historique de ${d.label}`} title="Historique des valeurs"><History {...IC} /></button>
          <button className="icon-btn small" onClick={() => setEdit(true)} aria-label={`Modifier ${d.label}`} title="Modifier"><Pencil {...IC} /></button>
          {!confirmDel ? (
            <button className="icon-btn small" onClick={() => setConfirmDel(true)} aria-label={`Retirer ${d.label}`} title="Retirer cette ligne"><Trash2 {...IC} /></button>
          ) : (
            <span className="row-edit">
              <span className="muted small">Retirer ?</span>
              <button className="btn small" onClick={async () => { await act('retire', { key: f.key }); }}>Oui</button>
              <button className="icon-btn small" onClick={() => setConfirmDel(false)} aria-label="Annuler" title="Annuler"><X {...IC} /></button>
            </span>
          )}
        </>
      ) : (
        <div className="row-edit">
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Nom" placeholder="Nom" />
          <input type="number" step="any" autoFocus value={val} onChange={(e) => setVal(e.target.value)} aria-label={d.symbol ? 'Quantité' : 'Montant'} />
          {section.flow && (
            <select value={freq} onChange={(e) => setFreq(e.target.value)} aria-label="Fréquence">
              {Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}
          {section.kind === 'expense' && (
            <>
              <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Catégorie">
                {Object.entries(EXPENSE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <label className="check-row"><input type="checkbox" checked={essential} onChange={(e) => setEssential(e.target.checked)} /><span>Essentielle</span></label>
            </>
          )}
          {section.kind === 'income' && (
            <label className="check-row"><input type="checkbox" checked={stable} onChange={(e) => setStable(e.target.checked)} /><span>Stable</span></label>
          )}
          {section.flow && (
            <>
              <input type="number" value={startYear} onChange={(e) => setStartYear(e.target.value)} placeholder="Dès (année)" aria-label="Année de début" style={{ maxWidth: 120 }} />
              <input type="number" value={endYear} onChange={(e) => setEndYear(e.target.value)} placeholder="Jusqu’en" aria-label="Année de fin" style={{ maxWidth: 120 }} />
            </>
          )}
          {section.kind === 'asset' && !d.symbol && (
            <select value={subtypeEdit} onChange={(e) => setSubtypeEdit(e.target.value)} aria-label="Type">
              {!catalogEntry(subtypeEdit) && <option value={subtypeEdit}>{subtypeEdit || 'Type'}</option>}
              {CATALOG_GROUPS.map((g) => (
                <optgroup key={g} label={g}>{ASSET_CATALOG.filter((e) => e.group === g).map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</optgroup>
              ))}
            </select>
          )}
          {(section.kind === 'asset' || section.kind === 'liability') && (
            <input type="number" min={0} max={100} value={shareEdit} onChange={(e) => setShareEdit(e.target.value)} aria-label="Part détenue (%)" title="Part détenue (%)" style={{ maxWidth: 90 }} />
          )}
          {section.kind === 'liability' && (
            <>
              <input type="number" step="any" value={rateEdit} onChange={(e) => setRateEdit(e.target.value)} placeholder="Taux %" aria-label="Taux (%)" style={{ maxWidth: 90 }} />
              <label className="check-row"><input type="checkbox" checked={variableEdit} onChange={(e) => setVariableEdit(e.target.checked)} /><span>Variable</span></label>
            </>
          )}
          {section.kind === 'goal' && (
            <>
              <input type="number" value={targetYearEdit} onChange={(e) => setTargetYearEdit(e.target.value)} placeholder="Année" aria-label="Année visée" style={{ maxWidth: 110 }} />
              <input type="number" step="any" value={savedEdit} onChange={(e) => setSavedEdit(e.target.value)} placeholder="Déjà mis de côté" aria-label="Déjà mis de côté" />
            </>
          )}
          {(section.kind === 'asset' || section.kind === 'liability') && !d.symbol && (
            <select value={ccyEdit} onChange={(e) => setCcyEdit(e.target.value)} aria-label="Devise">
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <button className="btn primary small" onClick={save}>Enregistrer</button>
          <button className="icon-btn small" onClick={() => setEdit(false)} aria-label="Annuler" title="Annuler"><X {...IC} /></button>
        </div>
      )}
      {hist && (
        <ul className="list" style={{ width: '100%' }}>
          {hist.map((v, i) => (
            <li key={i} className="row">
              <div className="row-main">
                <div className="row-sub">{new Date(v.at).toLocaleDateString('fr-CH')}{v.status === 'superseded' ? ', remplacée' : ', en vigueur'}{v.why ? `. ${v.why}` : ''}</div>
              </div>
              <div className="row-end amount">{mask(reveal, v.data.symbol ? `${v.data[field]} ${v.data.symbol}` : fmt.money(Number(v.data[field] ?? 0), String(v.data.currency ?? 'CHF')))}</div>
            </li>
          ))}
        </ul>
      )}
      {estimating && <PropertyEstimator fact={f} state={state} act={act} reveal={reveal} done={() => setEstimating(false)} />}
    </li>
  );
}

function AddForm({ section, act, done }: { section: Section; act: Act; done: () => void }) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [freq, setFreq] = useState('monthly');
  const [subtype, setSubtype] = useState('current');
  const [ccy, setCcy] = useState('CHF');
  const [symbol, setSymbol] = useState('BTC');
  const [share, setShare] = useState('100');
  const [months, setMonths] = useState('');
  const [haircut, setHaircut] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear() + 2));
  const entry = catalogEntry(subtype);
  const cls = entry?.class ?? 'other';
  const crypto = section.kind === 'asset' && cls === 'crypto';
  const accountIds = ACCOUNT_TYPES.map((a) => a.id as string);
  const hasShare = section.kind === 'asset' || section.kind === 'liability';

  const pickType = (id: string) => {
    setSubtype(id);
    if (['401k', 'ira', 'roth'].includes(id)) setCcy('USD');
    else if (['lpp', '3a'].includes(id)) setCcy('CHF');
  };

  const submit = async () => {
    if (!label.trim() || amount === '') return;
    const n = Number(amount);
    const sh = Math.min(100, Math.max(0, Number(share) || 100)) / 100;
    const key = `${section.kind}:${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}-${Date.now().toString(36)}`;
    const adv: Record<string, unknown> = {};
    if (months !== '') adv.liquidityMonths = Number(months);
    if (haircut !== '') adv.haircut = Math.min(100, Math.max(0, Number(haircut))) / 100;
    const data: Record<string, unknown> =
      section.kind === 'asset'
        ? crypto
          ? { label, class: 'crypto', subtype, symbol: symbol.toUpperCase(), quantity: n, currency: 'USD', region: 'WORLD', ...(sh < 1 ? { share: sh } : {}), ...adv }
          : {
              label, class: cls, subtype, value: n, currency: ccy,
              region: ccy === 'CHF' ? 'CH' : ccy === 'USD' ? 'US' : 'WORLD',
              ...(accountIds.includes(subtype) ? { account: subtype } : {}),
              ...(sh < 1 ? { share: sh } : {}),
              ...adv,
            }
      : section.kind === 'liability' ? { label, balance: n, currency: ccy, rate: 0.02, variable: false, ...(sh < 1 ? { share: sh } : {}) }
      : section.kind === 'income' ? { label, amount: n, frequency: freq, stable: false }
      : section.kind === 'expense' ? { label, category: 'other', amount: n, frequency: freq, essential: true }
      : { label, targetAmount: n, targetYear: Number(year), saved: 0 };
    await act('add', { draft: { kind: section.kind, key, data, why: 'Ajouté à la main' } });
    done();
  };

  return (
    <div className="form">
      <label>Nom<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nom de la ligne" /></label>
      {section.kind === 'asset' && (
        <>
          <label>Type
            <select value={subtype} onChange={(e) => pickType(e.target.value)}>
              {CATALOG_GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {ASSET_CATALOG.filter((e) => e.group === g).map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          {entry?.hint && <p className="muted small hint">{entry.hint}</p>}
        </>
      )}
      {crypto && <label>Symbole<input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="BTC, ETH…" /></label>}
      <label>{crypto ? 'Quantité détenue' : 'Montant'}<input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      {((section.kind === 'asset' && !crypto) || section.kind === 'liability') && (
        <label>Devise
          <input list="ccy" value={ccy} onChange={(e) => setCcy(e.target.value.toUpperCase())} />
          <datalist id="ccy">{CURRENCIES.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
      )}
      {hasShare && <label>Part détenue (%)<input type="number" min={0} max={100} value={share} onChange={(e) => setShare(e.target.value)} /></label>}
      {section.flow && (
        <label>Fréquence
          <select value={freq} onChange={(e) => setFreq(e.target.value)}>
            {Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      )}
      {section.kind === 'goal' && <label>Année visée<input type="number" value={year} onChange={(e) => setYear(e.target.value)} /></label>}
      {section.kind === 'asset' && (
        <details className="adv">
          <summary>Avancé: mobilisation et perte à la sortie</summary>
          <label>Mobilisable après (mois)<input type="number" min={0} value={months} onChange={(e) => setMonths(e.target.value)} placeholder="Selon le type" /></label>
          <label>Perte à la sortie (%)<input type="number" min={0} max={100} value={haircut} onChange={(e) => setHaircut(e.target.value)} placeholder="Selon le type" /></label>
          <p className="muted small">Impôts, frais, décote. Laisse vide pour garder les valeurs du type.</p>
        </details>
      )}
      <button className="btn primary" onClick={submit}>Ajouter</button>
    </div>
  );
}

function PropertyEstimator({ fact, state, act, reveal, done }: { fact: Fact; state: State; act: Act; reveal: boolean; done: () => void }) {
  const d = fact.data as Record<string, any>;
  const NUM = ['ownerValue', 'ownerValueYear', 'purchasePrice', 'purchaseYear', 'worksValue', 'indexSincePurchase', 'fiscalValue', 'netRentAnnual', 'areaM2', 'terraceM2', 'gardenM2', 'cellarM2', 'pricePerM2', 'parkingIndoor', 'parkingOutdoor', 'parkingIndoorValue', 'parkingOutdoorValue', 'rooms', 'yearBuilt', 'floor'] as const;
  const TXT = ['address', 'commune', 'propertyType', 'condition', 'situation', 'energyLabel'] as const;
  const [f, setF] = useState<Record<string, string>>({
    ...Object.fromEntries([...NUM, ...TXT].map((k) => [k, d[k] ?? ''])),
    // La valeur déjà saisie par le propriétaire sert d'ancre tant qu'aucune estimation de l'outil n'existe.
    ownerValue: String(d.ownerValue ?? (d.valueSource === 'owner_estimate' && d.value > 0 ? d.value : '')),
    ownerValueYear: String(d.ownerValueYear ?? (/\b(20\d\d)\b/.exec(String(d.valueNote ?? ''))?.[1] ?? '')),
  });
  const [comps, setComps] = useState<{ price: string; area: string }[]>(
    Array.isArray(d.comparables) && d.comparables.length ? d.comparables.map((c: Comparable) => ({ price: String(c.price), area: String(c.areaM2) })) : [{ price: '', area: '' }],
  );
  const compList: Comparable[] = comps.map((c) => ({ price: Number(c.price), areaM2: Number(c.area) }));
  const cstats = comparablesStats(compList);
  const n = (k: string) => (f[k] === '' || f[k] === undefined ? undefined : Number(f[k]));
  const input: PropertyInput = {
    ownerValue: n('ownerValue'), ownerValueYear: n('ownerValueYear'), purchasePrice: n('purchasePrice'), purchaseYear: n('purchaseYear'), worksValue: n('worksValue'), indexSincePurchase: n('indexSincePurchase'),
    fiscalValue: n('fiscalValue'), netRentAnnual: n('netRentAnnual'), areaM2: n('areaM2'), terraceM2: n('terraceM2'), gardenM2: n('gardenM2'), cellarM2: n('cellarM2'),
    pricePerM2: n('pricePerM2') ?? (cstats && cstats.n >= 2 ? Math.round(cstats.median) : undefined), comparablesSpread: n('pricePerM2') ? undefined : cstats?.spread, parkingIndoor: n('parkingIndoor'), parkingOutdoor: n('parkingOutdoor'),
    parkingIndoorValue: n('parkingIndoorValue'), parkingOutdoorValue: n('parkingOutdoorValue'),
    condition: (f.condition || undefined) as PropertyInput['condition'], situation: (f.situation || undefined) as PropertyInput['situation'],
  };
  const est = estimateProperty(input);
  const hh = state.snapshot.household;
  const years = Math.max(0, hh.retirementAge - (new Date().getFullYear() - hh.birthYear));
  const field = (k: string, label: string, hint?: string) => (
    <label>{label}<input type="number" step="any" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={hint} /></label>
  );
  const pick = (k: string, label: string, options: [string, string][]) => (
    <label>{label}
      <select value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
        <option value="">Non précisé</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
  const use = async () => {
    if (!est) return;
    const patch: Record<string, unknown> = { value: Math.round(est.central), valueSource: 'estimate', estimateLow: Math.round(est.low), estimateHigh: Math.round(est.high) };
    for (const k of NUM) if (n(k) !== undefined) patch[k] = n(k);
    for (const k of TXT) if (f[k]) patch[k] = f[k];
    const valid = compList.filter((c) => c.price > 0 && c.areaM2 > 0);
    if (valid.length) patch.comparables = valid;
    await act('correct', { key: fact.key, patch, origin: 'inferred', why: `Estimation: ${est.methods.map((m) => m.label.toLowerCase()).join(', ')}` });
    done();
  };
  return (
    <div className="est">
      <p className="muted small">Rien n’est envoyé nulle part: l’estimation se fait ici, à partir de ce que tu sais, sans l’adresse. Renseigne ce que tu as, une seule donnée suffit; plus tu en donnes, plus la fourchette est serrée.</p>
      <h3 className="est-h">Situation</h3>
      <p className="muted small">L’adresse sert à te rappeler de quel bien il s’agit et à trouver le bon prix au m² (le quartier compte autant que la surface). Elle reste sur ce Mac, n’est jamais envoyée pour estimer, et est masquée dans tout ce qui part vers un modèle.</p>
      <div className="est-grid">
        <label>Adresse<input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
        <label>Commune<input value={f.commune} onChange={(e) => setF({ ...f, commune: e.target.value })} /></label>
      </div>
      <h3 className="est-h">Dernière estimation connue</h3>
      <div className="est-grid">
        {field('ownerValue', 'Valeur estimée (banque, courtier, toi)')}
        {field('ownerValueYear', 'Année de cette estimation')}
      </div>
      <h3 className="est-h">Achat</h3>
      <div className="est-grid">
        {field('purchasePrice', 'Prix d’achat (hors frais de notaire)')}
        {field('purchaseYear', 'Année d’achat')}
        {field('worksValue', 'Travaux valorisants depuis l’achat')}
        {field('indexSincePurchase', 'Indice depuis l’achat', 'ex. 1,18')}
      </div>
      <h3 className="est-h">Le bien</h3>
      <div className="est-grid">
        {pick('propertyType', 'Type', [['apartment', 'Appartement'], ['house', 'Maison'], ['building', 'Immeuble de rapport'], ['land', 'Terrain'], ['parking', 'Parking ou box']])}
        {field('areaM2', 'Surface habitable (m²)')}
        {field('terraceM2', 'Balcon et terrasse (m²)')}
        {field('gardenM2', 'Jardin privatif (m²)')}
        {field('cellarM2', 'Cave et annexes (m²)')}
        {field('rooms', 'Pièces')}
        {field('floor', 'Étage')}
        {field('yearBuilt', 'Année de construction')}
        {pick('condition', 'État', [['to_renovate', 'À rénover'], ['to_refresh', 'À rafraîchir'], ['good', 'Bon état'], ['renovated', 'Rénové récemment']])}
        {pick('situation', 'Situation', [['noisy', 'Bruyante ou vis-à-vis'], ['standard', 'Standard'], ['quiet_view', 'Calme ou belle vue']])}
        {pick('energyLabel', 'Classe énergétique', ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((x) => [x, x] as [string, string]))}
      </div>
      <h3 className="est-h">Places de parc</h3>
      <div className="est-grid">
        {field('parkingIndoor', 'Intérieures (nombre)')}
        {field('parkingIndoorValue', 'Valeur unitaire intérieure', 'sinon indicatif')}
        {field('parkingOutdoor', 'Extérieures (nombre)')}
        {field('parkingOutdoorValue', 'Valeur unitaire extérieure', 'sinon indicatif')}
      </div>
      <h3 className="est-h">Biens comparables à proximité</h3>
      <p className="muted small">Ajoute 3 à 6 biens similaires vendus ou en vente dans le même quartier (annonces, estimation d’une banque, prix d’un voisin). Horizon prend la médiane du prix au m² et s’en sert pour la fourchette: plus ils sont nombreux et proches, plus elle se resserre.</p>
      {comps.map((c, i) => (
        <div key={i} className="est-grid">
          <label>Prix demandé ou vendu<input type="number" step="any" value={c.price} onChange={(e) => setComps(comps.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} /></label>
          <label>Surface habitable (m²)<input type="number" step="any" value={c.area} onChange={(e) => setComps(comps.map((x, j) => (j === i ? { ...x, area: e.target.value } : x)))} /></label>
        </div>
      ))}
      <div className="actions">
        <button className="btn small" onClick={() => setComps([...comps, { price: '', area: '' }])}>Ajouter un bien</button>
        {cstats && <span className="muted small">{cstats.n} bien{cstats.n > 1 ? 's' : ''}, médiane {mask(reveal, `${Math.round(cstats.median).toLocaleString('de-CH')} par m²`)}{cstats.n < 3 ? ' (avec moins de 3 biens, la dispersion n’est pas évaluée)' : ''}</span>}
      </div>
      <h3 className="est-h">Autres repères</h3>
      <div className="est-grid">
        {field('pricePerM2', 'Prix au m² connu (remplace les comparables)')}
        {field('fiscalValue', 'Valeur fiscale')}
        {field('netRentAnnual', 'Loyer net annuel')}
      </div>
      {est && !input.pricePerM2 && (
        <p className="muted small">Sans prix au m² d’un bien comparable dans le même quartier, l’estimation repose seulement sur le prix d’achat indexé: c’est la donnée qui change le plus le résultat. Annonces proches, estimation d’une banque ou d’un courtier, ou prix payé par un voisin sont de bonnes sources.</p>
      )}
      {est ? (
        <div className="est-out">
          <div className="est-range">
            <span>{mask(reveal, fmt.money(est.low))}</span>
            <strong>{mask(reveal, fmt.money(est.central))}</strong>
            <span>{mask(reveal, fmt.money(est.high))}</span>
          </div>
          <div className="muted small">Fourchette basse, estimation centrale, fourchette haute. Certitude {est.certainty === 'medium' ? 'moyenne' : 'faible'}: {est.methods.length} méthode{est.methods.length > 1 ? 's' : ''}.</div>
          <ul className="plain small">
            {est.methods.map((m) => <li key={m.id}>{m.label}: {mask(reveal, fmt.money(m.value))}. {m.note}.</li>)}
          </ul>
          <div className="muted small">
            À la retraite (dans {years} ans), en francs d’aujourd’hui:{' '}
            {(['worst', 'base', 'best'] as CaseId[]).map((c) => {
              const v = projectValue(est.central, years, CASES[c].assumptions.realGrowth.real_estate);
              const pct = Math.round((v / est.central - 1) * 100);
              return <span key={c} className="chipline">{CASES[c].label.toLowerCase()} {pct >= 0 ? '+' : '−'}{Math.abs(pct)}&#8239;%{reveal ? ` (${fmt.money(v)})` : ''}</span>;
            })}
          </div>
          <div className="actions">
            <button className="btn primary" onClick={use}>Utiliser cette estimation</button>
            <button className="icon-btn small" onClick={done} aria-label="Fermer" title="Fermer"><X {...IC} /></button>
          </div>
        </div>
      ) : (
        <p className="muted">Renseigne au moins un champ pour obtenir une fourchette.</p>
      )}
    </div>
  );
}

function Rates({ db, state, setState, act }: { db: Db; state: State; setState: (s: State) => void; act: Act }) {
  const rates = Object.entries(state.snapshot.rates.rates).sort(([a], [b]) => a.localeCompare(b));
  const lastAt = rates.map(([, r]) => r.at ?? '').sort().pop() || '';
  const [sym, setSym] = useState('');
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [open, setOpenState] = useState<boolean>(() => {
    try { return localStorage.getItem('horizon.ratesOpen') === '1'; } catch { return false; }
  });
  const setOpen = (v: boolean) => {
    setOpenState(v);
    try { localStorage.setItem('horizon.ratesOpen', v ? '1' : '0'); } catch { /* stockage indisponible */ }
  };
  const update = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await api.marketUpdate(db);
      setState(r.state);
      setMsg(`${r.result.updated.length} cours mis à jour${r.result.failed.length ? `. Indisponible: ${r.result.failed.map((x) => x.source).join(', ')}` : ''}.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="block">
      <div className="block-head">
        <button className="icon-btn small" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Masquer les cours' : 'Afficher les cours'} title={open ? 'Masquer' : 'Afficher'}>{open ? <ChevronDown {...IC} /> : <ChevronRight {...IC} />}</button>
        <h2 style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}>Cours <span className="muted small">{rates.length ? `${rates.length}` : ''}</span></h2>
        <span className="muted small" style={{ marginLeft: 'auto' }}>{lastAt ? `à jour le ${new Date(lastAt).toLocaleString('fr-CH', { dateStyle: 'short', timeStyle: 'short' })}` : 'jamais mis à jour'}</span>
        <button className="btn small" onClick={update} disabled={busy} title="Mettre à jour les cours publics maintenant"><RefreshCw {...IC} /> {busy ? 'Mise à jour…' : 'Mettre à jour'}</button>
      </div>
      {msg && <p className="muted small" role="status">{msg}</p>}
      {open && <p className="muted small">CHF pour une unité de la devise ou de la crypto. Une fois les cours publics autorisés dans Confidentialité, ils se mettent à jour seuls (au plus toutes les 12 heures): rien à saisir. La requête demande la liste complète, jamais ce que tu détiens.</p>}
      {!state.privacy.consentMarket && (
        <div className="callout">
          <p>Les cours publics (devises, cryptos) ne sont pas encore autorisés: c’est pourquoi « cours manquant » s’affiche. La requête lit une liste publique complète et ne contient aucune donnée sur toi.</p>
          <div className="actions"><button className="btn primary" onClick={async () => { await act('privacy/consent', { purpose: 'market', value: true }); await update(); }}>Autoriser et mettre à jour</button></div>
        </div>
      )}
      {open && (rates.length === 0 ? (
        <p className="muted">Aucun cours. Les montants en devise sont comptés 1 pour 1 jusqu’à ce que tu en saisisses.</p>
      ) : (
        <ul className="list">
          {rates.map(([s, r]) => (
            <li key={s} className="row">
              <div className="row-main">
                <div className="row-title">{s}{state.stale.includes(s) && <span className="tag assumed">Périmé</span>}</div>
                <div className="row-sub">{r.source}{r.at ? `, ${new Date(r.at).toLocaleDateString('fr-CH')}` : ''}</div>
              </div>
              <div className="row-end amount">{r.perUnit >= 100 ? Math.round(r.perUnit).toLocaleString('de-CH') : r.perUnit.toFixed(4).replace('.', ',')}</div>
            </li>
          ))}
        </ul>
      ))}
      {open && <details style={{ marginTop: 12 }}>
      <summary className="muted small">Saisir un cours à la main (cas particulier)</summary>
      <form className="form inline" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); if (sym.trim() && Number(val) > 0) { act('market/set', { symbol: sym, perUnit: Number(val) }); setSym(''); setVal(''); } }}>
        <input value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} placeholder="Symbole (USD, BTC…)" aria-label="Symbole" style={{ maxWidth: 160 }} />
        <input type="number" step="any" value={val} onChange={(e) => setVal(e.target.value)} placeholder="CHF pour 1 unité" aria-label="Cours en CHF" />
        <button className="btn">Saisir</button>
      </form>
      </details>}
    </section>
  );
}

const EVENT_ICON = { study: GraduationCap, 'one-off': Hammer, dependent: Baby, 'retirement-income': PiggyBank } as const;

/** Situations de vie: chaque icône ouvre un petit formulaire qui crée des faits datés. */
function LifeEvents({ act }: { act: Act }) {
  const [open, setOpen] = useState<LifeEventDef | null>(null);
  const [v, setV] = useState<Record<string, string>>({});
  const pick = (def: LifeEventDef) => {
    if (open?.id === def.id) return setOpen(null);
    setOpen(def);
    setV({ ...(def.defaults?.(new Date()) ?? {}) } as Record<string, string>);
  };
  const submit = async () => {
    if (!open) return;
    await act('add', { draft: open.build(v) });
    setOpen(null);
  };
  return (
    <section className="block">
      <div className="block-head">
        <h2>Situations de vie</h2>
        <div className="event-icons" role="group" aria-label="Ajouter une situation de vie">
          {LIFE_EVENTS.map((def) => {
            const Icon = EVENT_ICON[def.id];
            return (
              <button key={def.id} className={'round' + (open?.id === def.id ? ' on' : '')} aria-pressed={open?.id === def.id} aria-label={def.label} title={def.label} onClick={() => pick(def)}>
                <Icon size={20} strokeWidth={1.5} />
              </button>
            );
          })}
        </div>
      </div>
      {open ? (
        <div className="form">
          <p className="muted"><strong>{open.label}.</strong> {open.hint}</p>
          {open.fields.map((f) => (
            <label key={f.id}>{f.label}{f.optional ? ' (facultatif)' : ''}
              <input type={f.type} step="any" value={v[f.id] ?? ''} onChange={(e) => setV({ ...v, [f.id]: e.target.value })} />
            </label>
          ))}
          <div className="actions">
            <button className="btn primary" onClick={submit}>Ajouter</button>
            <button className="btn ghost" onClick={() => setOpen(null)}>Annuler</button>
          </div>
        </div>
      ) : (
        <p className="muted small">Études, grosse dépense, enfant à charge, rente à la retraite. Elles entrent dans le calcul aux dates indiquées.</p>
      )}
    </section>
  );
}

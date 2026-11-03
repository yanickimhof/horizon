import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadDotEnv } from './env';
import { hasAnthropicKey } from './secrets';
import { claude, usageSummary, capChf } from './usage';
import { CATEGORIES, applySignatures, buildReport, pairInternalTransfers, parseStatement } from './statements';
import { classifyUnknown } from './statements-ai';
import { proposeGap } from './statements-propose';
import { addEstimate, setBiens, budgetView, labelTransactions, removeEstimate, setMinorUnknownToOther, storeStatements } from './budget';
import { classifyStored } from './budget-ai';
import { recurringView } from './recurring';
import { mkdirSync } from 'node:fs';
import { Ledger } from './ledger';
import { loadDemo } from './demo';
import { scanDirectories } from './intake';
import { formatPassages, retrieve, type Passage } from './rag';
import { getWatch, lastWatch, setWatch, startRun, startWatcher, watchProgress } from './watch';
import { EgressBlocked, consentGranted, envLocked, getTerms, guardedFetch, privacyMode, restoreLocal, setTerms, type Consent } from './egress';
import { updateMarket } from './market';
import { buildCoachSystem } from './coach';
import { decide } from './access';
import { upcoming } from '../src/engine/upcoming';
import { monthlyExpenses } from '../src/engine/horizons';
import { CASES, type CaseId } from '../src/engine/assumptions';
import { rings as ringsFor, runwayMonths } from '../src/engine/horizons';
import { staleRates } from '../src/engine/fx';
import { addTerm, pseudonymize, type TermKind } from '../src/core/pseudonym';
import { project } from '../src/core/project';
import { runScenarios } from '../src/engine/stress';
import { reliability } from '../src/engine/reliability';
import { goalMarkers } from '../src/engine/goals';
import { suggestMissing } from '../src/engine/gaps';
import { standardExpenses } from '../src/engine/defaults';
import type { Fact, FactDraft } from '../src/core/types';

type DbName = 'demo' | 'real';
const ledgers = new Map<DbName, Ledger>();

function ledger(name: DbName): Ledger {
  let l = ledgers.get(name);
  if (!l) {
    mkdirSync('data', { recursive: true });
    l = new Ledger(name === 'demo' ? 'data/demo.db' : 'data/horizon.db');
    if (name === 'demo' && l.current().length === 0) loadDemo(l);
    ledgers.set(name, l);
  }
  return l;
}

/**
 * Cours publics automatiques: dès que l'accord "market" est donné, les cours sont rafraîchis quand ils ont plus
 * de 12 heures (ou n'existent pas), sans intervention. Au plus une tentative toutes les 30 minutes par base.
 */
const lastMarketTry: Record<string, number> = {};
async function autoMarket(name: DbName, l: Ledger, force = false): Promise<void> {
  if (!consentGranted(l, 'market')) return;
  const now = Date.now();
  const times = Object.values(l.rates().rates).map((r) => Date.parse(r.at ?? '') || 0);
  const fresh = times.length > 0 && now - Math.max(...times) < 12 * 3600_000;
  if (!force && (fresh || now - (lastMarketTry[name] ?? 0) < 30 * 60_000)) return;
  lastMarketTry[name] = now;
  try {
    await Promise.race([updateMarket(l), new Promise((_, rej) => setTimeout(() => rej(new Error('délai dépassé')), 8000))]);
  } catch {
    /* hors ligne ou bloqué: le message « cours manquant » reste, la saisie manuelle aussi */
  }
}

const finite = (n: number) => (Number.isFinite(n) ? n : null);

function buildState(name: DbName, caseId: CaseId = 'base', access: { remote: boolean; login?: string } = { remote: false }) {
  const l = ledger(name);
  const facts = l.current();
  const snapshot = project(facts, new Date(), l.rates());
  const A = CASES[caseId].assumptions;
  const { base, baseRunway, results } = runScenarios(snapshot, A);
  const cases = Object.fromEntries(
    (['worst', 'base', 'best'] as CaseId[]).map((c) => [
      c,
      { label: CASES[c].label, summary: CASES[c].summary, rings: ringsFor(snapshot, undefined, CASES[c].assumptions), runway: finite(runwayMonths(snapshot, 600, CASES[c].assumptions)) },
    ]),
  );
  const rel = reliability(snapshot);
  const gaps = suggestMissing(snapshot, {
    sourceNames: l.sources().map((x) => x.name),
    notes: l.notes().map((n) => n.text),
    sources: l.sources().map((x) => ({ name: x.name, meta: x.meta })),
  });
  return {
    db: name,
    access,
    caseId,
    cases,
    stale: staleRates(snapshot.rates, new Date()),
    empty: facts.length === 0,
    snapshot,
    rings: base,
    /** null = indéfiniment (les revenus stables suffisent) */
    runway: finite(baseRunway),
    scenarios: results.map((r) => ({
      id: r.scenario.id,
      label: r.scenario.label,
      summary: r.scenario.summary,
      rings: r.rings,
      runway: finite(r.runwayMonths),
    })),
    reliability: rel,
    goals: goalMarkers(snapshot),
    gaps,
    inbox: l.inbox(),
    facts,
    notes: l.notes(),
    sources: l.sources(),
    autonomy: { ...l.autonomy(), rules: l.rulesCount() },
    docs: { chunks: l.chunkCount(), sources: l.sources().length },
    watch: { ...getWatch(l), last: lastWatch(l), running: watchProgress(l).running, step: watchProgress(l).step },
    budget: budgetView(l, new Date(), 80),
    recurring: recurringView(l),
    llm: { provider: provider(l), localOnly: privacyMode(l) === 'local' },
    privacy: {
      mode: privacyMode(l),
      envLocked: envLocked(),
      consentCoach: consentGranted(l, 'coach') ?? null,
      consentMarket: consentGranted(l, 'market') ?? null,
      consentDocs: consentGranted(l, 'coachDocs') ?? null,
      hasKey: hasAnthropicKey(),
      consentAnalysis: consentGranted(l, 'analysis') ?? null,
      usage: usageSummary(l),
      terms: getTerms(l),
      egress: l.egressLog(40),
    },
  };
}

async function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

loadDotEnv();

const send = (res: ServerResponse, code: number, body: unknown) => {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
};

type Provider = 'anthropic' | 'ollama' | 'off';

/**
 * Qui répond au coach. Par défaut, personne: rien ne part tant que l'utilisateur ne l'a pas décidé.
 * - HORIZON_LLM=ollama : modèle local sur cette machine, toujours permis.
 * - anthropic          : seulement en mode "assisted", avec accord explicite et une clé d'API.
 */
/** Classements de paiements mémorisés par l'utilisateur: signature (libellé et montant) vers catégorie. */
function signatures(l: Ledger): Record<string, string> {
  try {
    return JSON.parse(l.getSetting('statements.signatures') ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function provider(l: Ledger): Provider {
  const want = process.env.HORIZON_LLM;
  if (want === 'ollama') return 'ollama';
  if (want === 'off') return 'off';
  if (privacyMode(l) === 'assisted' && consentGranted(l, 'coach') && hasAnthropicKey()) return 'anthropic';
  // « auto »: Claude s'il est autorisé, sinon le modèle local.
  if (want === 'auto') return 'ollama';
  return 'off';
}

/**
 * Contexte transmis au coach. Aucun montant en francs: uniquement des proportions,
 * des ratios et des durées. C'est le principe d'Horizon appliqué à sa propre
 * confidentialité. Seuls les libellés des lignes et le texte des notes sont envoyés tels quels.
 */
function coachContext(name: DbName): string {
  const s = buildState(name);
  const sn = s.snapshot;
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  const L = ['3 mois', '1 an', '5 ans', '20 ans'];
  const grossAssets = sn.assets.reduce((a, x) => a + x.value, 0) || 1;
  const incomeTotal = sn.incomes.reduce((a, x) => a + x.monthly, 0);
  const expenseTotal = monthlyExpenses(sn) || 1;
  const debt = sn.liabilities.reduce((a, x) => a + x.balance, 0);
  const cert = (c: string) => (c === 'assumed' ? 'supposé' : 'confirmé');
  const lines = [
    `Foyer: ${sn.household.adults} adulte(s), ${sn.household.children} enfant(s), ${sn.household.owner ? 'propriétaire' : 'locataire'}, retraite à ${sn.household.retirementAge} ans.`,
    `Sans salaire, tenue: ${s.runway === null ? 'indéfinie' : s.runway + ' mois'}. Fiabilité des données: ${pct(s.reliability.score)}.`,
    `Dépenses / revenus: ${incomeTotal > 0 ? pct(expenseTotal / incomeTotal) : 'revenus inconnus'}. Dette / actifs bruts: ${pct(debt / grossAssets)}.`,
    'Couverture du niveau de vie sans salaire: ' + s.rings.map((r, i) => `${L[i]} ${pct(r.coverage)}`).join(', ') + '.',
    'Exposition par devise (part des actifs bruts): ' +
      Object.entries(sn.assets.reduce<Record<string, number>>((m, a) => ((m[a.class === 'crypto' ? 'crypto' : a.currency] = (m[a.class === 'crypto' ? 'crypto' : a.currency] ?? 0) + a.value), m), {}))
        .map(([c, v]) => `${c} ${pct(v / grossAssets)}`)
        .join(', ') + '.',
    'Couverture à 20 ans selon le cas (pire / base / meilleur): ' + ['worst', 'base', 'best'].map((c) => pct((s.cases as any)[c].rings[3].coverage)).join(' / ') + '.',
    'Chocs: ' + s.scenarios.map((c) => `${c.label} (${c.rings.map((r) => pct(r.coverage)).join('/')}, tenue ${c.runway === null ? 'indéfinie' : c.runway + ' mois'})`).join('; ') + '.',
    'Actifs (part des actifs bruts):',
    ...sn.assets.map((a) => `- [${cert(a.certainty)}] ${a.label} (${a.class}): ${pct(a.value / grossAssets)}, mobilisable après ${a.liquidityMonths} mois, décote ${pct(a.haircut)}`),
    'Dettes:',
    ...sn.liabilities.map((l) => {
      const sec = sn.assets.find((a) => a.key === l.securedBy);
      return `- [${cert(l.certainty)}] ${l.label}: ${sec ? pct(l.balance / (sec.value || 1)) + ' de la valeur du bien garanti' : pct(l.balance / grossAssets) + ' des actifs bruts'}, taux ${(l.rate * 100).toFixed(2)} %${l.variable ? ' variable' : ' fixe'}`;
    }),
    'Revenus (part des revenus):',
    ...sn.incomes.map((i) => `- [${cert(i.certainty)}] ${i.label}: ${incomeTotal > 0 ? pct(i.monthly / incomeTotal) : '?'}${i.stable ? ', continue sans salaire' : ''}`),
    'Dépenses (part des dépenses):',
    ...sn.expenses.map((e) => `- [${cert(e.certainty)}] ${e.label}: ${pct(e.monthly / expenseTotal)}${e.essential ? '' : ', non essentielle'}`),
    'À venir (situations de vie datées):',
    ...(upcoming(sn).length
      ? upcoming(sn).map((u) => {
          const when = u.inMonths >= 24 ? `dans ${(u.inMonths / 12).toFixed(1)} ans` : `dans ${u.inMonths} mois`;
          const what = u.kind === 'lump' ? `dépense ponctuelle «${u.label}», ≈ ${u.weight.toFixed(1)} mois de vie` : u.kind === 'start' ? `début de «${u.label}», ≈ ${pct(u.weight)} du coût de vie mensuel` : u.kind === 'end' ? `fin de «${u.label}», libère ≈ ${pct(u.weight)} du coût mensuel` : `début de «${u.label}», couvre ≈ ${pct(u.weight)} du coût mensuel`;
          return `- ${when}: ${what}`;
        })
      : ['- aucun']),
    'Projets:',
    ...s.goals.map((g) => `- ${g.label}: échéance ${sn.goals.find((x) => x.key === g.key)?.targetYear}, coût ≈ ${g.costInMonthsOfLife.toFixed(1)} mois de vie, financé à ${pct(g.funded)}`),
    'Notes de contexte (texte libre saisi par l’utilisateur): ' + (s.notes.map((n) => n.text).join(' | ') || 'aucune'),
    'Informations manquantes: ' + (s.gaps.slice(0, 4).map((g) => g.title).join(' | ') || 'aucune'),
  ];
  return lines.join('\n');
}

function coachSystem(name: DbName, passages = ''): string {
  return buildCoachSystem(coachContext(name), passages);
}

async function coach(name: DbName, message: string, history: { role: 'user' | 'assistant'; content: string }[]) {
  const l = ledger(name);
  const p = provider(l);
  if (p === 'off') return { status: 503, body: { error: 'no_provider' } };
  const terms = getTerms(l);
  const ps = (t: string) => pseudonymize(t, terms).text;
  // Les extraits contiennent de vrais montants: modèle local, ou accord distinct pour le coach en ligne.
  const docsAllowed = p === 'ollama' || Boolean(consentGranted(l, 'coachDocs'));
  const found: Passage[] = docsAllowed ? retrieve(l, message, 6) : [];
  const system = ps(coachSystem(name, found.length ? formatPassages(found) : ''));
  const meta = {
    docsUsed: found.length > 0,
    docsAvailable: l.chunkCount() > 0,
    docsAllowed,
    sources: found.map((x, i) => ({ n: i + 1, name: x.source, year: x.year, country: x.country, type: x.type })),
  };
  const messages = [...history.slice(-8), { role: 'user' as const, content: message }].map((m) => ({ role: m.role, content: ps(m.content) }));
  try {
    if (p === 'ollama') {
      const base = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
      const r = await guardedFetch(l, {
        purpose: 'coach',
        url: `${base}/api/chat`,
        init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: process.env.HORIZON_OLLAMA_MODEL ?? 'qwen3:8b', stream: false, think: false, messages: [{ role: 'system', content: system }, ...messages] }) },
        summary: 'Question au coach (modèle local)',
      });
      const j = (await r.json()) as any;
      if (!r.ok) return { status: 502, body: { error: j?.error ?? 'Le modèle local ne répond pas' } };
      return { status: 200, body: { text: restoreLocal(String(j?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(), l), ...meta } };
    }
    const out = await claude(l, {
      purpose: 'coach',
      model: process.env.HORIZON_MODEL ?? 'claude-sonnet-5-5',
      system,
      messages,
      maxTokens: 700,
      summary: found.length ? `Question au coach: proportions et ${found.length} extrait${found.length > 1 ? 's' : ''} de documents (avec montants)` : `Question au coach: proportions de ${l.current().length} lignes, sans montants`,
    });
    const text = out.text;
    return { status: 200, body: { text: restoreLocal(text, l), ...meta } };
  } catch (e) {
    if (e instanceof EgressBlocked) return { status: 403, body: { error: e.reason } };
    return { status: 502, body: { error: p === 'ollama' ? 'Modèle local injoignable. Lance ollama puis réessaie.' : String(e) } };
  }
}

/** Middleware Connect/Vite : toutes les routes sont sous /api. */
export async function apiMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return next();
  const name: DbName = url.searchParams.get('db') === 'real' ? 'real' : 'demo';
  const acc = decide(req);
  const access = { remote: acc.remote, login: acc.login };
  const caseOf = (u: URL): CaseId => (['worst', 'base', 'best'].includes(u.searchParams.get('case') ?? '') ? (u.searchParams.get('case') as CaseId) : 'base');
  try {
    const route = `${req.method} ${url.pathname}`;
    const l = ledger(name);
    if (route === 'GET /api/history') {
      const key = url.searchParams.get('key') ?? '';
      const versions = l.history(key).filter((f) => f.status !== 'proposed' && f.status !== 'rejected').map((f) => ({ at: f.validFrom, status: f.status, origin: f.origin, why: f.why, data: f.data }));
      return send(res, 200, { versions });
    }
    if (route === 'GET /api/recurring') {
      return send(res, 200, recurringView(l, new Date(), url.searchParams.get('period') ?? '12'));
    }
    if (route === 'GET /api/state') {
      await autoMarket(name, l);
      return send(res, 200, buildState(name, caseOf(url), access));
    }
    if (route === 'GET /api/privacy') {
      const payload = pseudonymize(coachSystem(name), getTerms(l));
      return send(res, 200, { provider: provider(l), localOnly: privacyMode(l) === 'local', payload: payload.text, replaced: payload.count });
    }

    const body = req.method === 'POST' ? await readJson(req) : {};
    switch (route) {
      case 'POST /api/confirm':
        l.confirm(String(body.id), body.patch ?? {});
        break;
      case 'POST /api/reject':
        l.reject(String(body.id));
        break;
      case 'POST /api/note/update':
        l.updateNote(String(body.id), String(body.text ?? ''));
        break;
      case 'POST /api/note/delete':
        l.deleteNote(String(body.id));
        break;
      case 'POST /api/retire': {
        const keys: string[] = Array.isArray(body.keys) ? body.keys.map(String) : [String(body.key ?? '')];
        for (const k of keys) l.retire(k);
        break;
      }
      case 'POST /api/correct':
        // L'adresse d'un bien est enregistrée ici seulement, et déclarée comme terme sensible: elle est
        // remplacée par un jeton dans les documents importés et dans tout ce qui part vers un modèle.
        if (Array.isArray(body.patch?.members)) {
          let terms = getTerms(l);
          for (const m of body.patch.members) {
            const n = String(m?.name ?? '').trim();
            if (n) terms = addTerm(terms, n, 'personne');
          }
          setTerms(l, terms);
        }
        if (typeof body.patch?.address === 'string' && body.patch.address.trim()) {
          setTerms(l, addTerm(getTerms(l), body.patch.address.trim(), 'adresse'));
        }
        l.correct(String(body.key), body.patch ?? {}, body.why ?? 'Corrigé par l’utilisateur', null, body.origin === 'inferred' ? 'inferred' : 'user');
        break;
      case 'POST /api/add': {
        const d = body.draft as Partial<FactDraft> & Pick<FactDraft, 'kind' | 'key' | 'data'>;
        const full: FactDraft = { confidence: 1, sourceId: null, excerpt: null, why: null, origin: 'user', ...d, status: 'confirmed' };
        l.confirmNew(full);
        break;
      }
      case 'POST /api/bootstrap': {
        const adults = Math.max(1, Number(body.adults) || 1);
        const children = Math.max(0, Number(body.children) || 0);
        const owner = Boolean(body.owner);
        const monthlyIncome = Math.max(0, Number(body.monthlyIncome) || 0);
        const base = { confidence: 1, sourceId: null, excerpt: null, origin: 'user', status: 'confirmed' } as const;
        l.confirmNew({ ...base, kind: 'household', key: 'household', why: 'Saisi au démarrage',
          data: { name: String(body.name ?? ''), birthYear: Number(body.birthYear) || 1980, adults, children, owner, retirementAge: 65 } });
        if (monthlyIncome > 0) {
          l.confirmNew({ ...base, kind: 'income', key: 'income:foyer', why: 'Saisi au démarrage',
            data: { label: 'Revenu net du foyer', amount: monthlyIncome, frequency: 'monthly', stable: false } });
        }
        for (const d of standardExpenses({ adults, children, owner, monthlyIncome })) l.assume(d);
        break;
      }
      case 'POST /api/reset-demo': {
        l.close();
        ledgers.delete(name);
        break;
      }
      case 'POST /api/privacy/mode':
        if (envLocked()) throw new Error('Le mode local est imposé par l’environnement (HORIZON_PRIVACY=local).');
        l.setSetting('privacy.mode', body.mode === 'assisted' ? 'assisted' : 'local');
        if (body.mode !== 'assisted') {
          l.setSetting('consent.coach', '');
          l.setSetting('consent.market', '');
          l.setSetting('consent.coachDocs', '');
        l.setSetting('consent.analysis', '');
        }
        break;
      case 'POST /api/privacy/consent':
        // Les cours publics ont leur propre accord, utilisable en mode strict local; le coach en ligne exige le mode assisté.
        if (body.purpose !== 'market' && privacyMode(l) !== 'assisted') throw new Error('Passe d’abord en mode assisté.');
        {
          const purpose: Consent = body.purpose === 'market' ? 'market' : body.purpose === 'coachDocs' ? 'coachDocs' : body.purpose === 'analysis' ? 'analysis' : 'coach';
          const on = body.purpose === 'coach' || body.purpose === undefined ? (body.value ?? body.coach) : body.value;
          l.setSetting(`consent.${purpose}`, on ? new Date().toISOString() : '');
          if (purpose === 'market' && on) await autoMarket(name, l, true);
        }
        break;
      case 'POST /api/privacy/cap': {
        const v = Number(body.capChf);
        if (!Number.isFinite(v) || v <= 0 || v > 1000) throw new Error('Plafond invalide: entre 1 et 1000 CHF.');
        l.setSetting('llm.capChf', String(v));
        break;
      }
      case 'POST /api/statements/label': {
        const key = String(body.key ?? '');
        const cat = String(body.category ?? '');
        if (!key || !(cat in CATEGORIES) || cat === 'inconnu') throw new Error('Classement invalide.');
        l.setSetting('statements.signatures', JSON.stringify({ ...signatures(l), [key]: cat }));
        return send(res, 200, { ok: true });
      }
      case 'POST /api/budget/import': {
        const files = Array.isArray(body.files) ? (body.files as { name?: unknown; text?: unknown }[]) : [];
        const parsed = files.map((f) => parseStatement(String(f.name ?? 'relevé'), String(f.text ?? '')));
        const result = parsed.length ? storeStatements(l, parsed, files.map((f) => String(f.name ?? '')).join(', ').slice(0, 200)) : { added: 0, skipped: 0, accounts: 0 };
        return send(res, 200, { result, state: buildState(name, caseOf(url), access) });
      }
      case 'POST /api/budget/minor-other': {
        setMinorUnknownToOther(l);
        break;
      }
      case 'POST /api/budget/classify': {
        const result = await classifyStored(l);
        return send(res, 200, { result, state: buildState(name, caseOf(url), access) });
      }
      case 'POST /api/budget/estimate': {
        addEstimate(l, { label: String(body.label ?? ''), amount: Number(body.amount), currency: String(body.currency ?? 'CHF').toUpperCase(), per: body.per === 'year' ? 'year' : 'month', category: String(body.category ?? '') });
        break;
      }
      case 'POST /api/budget/biens': {
        setBiens(l, Array.isArray(body.rules) ? body.rules : []);
        break;
      }
      case 'POST /api/budget/estimate/remove': {
        removeEstimate(l, String(body.id ?? ''));
        break;
      }
      case 'POST /api/budget/label': {
        const cat = String(body.category ?? '');
        if (!(cat in CATEGORIES) || cat === 'inconnu') throw new Error('Classement invalide.');
        labelTransactions(l, String(body.key ?? ''), cat, body.scope === 'exact' ? 'exact' : 'payee');
        break;
      }
      case 'POST /api/statements/propose': {
        proposeGap(l, { key: String(body.key ?? ''), statements: Number(body.statements), horizon: Number(body.horizon) });
        break;
      }
      case 'POST /api/statements/analyze': {
        const files = Array.isArray(body.files) ? (body.files as { name?: unknown; text?: unknown }[]) : [];
        const parsed = files.map((f) => parseStatement(String(f.name ?? 'relevé'), String(f.text ?? '')));
        const allTxs = parsed.flatMap((s) => s.txs);
        pairInternalTransfers(allTxs);
        applySignatures(allTxs, signatures(l));
        const ai = body.useAi ? await classifyUnknown(l, parsed.flatMap((s) => s.txs)) : { used: false, labels: 0, costChf: 0 };
        const snap = project(l.current(), new Date(), l.rates());
        return send(res, 200, buildReport(parsed, snap, ai));
      }
      case 'POST /api/market/set':
        l.setPrice(String(body.symbol), Number(body.perUnit), 'manual');
        break;
      case 'POST /api/market/update': {
        try {
          const r = await updateMarket(l);
          return send(res, 200, { result: r, state: buildState(name, caseOf(url), access) });
        } catch (e) {
          if (e instanceof EgressBlocked) return send(res, 403, { error: e.reason });
          throw e;
        }
      }
      case 'POST /api/privacy/terms': {
        const kinds: TermKind[] = ['personne', 'employeur', 'adresse', 'autre'];
        if (body.remove) {
          setTerms(l, getTerms(l).filter((t) => !(t.kind === body.remove.kind && t.n === body.remove.n)));
        } else if (kinds.includes(body.kind)) {
          setTerms(l, addTerm(getTerms(l), String(body.term ?? ''), body.kind));
        }
        break;
      }
      case 'POST /api/note':
        l.addNote(String(body.text), body.keys ?? []);
        break;
      case 'POST /api/intake': {
        // L'import lit des dossiers du disque: réservé au Mac lui-même, jamais depuis un autre appareil.
        if (acc.remote) return send(res, 403, { error: 'L’import de dossiers n’est disponible que depuis le Mac où tourne Horizon.' });
        const dirs: string[] = Array.isArray(body.dirs) ? body.dirs.map(String) : [String(body.dir ?? '')];
        const opts = { learn: true, terms: getTerms(l) };
        const manifest = scanDirectories(dirs, l, 'inbox/extracted', getTerms(l), opts);
        setTerms(l, opts.terms);
        return send(res, 200, { manifest, state: buildState(name, caseOf(url), access) });
      }
      case 'POST /api/watch': {
        if (acc.remote) return send(res, 403, { error: 'La surveillance de dossiers n’est disponible que depuis le Mac où tourne Horizon.' });
        setWatch(l, { dirs: Array.isArray(body.dirs) ? body.dirs.map(String) : undefined, auto: typeof body.auto === 'boolean' ? body.auto : undefined });
        break;
      }
      case 'POST /api/watch/run': {
        if (acc.remote) return send(res, 403, { error: 'L’import de dossiers n’est disponible que depuis le Mac où tourne Horizon.' });
        startRun(l);
        return send(res, 200, { started: true, state: buildState(name, caseOf(url), access) });
      }
      case 'POST /api/coach': {
        const out = await coach(name, String(body.message ?? ''), body.history ?? []);
        return send(res, out.status, out.body);
      }
      default:
        return send(res, 404, { error: 'Route inconnue' });
    }
    return send(res, 200, buildState(name, caseOf(url), access));
  } catch (e) {
    return send(res, 400, { error: e instanceof Error ? e.message : String(e) });
  }
}

// Contrôle automatique des dossiers de documents, tant que le serveur tourne et que l'utilisateur l'a activé.
startWatcher(() => ledger('real'));

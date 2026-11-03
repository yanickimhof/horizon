import { useEffect, useRef, useState } from 'react';
import type { Ring } from '../engine/horizons';
import type { GoalMarker } from '../engine/goals';
import { RING_LABELS } from '../api';

export const GROUPS = [
  { key: 'cash', label: 'Liquidités', classes: ['cash'] },
  { key: 'securities', label: 'Titres et crypto', classes: ['securities', 'crypto'] },
  { key: 'other', label: 'Autres actifs', classes: ['other', 'business'] },
  { key: 'real_estate', label: 'Immobilier net de dette', classes: ['real_estate'] },
  { key: 'pension', label: 'Prévoyance', classes: ['pension'] },
] as const;

const RADII = [62, 104, 146, 188];
const WIDTH = 26;
const CX = 210;
const CY = 222;

const shares = (rings: Ring[]): number[] =>
  rings.flatMap((r) => GROUPS.map((g) => r.segments.filter((s) => (g.classes as readonly string[]).includes(s.class)).reduce((a, s) => a + s.share, 0)));

/** Interpole doucement vers la cible : c'est ce mouvement qui fait sentir le choc. */
function useTween(target: number[], ms = 650): number[] {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      cur.current = target;
      setV(target);
      return;
    }
    const from = cur.current;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      const next = target.map((t, i) => (from[i] ?? 0) + (t - (from[i] ?? 0)) * e);
      cur.current = next;
      setV(next);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

interface Props {
  rings: Ring[];
  base: Ring[];
  /** Pire et meilleur cas, pour tracer la fourchette autour de chaque anneau. */
  range?: { worst: Ring[]; best: Ring[] };
  goals: GoalMarker[];
  centerTop: string;
  centerBottom: string;
  highlight: number | null;
  onHighlight: (i: number | null) => void;
}

export function Rings({ rings, base, range, goals, centerTop, centerBottom, highlight, onHighlight }: Props) {
  const flat = useTween(shares(rings));
  const cov = useTween(rings.map((r) => r.coverage));
  const baseCov = base.map((r) => r.coverage);
  const perRing: Record<number, number> = {};

  return (
    <svg className="rings" viewBox="0 0 420 444" role="img" aria-labelledby="rings-title rings-desc">
      <title id="rings-title">Couverture du niveau de vie par horizon</title>
      <desc id="rings-desc">
        {rings.map((r, i) => `${RING_LABELS[i]}: ${Math.round(r.coverage * 100)} % couvert`).join('. ')}
      </desc>
      <defs>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="var(--c-other)" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--surface)" strokeWidth="2" />
        </pattern>
      </defs>

      {RADII.map((R, i) => {
        const C = 2 * Math.PI * R;
        const gapU = (2 / C) * 1000;
        let start = 0;
        const dim = highlight !== null && highlight !== i;
        return (
          <g key={i} opacity={dim ? 0.28 : 1} style={{ transition: 'opacity .2s' }} onMouseEnter={() => onHighlight(i)} onMouseLeave={() => onHighlight(null)}>
            <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--track)" strokeWidth={WIDTH} />
            {GROUPS.map((g, gi) => {
              const f = flat[i * GROUPS.length + gi] ?? 0;
              if (f < 0.002) return null;
              const len = f * 1000;
              const vis = Math.max(0.5, len - gapU);
              const el = (
                <circle
                  key={g.key}
                  cx={CX}
                  cy={CY}
                  r={R}
                  fill="none"
                  pathLength={1000}
                  stroke={g.key === 'other' ? 'url(#hatch)' : `var(--c-${g.key})`}
                  strokeWidth={WIDTH}
                  strokeDasharray={`${vis} ${1000 - vis}`}
                  strokeDashoffset={-start * 1000}
                  transform={`rotate(-90 ${CX} ${CY})`}
                />
              );
              start += f;
              return el;
            })}
            {range && Math.abs(range.best[i].coverage - range.worst[i].coverage) > 0.015 && (
              <RangeArc cx={CX} cy={CY} R={R + WIDTH / 2 + 5} from={range.worst[i].coverage} to={range.best[i].coverage} />
            )}
            {Math.abs(baseCov[i] - rings[i].coverage) > 0.005 && (
              <BaseTick cx={CX} cy={CY} R={R} coverage={baseCov[i]} />
            )}
            <text x={CX} y={CY - R - WIDTH / 2 - 4} textAnchor="middle" className="ring-label">
              {RING_LABELS[i]}
            </text>
            {goals
              .filter((g) => g.ringIndex === i)
              .map((g) => {
                const k = (perRing[i] = (perRing[i] ?? 0) + 1);
                const a = ((-90 - k * 12) * Math.PI) / 180;
                return (
                  <g key={g.key}>
                    <title>{g.label}</title>
                    <circle cx={CX + R * Math.cos(a)} cy={CY + R * Math.sin(a)} r={6} fill="var(--surface)" stroke="var(--ink)" strokeWidth={1.75} />
                  </g>
                );
              })}
            <title>{`${RING_LABELS[i]}: ${Math.round(cov[i] * 100)} % du niveau de vie couvert`}</title>
          </g>
        );
      })}

      <text x={CX} y={CY - 2} textAnchor="middle" className="center-top">
        {centerTop}
      </text>
      <text x={CX} y={CY + 18} textAnchor="middle" className="center-bottom">
        {centerBottom}
      </text>
    </svg>
  );
}

function BaseTick({ cx, cy, R, coverage }: { cx: number; cy: number; R: number; coverage: number }) {
  const a = (coverage * 360 - 90) * (Math.PI / 180);
  const r1 = R - WIDTH / 2 - 3;
  const r2 = R + WIDTH / 2 + 3;
  return (
    <line
      x1={cx + r1 * Math.cos(a)}
      y1={cy + r1 * Math.sin(a)}
      x2={cx + r2 * Math.cos(a)}
      y2={cy + r2 * Math.sin(a)}
      stroke="var(--ink)"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <title>Situation avant le choc</title>
    </line>
  );
}

/** Fine bande extérieure entre le pire et le meilleur cas: l'incertitude se voit sans ajouter de chiffre. */
function RangeArc({ cx, cy, R, from, to }: { cx: number; cy: number; R: number; from: number; to: number }) {
  const pt = (f: number) => {
    const a = (Math.min(0.9999, f) * 360 - 90) * (Math.PI / 180);
    return [cx + R * Math.cos(a), cy + R * Math.sin(a)];
  };
  const [x1, y1] = pt(from);
  const [x2, y2] = pt(to);
  const large = (to - from) * 360 > 180 ? 1 : 0;
  return (
    <path d={`M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`} fill="none" stroke="var(--ink-2)" strokeWidth={2.5} strokeLinecap="round" opacity={0.55}>
      <title>Fourchette entre le pire et le meilleur cas</title>
    </path>
  );
}

/**
 * Logo: trois anneaux dont la couverture diminue vers l'extérieur, comme dans la vue principale.
 * Trait fin, une seule couleur (celle du texte), aucun décor.
 */
export function Logo({ size = 24 }: { size?: number }) {
  const ring = (r: number, f?: number) => (
    <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" {...(f ? { pathLength: 100, strokeDasharray: `${f * 100} 100`, transform: 'rotate(-90 50 50)' } : {})} />
  );
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      {ring(42, 0.62)}
      {ring(29, 0.8)}
      {ring(16)}
    </svg>
  );
}

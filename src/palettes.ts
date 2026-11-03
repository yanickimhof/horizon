/**
 * Cinq palettes pour les anneaux: [liquidités, titres et crypto, immobilier, prévoyance].
 * Chacune, en version claire ET sombre, a passé le contrôle d'accessibilité
 * (plage de luminosité, saturation minimale, séparation des voisins y compris pour
 * les daltoniens, contraste). Les anneaux ne reposent jamais sur la couleur seule:
 * légende nommée et espace entre les segments.
 */
export interface PaletteDef {
  id: string;
  name: string;
  light: [string, string, string, string];
  dark: [string, string, string, string];
}

export const PALETTES: PaletteDef[] = [
  { id: 'ocean', name: 'Océan', light: ['#096B95', '#679FDE', '#D2A657', '#7B5A9F'], dark: ['#08719D', '#667DED', '#BC8710', '#854CBB'] },
  { id: 'crepuscule', name: 'Crépuscule', light: ['#5B569C', '#C37292', '#DE9F5F', '#05948C'], dark: ['#6155B8', '#C35586', '#CE7C0B', '#108D73'] },
  { id: 'ardoise', name: 'Ardoise', light: ['#246099', '#2BA9C2', '#C37552', '#71B173'], dark: ['#0667B2', '#0A999F', '#C65C25', '#0AA36B'] },
  { id: 'jade', name: 'Jade', light: ['#018265', '#3DADCF', '#D1A255', '#8F4E82'], dark: ['#0A8265', '#0F96C8', '#BB8518', '#984B89'] },
  { id: 'cobalt', name: 'Cobalt', light: ['#4874C9', '#14A5B2', '#E1A035', '#8A57AE'], dark: ['#386ED6', '#1194A0', '#C28409', '#8F4DB9'] },
];

const KEYS = ['cash', 'securities', 'real_estate', 'pension'] as const;
const vars = (c: string[]) => KEYS.map((k, i) => `--c-${k}: ${c[i]};`).join(' ');

/** CSS généré: un bloc par palette, avec sa variante sombre. */
export const paletteCss = (): string =>
  PALETTES.map(
    (p) =>
      `:root[data-palette='${p.id}'] { ${vars(p.light)} }\n@media (prefers-color-scheme: dark) { :root[data-palette='${p.id}'] { ${vars(p.dark)} } }`,
  ).join('\n');

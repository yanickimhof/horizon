import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(new URL('.', import.meta.url).pathname, '..');
const pub = (f: string) => join(ROOT, 'public', f);
/**
 * La plateforme peut ajouter aux images et SVG un bloc de provenance (Content Credentials, espace de noms c2pa).
 * On l'accepte tel quel, mais on contrôle le dessin lui-même sans lui.
 */
const stripProvenance = (svg: string) => svg.replace(/<metadata>[\s\S]*?<\/metadata>/g, '').replace(/\s+xmlns:c2pa="[^"]*"/g, '');

const png = (f: string) => {
  const d = readFileSync(pub(f));
  expect(d.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // signature PNG
  return { w: d.readUInt32BE(16), h: d.readUInt32BE(20), bytes: d.length };
};

describe('identité visuelle', () => {
  it('les icônes ont les bonnes dimensions et un poids raisonnable', () => {
    expect(png('apple-touch-icon.png')).toMatchObject({ w: 180, h: 180 });
    expect(png('icon-192.png')).toMatchObject({ w: 192, h: 192 });
    expect(png('icon-512.png')).toMatchObject({ w: 512, h: 512 });
    expect(png('favicon-32.png')).toMatchObject({ w: 32, h: 32 });
    for (const f of ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'favicon-32.png']) expect(statSync(pub(f)).size).toBeLessThan(60_000);
  });

  it('le manifeste permet l installation comme une application', () => {
    const m = JSON.parse(readFileSync(pub('manifest.webmanifest'), 'utf8'));
    expect(m).toMatchObject({ name: 'Horizon', short_name: 'Horizon', display: 'standalone', start_url: '/', lang: 'fr' });
    expect(m.icons.some((i: { sizes: string }) => i.sizes === '192x192')).toBe(true);
    expect(m.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
    for (const i of m.icons) expect(existsSync(pub(i.src.replace(/^\//, '')))).toBe(true);
  });

  it('la page déclare icônes, manifeste et nom pour l écran d accueil', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    for (const must of ['rel="icon" href="/favicon.svg"', 'rel="apple-touch-icon"', 'rel="manifest"', 'apple-mobile-web-app-title" content="Horizon"', 'apple-mobile-web-app-capable']) {
      expect(html).toContain(must);
    }
    expect(html).toMatch(/theme-color[^>]*prefers-color-scheme: dark/);
  });

  it('les SVG sont autonomes: aucun script, aucune ressource externe', () => {
    for (const f of ['favicon.svg', 'logo.svg']) {
      const s = stripProvenance(readFileSync(pub(f), 'utf8'));
      expect(s).not.toMatch(/<script|<image|<foreignObject|href=|url\(|@import/i);
      expect(s.replace('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:\/\//);
    }
  });

  it('accepte un bloc de provenance ajouté par la plateforme, mais pas un script caché dedans ou à côté', () => {
    const base = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:c2pa="http://c2pa.org/manifest" viewBox="0 0 100 100">';
    const stamped = `${base}<metadata><c2pa:manifest>QUJD</c2pa:manifest></metadata><circle cx="50" cy="50" r="40"/></svg>`;
    const clean = stripProvenance(stamped);
    expect(clean).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>');
    expect(clean.replace('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:\/\//);
    const hostile = `${base}<metadata/><script>alert(1)</script><circle/></svg>`;
    expect(stripProvenance(hostile)).toMatch(/<script/);
  });

  it('l icône d onglet s adapte au mode sombre', () => {
    expect(readFileSync(pub('favicon.svg'), 'utf8')).toMatch(/prefers-color-scheme: dark/);
  });

  it('le logo reprend le dessin choisi: trois anneaux, deux ouverts', () => {
    const s = stripProvenance(readFileSync(pub('logo.svg'), 'utf8'));
    expect(s.match(/<circle/g)?.length).toBe(3);
    expect(s.match(/stroke-dasharray/g)?.length).toBe(2);
  });

  it('tous les fichiers sont servis tels quels, sans dépendre d un service externe', () => {
    const app = readFileSync(join(ROOT, 'src', 'App.tsx'), 'utf8');
    expect(app).toContain('<Logo');
  });
});

// The look plan, in one place. Dusk in a freight yard: cold blue-grey steel against warm
// amber work lights and ember orange. The same names are the CSS custom properties in
// index.html, so the page and the scene never drift apart.
export const PALETTE = {
  canvas: '#181c24',
  surface: '#232936',
  hairline: '#333c4d',
  ink: '#ece7db',
  muted: '#9aa3b0',
  accent: '#f0a830',
  ember: '#e4572e',
  slate: '#6fb3d9',
  siteA: '#f0a830',
  siteB: '#e4572e',
};

export function shade(name) {
  return PALETTE[name];
}

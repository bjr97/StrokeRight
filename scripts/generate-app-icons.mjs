// Rasterizes scripts/app-icon.svg into the home-screen/PWA icon sizes
// (public/apple-touch-icon.png, icon-192.png, icon-512.png) — the icon
// shown when the app is saved to a phone's home screen. Re-run this after
// editing the SVG: node scripts/generate-app-icons.mjs

import sharp from 'sharp';
import { fileURLToPath } from 'url';
import path from 'path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(dir, 'app-icon.svg');
const publicDir = path.join(dir, '..', 'public');

const targets = [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
];

for (const [name, size] of targets) {
  const out = path.join(publicDir, name);
  await sharp(src).resize(size, size).png().toFile(out);
  console.log('Wrote', out);
}

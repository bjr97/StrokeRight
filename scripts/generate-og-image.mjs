// Rasterizes scripts/og-image.svg into public/og-image.png (1200x630, the
// standard Open Graph banner size) for link previews (iMessage, Slack, etc).
// Re-run this after editing the SVG: node scripts/generate-og-image.mjs

import sharp from 'sharp';
import { fileURLToPath } from 'url';
import path from 'path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(dir, 'og-image.svg');
const out = path.join(dir, '..', 'public', 'og-image.png');

await sharp(src).resize(1200, 630).png().toFile(out);
console.log('Wrote', out);

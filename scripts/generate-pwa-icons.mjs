#!/usr/bin/env node
// Generates crisp raster PWA & Apple touch icons from Plainhand's official brand mark.
// Run once whenever the brand mark changes: node scripts/generate-pwa-icons.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Standard rounded icon ("any"): deep forest green rounded square with sage "p" glyph.
function standardSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48">
  <rect width="48" height="48" rx="11" fill="#183d32"/>
  <path d="M17 37V13h8a8 8 0 0 1 0 16h-8" fill="none" stroke="#d6f0bd" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

// Maskable & Apple touch icon: full-bleed opaque #183d32 background with glyph
// centered inside the safe zone (inner 66%) so Android adaptive masks and iOS squircles
// never clip the mark and iOS never renders black behind transparency.
function fullBleedSvg(size, scale = 0.68) {
  const offset = (48 * (1 - scale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48">
  <rect width="48" height="48" fill="#183d32"/>
  <g transform="translate(${offset.toFixed(2)} ${offset.toFixed(2)}) scale(${scale})">
    <path d="M17 37V13h8a8 8 0 0 1 0 16h-8" fill="none" stroke="#d6f0bd" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
}

const TARGETS = [
  { rel: 'plainhand/web/icons/icon-192.png', size: 192, svg: standardSvg(192), omitBackground: true },
  { rel: 'plainhand/web/icons/icon-512.png', size: 512, svg: standardSvg(512), omitBackground: true },
  { rel: 'plainhand/web/icons/icon-maskable-192.png', size: 192, svg: fullBleedSvg(192, 0.64), omitBackground: false },
  { rel: 'plainhand/web/icons/icon-maskable-512.png', size: 512, svg: fullBleedSvg(512, 0.64), omitBackground: false },
  { rel: 'plainhand/web/apple-touch-icon.png', size: 180, svg: fullBleedSvg(180, 0.78), omitBackground: false },
  { rel: 'dashboard-web/icons/icon-192.png', size: 192, svg: standardSvg(192), omitBackground: true },
  { rel: 'dashboard-web/icons/icon-512.png', size: 512, svg: standardSvg(512), omitBackground: true },
  { rel: 'dashboard-web/icons/icon-maskable-192.png', size: 192, svg: fullBleedSvg(192, 0.64), omitBackground: false },
  { rel: 'dashboard-web/icons/icon-maskable-512.png', size: 512, svg: fullBleedSvg(512, 0.64), omitBackground: false },
  { rel: 'dashboard-web/apple-touch-icon.png', size: 180, svg: fullBleedSvg(180, 0.78), omitBackground: false },
];

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const target of TARGETS) {
    await page.setViewportSize({ width: target.size, height: target.size });
    await page.setContent(`<!doctype html><html><body style="margin:0;padding:0;background:transparent;overflow:hidden">${target.svg}</body></html>`);
    const out = path.join(ROOT, target.rel);
    await mkdir(path.dirname(out), { recursive: true });
    const png = await page.screenshot({ type: 'png', omitBackground: target.omitBackground });
    await writeFile(out, png);
    console.log(`wrote ${target.rel} (${target.size}x${target.size}, ${png.length} bytes)`);
  }
} finally {
  await browser.close();
}

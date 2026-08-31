/**
 * Renders the social-preview image (app/opengraph-image.png, 1200x630) and the
 * apple touch icon (app/apple-icon.png, 180x180) by screenshotting themed HTML
 * in headless Chromium. Re-run manually after a rebrand:
 *
 *   node scripts/generateSocialAssets.mjs
 *
 * Colors mirror styles/theme.ts; fonts load from Google Fonts at render time
 * (the shipped site self-hosts fonts - this script only runs on a dev machine).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const theme = {
  app: '#090d18',
  canvas: '#0c1122',
  node: '#171e38',
  nodeHeader: '#26305a',
  panel: '#10152b',
  line: '#333f6b',
  lineStrong: '#4a5890',
  ink: '#eef2ff',
  inkDim: '#a5b1d8',
  inkMute: '#626e9d',
  active: '#8b98ff',
  pulse: '#c7d2fe',
  filter: '#fcd34d',
  group: '#f0abfc',
  result: '#5eead4',
  gridMinor: '#161d38',
  gridMajor: '#1d2547',
};

const fontLinks = `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Space+Mono:wght@400;700&display=block" rel="stylesheet">
`;

/** The mark from app/icon.svg, scalable. */
function logoMark(size, radius) {
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" rx="${radius}" fill="${theme.panel}"/>
      <path d="M16 18h32M16 32h20M16 46h32" fill="none" stroke="${theme.active}" stroke-width="6" stroke-linecap="round"/>
      <circle cx="45" cy="32" r="5" fill="${theme.result}"/>
    </svg>`;
}

function miniTable({ title, rows, x, y, width }) {
  const rowHtml = rows
    .map(({ text, state }) => {
      const styles = {
        lit: `background: rgba(139,152,255,0.20); border: 1px solid ${theme.active}; color: ${theme.ink};`,
        dim: `color: ${theme.inkMute}; border: 1px solid transparent;`,
        cut: `color: ${theme.inkMute}; text-decoration: line-through; opacity: 0.55; border: 1px solid transparent;`,
        result: `background: rgba(94,234,212,0.18); border: 1px solid ${theme.result}; color: ${theme.ink};`,
      }[state];
      return `<div style="padding: 7px 12px; border-radius: 4px; margin: 3px 6px; ${styles}">${text}</div>`;
    })
    .join('');
  return `
    <div style="position: absolute; left: ${x}px; top: ${y}px; width: ${width}px;
                background: ${theme.node}; border: 1px solid ${theme.lineStrong};
                border-radius: 8px; overflow: hidden; font-family: 'Space Mono', monospace;
                font-size: 15px; box-shadow: 0 18px 45px rgba(0,0,0,0.45);">
      <div style="background: ${theme.nodeHeader}; color: ${theme.ink}; font-family: 'Space Grotesk', sans-serif;
                  font-weight: 700; font-size: 13px; letter-spacing: 0.18em; padding: 8px 12px;">${title}</div>
      <div style="padding: 4px 0;">${rowHtml}</div>
    </div>`;
}

const ogHtml = `<!doctype html>
<html><head><meta charset="utf-8">${fontLinks}
<style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; overflow: hidden; background: ${theme.app}; }
  .grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(${theme.gridMajor} 1px, transparent 1px),
      linear-gradient(90deg, ${theme.gridMajor} 1px, transparent 1px),
      linear-gradient(${theme.gridMinor} 1px, transparent 1px),
      linear-gradient(90deg, ${theme.gridMinor} 1px, transparent 1px);
    background-size: 120px 120px, 120px 120px, 24px 24px, 24px 24px;
    mask-image: radial-gradient(ellipse 90% 90% at 40% 45%, black 30%, transparent 100%);
  }
</style></head>
<body>
  <div class="grid"></div>

  <div style="position: absolute; left: 72px; top: 64px; display: flex; align-items: center; gap: 22px;">
    ${logoMark(76, 14)}
    <div style="font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 42px;
                letter-spacing: 0.22em; color: ${theme.ink};">QUERY<span style="color: ${theme.active};">TRACE</span></div>
  </div>

  <div style="position: absolute; left: 72px; top: 216px; width: 720px;">
    <div style="font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 57px;
                line-height: 1.16; white-space: nowrap; color: ${theme.ink};">
      Watch SQL queries<br>execute, <span style="color: ${theme.result};">step by step</span>
    </div>
    <div style="margin-top: 28px; font-family: 'Space Grotesk', sans-serif; font-size: 27px;
                line-height: 1.45; color: ${theme.inkDim};">
      Joins pulse, filters fade, groups collapse,<br>all on live tables in your browser.
    </div>
  </div>

  <div style="position: absolute; left: 72px; bottom: 56px; font-family: 'Space Mono', monospace;
              font-size: 22px; color: ${theme.inkMute};">
    www.querytrace.<span style="color: ${theme.result};">net</span>
  </div>

  <!-- Join edge behind the two table nodes -->
  <svg style="position: absolute; left: 780px; top: 120px;" width="360" height="420">
    <path d="M 175 128 C 115 178, 245 240, 180 292" fill="none"
          stroke="${theme.active}" stroke-width="3" stroke-dasharray="8 6" opacity="0.9"/>
    <circle cx="212" cy="243" r="8" fill="${theme.pulse}"/>
    <circle cx="212" cy="243" r="15" fill="none" stroke="${theme.pulse}" stroke-width="2" opacity="0.45"/>
  </svg>

  ${miniTable({
    title: 'ORDERS',
    x: 806, y: 96, width: 300,
    rows: [
      { text: 'O-101&nbsp;&nbsp;cust&nbsp;7&nbsp;&nbsp;&nbsp;$420', state: 'lit' },
      { text: 'O-102&nbsp;&nbsp;cust&nbsp;3&nbsp;&nbsp;&nbsp;$85', state: 'cut' },
      { text: 'O-103&nbsp;&nbsp;cust&nbsp;7&nbsp;&nbsp;&nbsp;$260', state: 'lit' },
    ],
  })}
  ${miniTable({
    title: 'CUSTOMERS',
    x: 856, y: 400, width: 300,
    rows: [
      { text: 'cust&nbsp;7&nbsp;&nbsp;Imani&nbsp;Okafor', state: 'result' },
      { text: 'cust&nbsp;3&nbsp;&nbsp;Leo&nbsp;Marchetti', state: 'dim' },
    ],
  })}
</body></html>`;

const iconHtml = `<!doctype html>
<html><head><meta charset="utf-8"><style>* { margin: 0; } body { width: 180px; height: 180px; }</style></head>
<body>
  <!-- Full-bleed square: iOS applies its own corner mask, so no radius here. -->
  <svg width="180" height="180" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
    <rect width="64" height="64" fill="${theme.panel}"/>
    <path d="M16 18h32M16 32h20M16 46h32" fill="none" stroke="${theme.active}" stroke-width="6" stroke-linecap="round"/>
    <circle cx="45" cy="32" r="5" fill="${theme.result}"/>
  </svg>
</body></html>`;

async function shoot(page, { html, width, height, out }) {
  await page.setViewportSize({ width, height });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out });
  console.log(`wrote ${path.relative(root, out)} (${width}x${height})`);
}

const browser = await chromium.launch();
const page = await browser.newPage();
await shoot(page, {
  html: ogHtml,
  width: 1200,
  height: 630,
  out: path.join(root, 'app', 'opengraph-image.png'),
});
await shoot(page, {
  html: iconHtml,
  width: 180,
  height: 180,
  out: path.join(root, 'app', 'apple-icon.png'),
});
await browser.close();

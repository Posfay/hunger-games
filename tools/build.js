#!/usr/bin/env node
/* ==========================================================================
 * tools/build.js — bundle the game into single files.
 *
 *   node tools/build.js
 *
 * Outputs:
 *   dist/arena.html          complete standalone page (double-click to play)
 *   dist/artifact.html       same content without <!doctype>/<html>/<head>/<body>
 *                            wrappers, for hosts that add their own skeleton
 *
 * Local scripts and the stylesheet are inlined; CDN scripts (three.js) and
 * Google Fonts links stay external.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const html = read('index.html');

const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [, "Arena Showrunner"])[1].trim();
const fonts = (html.match(/<!-- FONTS:BEGIN[^>]*-->([\s\S]*?)<!-- FONTS:END -->/) || [, ''])[1].trim();
const css = read('css/style.css');

const scriptTags = [...html.matchAll(/<script\s+src="([^"]+)"\s*><\/script>/g)].map((m) => m[1]);
if (!scriptTags.length) throw new Error('no <script src> tags found in index.html');

const escScript = (s) => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const escStyle = (s) => s.replace(/<\/style/gi, '<\\/style');

const scripts = scriptTags
  .map((src) => {
    if (/^https?:\/\//.test(src)) return `<script src="${src}"></script>`;
    const code = read(src);
    return `<script>/* ${src} */\n${escScript(code)}\n</script>`;
  })
  .join('\n');

const bodyMarkup = '<canvas id="gl"></canvas>\n<div id="ui-root"></div>';

const inner = [
  `<title>${title}</title>`,
  fonts,
  `<style>\n${escStyle(css)}\n</style>`,
  bodyMarkup,
  scripts,
].filter(Boolean).join('\n');

const full = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  `<title>${title}</title>`,
  fonts,
  `<style>\n${escStyle(css)}\n</style>`,
  '</head>',
  '<body>',
  bodyMarkup,
  scripts,
  '</body>',
  '</html>',
].filter(Boolean).join('\n');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/arena.html'), full);
fs.writeFileSync(path.join(root, 'dist/artifact.html'), inner);

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
console.log(`dist/arena.html     ${kb(full)}`);
console.log(`dist/artifact.html  ${kb(inner)}`);
console.log(`${scriptTags.length} scripts bundled`);

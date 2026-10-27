#!/usr/bin/env node
/* ==========================================================================
 * tools/build.js — bundle the game into single files.
 *
 *   node tools/build.js
 *
 * Outputs:
 *   dist/arena.html          FULL edition: complete standalone page (double-click to play),
 *                            includes the packs (js/packs/*.js)
 *   dist/arena-demo.html     DEMO edition: the same game without the packs. The pack arenas
 *                            show as locked cards; nothing of their content is in the file.
 *   dist/artifact.html       full edition without <!doctype>/<html>/<head>/<body> wrappers,
 *                            for hosts that add their own skeleton
 *
 * Local scripts and the stylesheets are inlined; CDN scripts (three.js) and
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
const cssFiles = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="(css\/[^"]+)"\s*>/g)].map((m) => m[1]);
if (!cssFiles.length) throw new Error('no local <link rel="stylesheet"> found in index.html');
const css = cssFiles.map((f) => `/* ${f} */\n${read(f)}`).join('\n');

const scriptTags = [...html.matchAll(/<script\s+src="([^"]+)"\s*><\/script>/g)].map((m) => m[1]);
if (!scriptTags.length) throw new Error('no <script src> tags found in index.html');
const isPack = (src) => /^js\/packs\//.test(src);

const escScript = (s) => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const escStyle = (s) => s.replace(/<\/style/gi, '<\\/style');

/** The <script> block of an edition. */
function scriptsFor(edition) {
  return scriptTags
    .filter((src) => edition === 'full' || !isPack(src))
    .map((src) => {
      if (/^https?:\/\//.test(src)) return `<script src="${src}"></script>`;
      const code = read(src);
      return `<script>/* ${src} */\n${escScript(code)}\n</script>`;
    })
    .join('\n');
}

const bodyMarkup = '<canvas id="gl"></canvas>\n<div id="ui-root"></div>';

function inner(scripts) {
  return [`<title>${title}</title>`, fonts, `<style>\n${escStyle(css)}\n</style>`, bodyMarkup, scripts].filter(Boolean).join('\n');
}
function full(scripts) {
  return [
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
}

const fullScripts = scriptsFor('full');
const demoScripts = scriptsFor('demo');
const outputs = {
  'dist/arena.html': full(fullScripts),
  'dist/arena-demo.html': full(demoScripts),
  'dist/artifact.html': inner(fullScripts),
};

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
for (const f in outputs) {
  fs.writeFileSync(path.join(root, f), outputs[f]);
  console.log(f.padEnd(24) + kb(outputs[f]));
}
console.log(`${scriptTags.length} scripts bundled (${scriptTags.filter(isPack).length} pack file(s), left out of the demo)`);

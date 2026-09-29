#!/usr/bin/env node
/* ==========================================================================
 * tools/smoke.js — headless end-to-end test harness (Chrome DevTools Protocol).
 *
 * Serves the project, launches headless Chrome/Edge, starts a Games, runs it
 * at high speed and reports errors, i18n gaps and gameplay statistics.
 *
 *   node tools/smoke.js [options]
 *     --seed N            arena seed (default 12345)
 *     --tributes N        tribute count (default 24)
 *     --mix NAME          balanced | bloodthirsty | peaceful | chaos
 *     --speed N           game speed (default 16)
 *     --timeout S         real seconds before giving up (default 240)
 *     --maxday N          stop after this in-game day (default 12)
 *     --norender          skip 3D rendering (much faster simulation)
 *     --powers            sandbox + use a random Game Master power every ~2 s
 *     --autogm            enable the assistant Game Master
 *     --shots DIR         save screenshots (setup, early game, mid game, HU, end)
 *     --lang hu           start in Hungarian
 *     --width W --height H  viewport (default 1600x900)
 *     --eval FILE         run extra JS (file contents) in the page after start;
 *                         it may call snap('name') to request a screenshot (needs --shots)
 *     --setup-only        only load the page and screenshot the setup screen
 *     --page PATH         page to load (default index.html; e.g. dist/arena.html)
 *
 * Exit code 0 = no page errors; 1 = errors found; 2 = harness failure.
 * ========================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');

// ------------------------------------------------------------------ args
const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}
const opt = {
  seed: +arg('seed', 12345),
  tributes: +arg('tributes', 24),
  mix: arg('mix', 'balanced'),
  speed: +arg('speed', 16),
  timeout: +arg('timeout', 240),
  maxDay: +arg('maxday', 12),
  norender: !!arg('norender', false),
  powers: !!arg('powers', false),
  autogm: !!arg('autogm', false),
  shots: arg('shots', null),
  lang: arg('lang', 'en'),
  width: +arg('width', 1600),
  height: +arg('height', 900),
  evalFile: arg('eval', null),
  setupOnly: !!arg('setup-only', false),
  page: String(arg('page', 'index.html')).replace(/\\/g, '/'),
};

// --------------------------------------------------------- static server
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = path.join(root, path.normalize(p).replace(/^([/\\])+/, ''));
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// ---------------------------------------------------------------- browser
function findBrowser() {
  const c = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const p of c) if (fs.existsSync(p)) return p;
  throw new Error('No Chrome/Edge found');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const port = 9300 + Math.floor(Math.random() * 600);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-smoke-'));
  const proc = spawn(findBrowser(), [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    `--window-size=${opt.width},${opt.height}`, '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', 'about:blank',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return { proc, dir, ws: page.webSocketDebuggerUrl };
    } catch (e) { /* not up yet */ }
    await sleep(150);
  }
  proc.kill();
  throw new Error('browser did not start');
}

function cdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const handlers = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message)); else res(msg.result);
      } else if (msg.method) {
        for (const h of handlers) h(msg.method, msg.params);
      }
    };
    ws.onerror = (e) => reject(e);
    ws.onopen = () => resolve({
      send(method, params) {
        return new Promise((res, rej) => {
          const mid = ++id;
          pending.set(mid, { res, rej });
          ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
        });
      },
      on(fn) { handlers.push(fn); },
      close() { try { ws.close(); } catch (e) { /* ignore */ } },
    });
  });
}

// ------------------------------------------------------------------- main
(async function main() {
  const t0 = Date.now();
  const srv = await startServer();
  const url = `http://127.0.0.1:${srv.address().port}/${opt.page}`;
  let browser;
  try {
    browser = await launch();
  } catch (e) {
    console.error('HARNESS:', e.message);
    srv.close();
    process.exit(2);
  }
  const c = await cdp(browser.ws);
  const consoleErrors = [];
  const consoleWarnings = new Map();
  c.on((method, p) => {
    if (method === 'Runtime.exceptionThrown') {
      const d = p.exceptionDetails;
      consoleErrors.push('EXCEPTION ' + ((d.exception && d.exception.description) || d.text) + ` @${d.url || ''}:${d.lineNumber}`);
    } else if (method === 'Runtime.consoleAPICalled') {
      const text = p.args.map((a) => (a.value !== undefined ? a.value : a.description || a.type)).join(' ');
      if (p.type === 'error') consoleErrors.push(text);
      else if (p.type === 'warning') consoleWarnings.set(text, (consoleWarnings.get(text) || 0) + 1);
    } else if (method === 'Log.entryAdded') {
      if (p.entry.level === 'error' && !/favicon/.test(p.entry.url || p.entry.text)) consoleErrors.push('LOG ' + p.entry.text + ' ' + (p.entry.url || ''));
    }
  });
  await c.send('Runtime.enable');
  await c.send('Log.enable');
  await c.send('Page.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: opt.width, height: opt.height, deviceScaleFactor: 1, mobile: false });

  const evaluate = async (expr) => {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result.value;
  };
  const shot = async (name) => {
    if (!opt.shots) return;
    fs.mkdirSync(opt.shots, { recursive: true });
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(opt.shots, name + '.png');
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    console.log('  screenshot ' + f);
  };
  const finish = async (code) => {
    c.close();
    try { browser.proc.kill(); } catch (e) { /* ignore */ }
    srv.close();
    await sleep(300);
    try { fs.rmSync(browser.dir, { recursive: true, force: true }); } catch (e) { /* locked */ }
    process.exit(code);
  };

  await c.send('Page.navigate', { url });
  // wait for boot
  let booted = false;
  for (let i = 0; i < 100; i++) {
    await sleep(200);
    try {
      const ph = await evaluate('window.GM && GM.state && GM.state.phase');
      if (ph === 'setup') { booted = true; break; }
    } catch (e) { /* page not ready */ }
  }
  console.log(`boot: ${booted ? 'ok' : 'FAILED'} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (!booted) {
    console.log('phase:', await evaluate('window.GM && GM.state && GM.state.phase').catch(() => 'n/a'));
    printErrors();
    await shot('boot-failed');
    return finish(1);
  }
  const modules = await evaluate(`(() => {
    const names = ['Terrain','World','FX','Env','Items','ItemDefs','Tributes','Combat','AI','Archetypes','Hazards','Mutts','Powers','Audience','AutoGM','Cameras','Audio','UI','Minimap'];
    return names.map(n => n + (GM[n] ? '' : ':MISSING')).join(' ');
  })()`);
  console.log('modules: ' + modules);
  if (opt.lang === 'hu') await evaluate('GM.i18n.setLang("hu")');
  await sleep(800);
  await shot('01-setup' + (opt.lang === 'hu' ? '-hu' : ''));
  if (opt.setupOnly) { printErrors(); return finish(consoleErrors.length ? 1 : 0); }

  // start
  await evaluate(`(() => {
    GM.Game.newGame({ seed: ${opt.seed}, tributeCount: ${opt.tributes}, mix: '${opt.mix}',
      sandbox: ${opt.powers}, autoGM: ${opt.autogm}, quality: 'high', feeds: true, nameTags: true, startSpeed: 1 });
  })()`);
  await sleep(1500);
  await shot('02-countdown');
  await evaluate(`(() => {
    GM.CFG.MAX_SUBSTEPS = ${opt.norender ? 120 : 24};
    GM.Game.setSpeed(${opt.speed});
    ${opt.norender ? 'if (GM.Cameras) GM.Cameras.render = function () {};' : ''}
  })()`);
  // In-page scripts can request screenshots: snap('name') -> <shots>/name.png (checked every second).
  await evaluate('window.__snaps = []; window.snap = function (n) { window.__snaps.push(String(n)); };');
  if (opt.evalFile) await evaluate(fs.readFileSync(opt.evalFile, 'utf8'));
  if (opt.powers) {
    await evaluate(`(() => {
      window.__powerLog = [];
      setInterval(() => {
        try {
          if (GM.state.phase !== 'running' || !GM.Powers || !GM.Powers.defs) return;
          const alive = GM.state.tributes.filter(t => t.alive);
          if (!alive.length) return;
          const defs = GM.Powers.defs.filter(d => d.id !== 'smite' || alive.length > 6);
          const d = defs[Math.floor(Math.random() * defs.length)];
          const t = alive[Math.floor(Math.random() * alive.length)];
          const target = d.target === 'point' ? { x: t.pos.x + 6, z: t.pos.z + 4 } : d.target === 'tribute' ? t : null;
          const option = d.options && d.options.length ? d.options[Math.floor(Math.random() * d.options.length)].id : undefined;
          const ok = GM.Powers.use(d.id, target, option);
          window.__powerLog.push(d.id + (option ? ':' + option : '') + (ok ? '' : '(refused)'));
        } catch (e) { window.__powerLog.push('ERROR ' + e.message); }
      }, 2000);
    })()`);
  }

  // run
  const shotsTaken = new Set();
  let last = null;
  let lastPrint = 0;
  while (true) {
    await sleep(1000);
    let s;
    try {
      s = await evaluate(`(() => {
        const st = GM.state;
        const alive = st.tributes.filter(t => t.alive);
        const acts = {};
        for (const t of alive) acts[t.action] = (acts[t.action] || 0) + 1;
        return { phase: st.phase, time: st.time, day: st.day, tod: st.timeOfDay, alive: alive.length,
          total: st.tributes.length, errors: GM.errors.length, acts,
          weather: GM.Env && GM.Env.weather, mutts: st.mutts.filter(m => m.alive).length,
          excitement: GM.Audience ? Math.round(GM.Audience.excitement) : null };
      })()`);
    } catch (e) {
      console.log('poll failed: ' + e.message);
      break;
    }
    last = s;
    const snaps = await evaluate('(() => { const a = window.__snaps || []; window.__snaps = []; return a; })()').catch(() => []);
    for (const n of snaps) await shot(n);
    const elapsed = (Date.now() - t0) / 1000;
    if (elapsed - lastPrint >= 5) {
      lastPrint = elapsed;
      const acts = Object.entries(s.acts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => k + ':' + v).join(' ');
      console.log(`[${elapsed.toFixed(0)}s] ${s.phase} day ${s.day} ${(s.tod * 24).toFixed(1)}h t=${s.time.toFixed(0)} alive ${s.alive}/${s.total} weather=${s.weather} mutts=${s.mutts} exc=${s.excitement} errs=${s.errors} | ${acts}`);
    }
    if (!shotsTaken.has('early') && s.time > 25) { shotsTaken.add('early'); await shot('03-early'); }
    if (!shotsTaken.has('mid') && s.alive <= Math.ceil(s.total / 2)) {
      shotsTaken.add('mid');
      await shot('04-mid');
      await evaluate('GM.i18n.setLang("' + (opt.lang === 'hu' ? 'en' : 'hu') + '")');
      await sleep(600);
      await shot('05-mid-other-lang');
      await evaluate('GM.i18n.setLang("' + opt.lang + '")');
    }
    if (s.phase === 'ended') {
      await sleep(5000);
      await shot('06-end');
      break;
    }
    if (s.day > opt.maxDay) { console.log('STOP: max day reached'); break; }
    if (elapsed > opt.timeout) { console.log('STOP: timeout'); break; }
  }

  // report
  const rep = await evaluate(`(() => {
    const st = GM.state;
    const causes = {};
    for (const d of st.deaths) causes[d.cause] = (causes[d.cause] || 0) + 1;
    const byArch = {};
    for (const t of st.tributes) {
      const a = byArch[t.archetype] || (byArch[t.archetype] = { n: 0, alive: 0, kills: 0, placeSum: 0 });
      a.n++; if (t.alive) a.alive++; a.kills += t.kills || 0; a.placeSum += t.placement || 1;
    }
    const logTypes = {};
    for (const e of st.log) logTypes[e.type] = (logTypes[e.type] || 0) + 1;
    const w = st.winner != null ? st.tributes[st.winner] : null;
    const en = st.log.slice(-25).map(e => GM.t(e.key, e.params));
    GM.i18n.setLang('hu');
    const hu = st.log.slice(-25).map(e => GM.t(e.key, e.params));
    GM.i18n.setLang('${opt.lang}');
    const unresolved = [];
    for (const e of st.log) { const s = GM.t(e.key, e.params); if (s === e.key || /\\{\\w+\\}/.test(s)) unresolved.push(e.key + ' -> ' + s); }
    const bloodbath = st.deaths.filter(d => d.time < 60).length;
    return {
      phase: st.phase, day: st.day, time: Math.round(st.time), winner: w ? w.name + ' (' + w.archetype + ', ' + w.kills + ' kills)' : null,
      bloodbath, causes, byArch, logTypes, missing: GM.i18n.missing(), unresolved: [...new Set(unresolved)].slice(0, 30),
      errors: GM.errors, en, hu,
      alliances: GM.AI && GM.AI.alliances ? GM.AI.alliances.length : null,
      powers: window.__powerLog ? window.__powerLog.slice(-60) : null,
      fps: null,
    };
  })()`);
  console.log('\n=== RESULT ===');
  console.log(`phase ${rep.phase}, day ${rep.day}, sim time ${rep.time}s, winner: ${rep.winner}`);
  console.log(`deaths in first 60 s (bloodbath): ${rep.bloodbath}`);
  console.log('death causes: ' + JSON.stringify(rep.causes));
  console.log('log types: ' + JSON.stringify(rep.logTypes));
  console.log('alliances ever: ' + rep.alliances);
  console.log('by archetype (n / alive / kills / avg placement):');
  for (const [k, a] of Object.entries(rep.byArch)) console.log(`  ${k.padEnd(12)} ${a.n} / ${a.alive} / ${a.kills} / ${(a.placeSum / a.n).toFixed(1)}`);
  if (rep.powers) console.log('powers used: ' + rep.powers.join(', '));
  console.log('i18n missing in hu: ' + rep.missing.hu.length + (rep.missing.hu.length ? ' ' + rep.missing.hu.slice(0, 40).join(', ') : ''));
  console.log('i18n missing in en: ' + rep.missing.en.length + (rep.missing.en.length ? ' ' + rep.missing.en.slice(0, 40).join(', ') : ''));
  if (rep.unresolved.length) console.log('unresolved log strings:\n  ' + rep.unresolved.join('\n  '));
  console.log('last log lines (en):\n  ' + rep.en.join('\n  '));
  console.log('last log lines (hu):\n  ' + rep.hu.join('\n  '));
  if (rep.errors.length) console.log('GM.errors:\n  ' + rep.errors.map((e) => `${e.where}: ${e.message} (x${e.count})`).join('\n  '));
  printErrors();
  console.log(`\ntotal real time ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return finish(consoleErrors.length || rep.errors.length ? 1 : 0);

  function printErrors() {
    const uniq = [...new Set(consoleErrors)];
    console.log(`console errors: ${consoleErrors.length} (${uniq.length} unique)`);
    for (const e of uniq.slice(0, 25)) console.log('  ' + e.slice(0, 400));
    const warns = [...consoleWarnings.entries()].filter(([t]) => !/GPU stall|swiftshader|WebGL/i.test(t));
    if (warns.length) {
      console.log(`console warnings: ${warns.length} unique`);
      for (const [t, n] of warns.slice(0, 25)) console.log(`  (x${n}) ${t.slice(0, 300)}`);
    }
  }
})().catch((e) => {
  console.error('HARNESS FAILURE:', e && e.stack || e);
  process.exit(2);
});

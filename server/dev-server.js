#!/usr/bin/env node
/* ==========================================================================
 * server/dev-server.js — run the leaderboard on your own machine (no Cloudflare account).
 *
 *   node server/dev-server.js [port] [database-file]
 *
 * Defaults: port 8787, in-memory database (gone when you stop it). Then point the game at it
 * by setting leaderboardUrl in js/config.js to 'http://127.0.0.1:8787'.
 * Needs Node 22.5+ (built-in node:sqlite). The code under test is the real server/worker.js.
 * ========================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { DatabaseSync } = require('node:sqlite');
const { makeD1 } = require('./d1-node.js');

const port = +(process.argv[2] || 8787);
const file = process.argv[3] || ':memory:';

(async function main() {
  const worker = await import(pathToFileURL(path.join(__dirname, 'worker.js')).href);
  const db = new DatabaseSync(file);
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const env = { DB: makeD1(db) };

  http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const init = { method: req.method, headers: req.headers };
      if (body.length && req.method !== 'GET' && req.method !== 'HEAD') init.body = body;
      const r = await worker.handle(new Request('http://' + (req.headers.host || 'localhost') + req.url, init), env, null);
      res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('dev server error: ' + (e && e.message));
    }
  }).listen(port, '127.0.0.1', () => console.log('leaderboard on http://127.0.0.1:' + port + ' (' + (file === ':memory:' ? 'in-memory database' : file) + ')'));
})();

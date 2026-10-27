/* ==========================================================================
 * server/d1-node.js — a minimal Cloudflare D1 look-alike on top of node:sqlite
 * (Node 22.5+). Lets server/worker.js run and be tested locally: the same SQL runs
 * against a real SQLite database. Implements only what the worker uses.
 * ========================================================================== */
'use strict';

function makeD1(sqlite) {
  return {
    prepare(sql) {
      let args = [];
      const st = {
        bind(...a) { args = a; return st; },
        async all() { return { results: sqlite.prepare(sql).all(...args).map((r) => Object.assign({}, r)), meta: {} }; },
        async first() { const r = sqlite.prepare(sql).get(...args); return r ? Object.assign({}, r) : null; },
        async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
      };
      return st;
    },
  };
}

module.exports = { makeD1 };

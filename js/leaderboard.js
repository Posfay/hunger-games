/* ==========================================================================
 * leaderboard.js — client of the online daily leaderboard (server/worker.js).
 *
 *   GM.Leaderboard.enabled()               a service URL is configured (js/config.js)
 *   GM.Leaderboard.daily(date, limit)      -> Promise<{ ok, entries, total }>
 *   GM.Leaderboard.allTime(limit)          -> Promise<{ ok, entries, stats }>
 *   GM.Leaderboard.submit(date, payload)   -> Promise<{ ok, rank, total, improved }>
 *
 * Every promise resolves (never rejects) with { ok: false, error } on trouble:
 * 'disabled' | 'offline' | 'timeout' | 'http' | 'bad'. Entries: { rank, name, score, grade,
 * viewers, day, cast, winner, twist, date?, mine }. Nothing is sent unless the player
 * presses "Submit" on the results card. Owner: core.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;

  const TIMEOUT_MS = 8000;
  const CACHE_MS = 30000;
  const cache = new Map();            // url -> { at, value }

  const LB = (GM.Leaderboard = {});

  function base() {
    const c = window.ARENA_CONFIG;
    const u = c && typeof c.leaderboardUrl === 'string' ? c.leaderboardUrl.trim() : '';
    return /^https?:\/\//i.test(u) ? u.replace(/\/+$/, '') : '';
  }
  LB.enabled = function () { return !!base(); };

  function num(v, d) { v = +v; return isFinite(v) ? v : d || 0; }
  function str(v, max) { return String(v == null ? '' : v).slice(0, max || 40); }

  /** Public tag of this player's id (what the server puts in rows instead of the id). */
  function myTag() {
    return GM.Daily ? GM.hashString(GM.Daily.pid()).toString(16).padStart(8, '0') : '';
  }

  function cleanEntry(e) {
    if (!e || typeof e !== 'object') return null;
    const out = {
      rank: num(e.rank), name: str(e.name, 24), score: num(e.score), grade: str(e.grade, 1),
      viewers: num(e.viewers), day: num(e.day), cast: num(e.cast), winner: str(e.winner, 20), twist: str(e.twist, 20),
      mine: !!e.pidh && e.pidh === myTag(),
    };
    if (e.date) out.date = str(e.date, 10);
    return out;
  }
  function cleanList(list) {
    const out = [];
    if (!Array.isArray(list)) return out;
    for (let i = 0; i < list.length && i < 200; i++) { const e = cleanEntry(list[i]); if (e) out.push(e); }
    return out;
  }

  /** fetch + timeout + JSON; resolves { ok, status, json } or { ok: false, error }. */
  function request(path, opts) {
    const root = base();
    if (!root) return Promise.resolve({ ok: false, error: 'disabled' });
    if (typeof fetch !== 'function') return Promise.resolve({ ok: false, error: 'offline' });
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT_MS);
    const init = Object.assign({ mode: 'cors', credentials: 'omit', cache: 'no-store' }, opts || {});
    if (ctl) init.signal = ctl.signal;
    return fetch(root + path, init).then(function (r) {
      clearTimeout(timer);
      return r.json().then(function (json) {
        return r.ok ? { ok: true, status: r.status, json: json } : { ok: false, error: 'http', status: r.status, message: str(json && json.error, 80) };
      }, function () { return { ok: false, error: r.ok ? 'bad' : 'http', status: r.status }; });
    }).catch(function (e) {
      clearTimeout(timer);
      return { ok: false, error: e && e.name === 'AbortError' ? 'timeout' : 'offline' };
    });
  }

  function cached(key, loader) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.value);
    return loader().then(function (value) {
      if (value.ok) cache.set(key, { at: Date.now(), value: value });
      return value;
    });
  }

  LB.daily = function (date, limit) {
    limit = Math.max(1, Math.min(100, limit | 0 || 50));
    const path = '/v1/daily/' + encodeURIComponent(date) + '?limit=' + limit;
    return cached(path, function () {
      return request(path).then(function (r) {
        if (!r.ok) return r;
        const j = r.json;
        if (!j || !Array.isArray(j.entries)) return { ok: false, error: 'bad' };
        return { ok: true, date: str(j.date, 10), total: num(j.total), entries: cleanList(j.entries) };
      });
    });
  };

  LB.allTime = function (limit) {
    limit = Math.max(1, Math.min(100, limit | 0 || 50));
    const path = '/v1/alltime?limit=' + limit;
    return cached(path, function () {
      return request(path).then(function (r) {
        if (!r.ok) return r;
        const j = r.json;
        if (!j || !Array.isArray(j.entries)) return { ok: false, error: 'bad' };
        const s = j.stats || {};
        return { ok: true, entries: cleanList(j.entries), stats: { players: num(s.players), runs: num(s.runs) } };
      });
    });
  };

  LB.submit = function (date, payload) {
    return request('/v1/daily/' + encodeURIComponent(date), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    }).then(function (r) {
      if (!r.ok) return r;
      cache.clear();
      const j = r.json || {};
      return { ok: true, rank: num(j.rank), total: num(j.total), improved: !!j.improved };
    });
  };
})();

/* ==========================================================================
 * server/worker.js — the daily leaderboard, as a Cloudflare Worker + D1 database.
 * Fits the free plan (100k requests/day, 5M D1 row reads/day, 100k row writes/day).
 *
 *   GET  /v1/daily/:date?limit=50     top scores of one UTC day (+ total entries)
 *   GET  /v1/alltime?limit=50         best score per player over all days (+ players, runs)
 *   POST /v1/daily/:date              submit a finished daily Show (keeps the player's best)
 *   GET  /v1/health
 *
 * The game is client-side, so submitted scores are *reported*, not proven. The checks
 * below (value ranges, grade matches score, the cast size matches that day's
 * challenge, only today/yesterday accepted) stop casual tampering, not a determined
 * cheater. Players are identified by a random id; entries expose only a short hash of it.
 *
 * Keep `challengeFor`, `GRADE_CUTS` and the archetype list in step with js/daily.js,
 * js/career.js and js/contestants.js: tools/worker-test.js fails when they drift.
 * ========================================================================== */

// ----------------------------------------------------------- shared game rules
const SALT = 'arena-showrunner-daily-v1';
const MIXES = ['balanced', 'balanced', 'bloodthirsty', 'chaos', 'peaceful'];
const TWISTS = [
  { id: 'classic', w: 3, cast: 0 },
  { id: 'lean', w: 2, cast: 0 },
  { id: 'quickdraw', w: 2, cast: 0 },
  { id: 'showtime', w: 2, cast: 0 },
  { id: 'crowd', w: 2, cast: 8 },
];
const MAX_CONTESTANTS = 48;
const GRADE_CUTS = [80, 68, 56, 44];          // score needed for S, A, B, C in daily Shows
const ARCHETYPES = ['elite', 'survivor', 'scavenger', 'opportunist', 'strategist', 'berserker', 'protector', 'lonewolf'];

function hashString(str) {                    // FNV-1a, same as GM.hashString
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function makeRng(seed) {                      // mulberry32, same as GM.makeRng
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The Show of a day (only the fields the server needs to check). */
export function challengeFor(date) {
  const rng = makeRng(hashString(SALT + ':' + date));
  const seed = 100000 + Math.floor(rng() * 900000);
  let total = 0;
  for (const t of TWISTS) total += t.w;
  let r = rng() * total;
  let twist = TWISTS[TWISTS.length - 1];
  for (const t of TWISTS) { r -= t.w; if (r <= 0) { twist = t; break; } }
  const mix = MIXES[Math.floor(rng() * MIXES.length)];
  let count = 14 + 2 * Math.floor(rng() * 8);
  count = Math.min(MAX_CONTESTANTS, count + twist.cast);
  return { date, seed, count, mix, twist: twist.id };
}
export function gradeFor(score) {
  return score >= GRADE_CUTS[0] ? 'S' : score >= GRADE_CUTS[1] ? 'A' : score >= GRADE_CUTS[2] ? 'B' : score >= GRADE_CUTS[3] ? 'C' : 'D';
}
/** Short public tag of a player id (what leaderboard rows carry instead of the id). */
export function pidTag(pid) { return hashString(pid).toString(16).padStart(8, '0'); }

// ---------------------------------------------------------------- validation
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PID_RE = /^[a-z0-9]{12,40}$/;

export function cleanName(s) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16).trim();
}
function utcDate(ms) { return new Date(ms).toISOString().slice(0, 10); }
function isRealDate(s) {
  if (!DATE_RE.test(s)) return false;
  const ms = Date.parse(s + 'T00:00:00Z');
  return isFinite(ms) && utcDate(ms) === s;
}

/** -> { ok: true, row } or { ok: false, error } for a submission to `date`. */
export function validate(date, body, now) {
  if (!isRealDate(date)) return { ok: false, error: 'bad_date' };
  const today = utcDate(now);
  const yesterday = utcDate(now - 86400000);
  if (date !== today && date !== yesterday) return { ok: false, error: 'date_out_of_range' };
  if (!body || typeof body !== 'object') return { ok: false, error: 'bad_body' };

  const pid = body.pid;
  if (typeof pid !== 'string' || !PID_RE.test(pid)) return { ok: false, error: 'bad_pid' };
  const name = cleanName(body.name);
  if (!name) return { ok: false, error: 'bad_name' };

  const score = Number(body.score);
  if (!isFinite(score) || score < 0 || score > 100) return { ok: false, error: 'bad_score' };
  const score1 = Math.round(score * 10) / 10;
  const grade = String(body.grade);
  if (grade !== gradeFor(score1)) return { ok: false, error: 'grade_mismatch' };

  const viewers = Math.round(Number(body.viewers));
  if (!isFinite(viewers) || viewers < 1e6 || viewers > 1e9) return { ok: false, error: 'bad_viewers' };
  const day = Math.round(Number(body.day));
  if (!isFinite(day) || day < 1 || day > 99) return { ok: false, error: 'bad_day' };

  const ch = challengeFor(date);
  const cast = Math.round(Number(body.cast));
  if (cast !== ch.count) return { ok: false, error: 'cast_mismatch' };
  const twist = String(body.twist == null ? '' : body.twist);
  if (twist !== ch.twist) return { ok: false, error: 'twist_mismatch' };
  const winner = String(body.winner == null ? '' : body.winner);
  if (winner && ARCHETYPES.indexOf(winner) < 0) return { ok: false, error: 'bad_winner' };

  return { ok: true, row: { date, pid, name, score: score1, grade, viewers, day, cast_n: cast, winner, twist, ts: now } };
}

// ------------------------------------------------------------------ responses
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
function json(obj, status, extra) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, CORS, extra || {}),
  });
}
function fail(error, status) { return json({ error }, status || 400, { 'Cache-Control': 'no-store' }); }

function entry(r, rank) {
  const e = {
    rank, name: r.name, score: r.score, grade: r.grade, viewers: r.viewers, day: r.day, cast: r.cast_n,
    winner: r.winner, twist: r.twist, pidh: pidTag(r.pid),
  };
  if (r.date !== undefined) e.date = r.date;
  return e;
}
function limitOf(url) {
  const n = parseInt(url.searchParams.get('limit') || '50', 10);
  return Math.max(1, Math.min(100, isFinite(n) ? n : 50));
}

// -------------------------------------------------------------------- routes
async function getDaily(env, date, limit) {
  const rows = (await env.DB.prepare(
    'SELECT date, pid, name, score, grade, viewers, day, cast_n, winner, twist FROM scores WHERE date = ?1 ORDER BY score DESC, ts ASC LIMIT ?2'
  ).bind(date, limit).all()).results || [];
  const total = (await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE date = ?1').bind(date).first()).n;
  return { date, total, entries: rows.map((r, i) => entry(Object.assign({}, r, { date: undefined }), i + 1)) };
}

async function getAllTime(env, limit) {
  const rows = (await env.DB.prepare(
    'SELECT date, pid, name, score, grade, viewers, day, cast_n, winner, twist FROM (' +
    ' SELECT *, ROW_NUMBER() OVER (PARTITION BY pid ORDER BY score DESC, ts ASC) AS rn FROM scores' +
    ') WHERE rn = 1 ORDER BY score DESC, ts ASC LIMIT ?1'
  ).bind(limit).all()).results || [];
  const st = await env.DB.prepare('SELECT COUNT(DISTINCT pid) AS players, COUNT(*) AS runs FROM scores').first();
  return { entries: rows.map((r, i) => entry(r, i + 1)), stats: { players: st.players, runs: st.runs } };
}

async function postDaily(env, date, request, now) {
  const len = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (len > 2048) return fail('too_large', 413);
  let text;
  try { text = await request.text(); } catch (e) { return fail('bad_body'); }
  if (text.length > 2048) return fail('too_large', 413);
  let body;
  try { body = JSON.parse(text); } catch (e) { return fail('bad_body'); }

  const v = validate(date, body, now);
  if (!v.ok) return fail(v.error);
  const r = v.row;

  const up = await env.DB.prepare(
    'INSERT INTO scores (date, pid, name, score, grade, viewers, day, cast_n, winner, twist, ts) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11) ' +
    'ON CONFLICT (date, pid) DO UPDATE SET name = excluded.name, score = excluded.score, grade = excluded.grade, viewers = excluded.viewers, ' +
    'day = excluded.day, cast_n = excluded.cast_n, winner = excluded.winner, twist = excluded.twist, ts = excluded.ts ' +
    'WHERE excluded.score > scores.score'
  ).bind(r.date, r.pid, r.name, r.score, r.grade, r.viewers, r.day, r.cast_n, r.winner, r.twist, r.ts).run();
  const improved = !!(up.meta && up.meta.changes > 0);
  // a changed display name applies to all of the player's rows
  await env.DB.prepare('UPDATE scores SET name = ?1 WHERE pid = ?2 AND name <> ?1').bind(r.name, r.pid).run();

  const mine = await env.DB.prepare('SELECT score, ts FROM scores WHERE date = ?1 AND pid = ?2').bind(r.date, r.pid).first();
  const ahead = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM scores WHERE date = ?1 AND (score > ?2 OR (score = ?2 AND ts < ?3))'
  ).bind(r.date, mine.score, mine.ts).first();
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE date = ?1').bind(r.date).first();
  return json({ ok: true, improved, rank: ahead.n + 1, total: total.n, best: mine.score }, 200, { 'Cache-Control': 'no-store' });
}

/** Route one request. `now` is injectable for tests. */
export async function handle(request, env, ctx, now) {
  now = now == null ? Date.now() : now;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    if (path === '/v1/health') return json({ ok: true, time: now }, 200, { 'Cache-Control': 'no-store' });

    const dm = /^\/v1\/daily\/([^/]+)$/.exec(path);
    if (dm) {
      const date = decodeURIComponent(dm[1]);
      if (request.method === 'POST') return await postDaily(env, date, request, now);
      if (request.method !== 'GET') return fail('method_not_allowed', 405);
      if (!isRealDate(date)) return fail('bad_date');
      return await cachedGet(request, ctx, 15, async () => json(await getDaily(env, date, limitOf(url)), 200, { 'Cache-Control': 'public, max-age=15' }));
    }
    if (path === '/v1/alltime') {
      if (request.method !== 'GET') return fail('method_not_allowed', 405);
      return await cachedGet(request, ctx, 300, async () => json(await getAllTime(env, limitOf(url)), 200, { 'Cache-Control': 'public, max-age=300' }));
    }
    return fail('not_found', 404);
  } catch (e) {
    return fail('server_error', 500);
  }
}

/** Serve GETs from the edge cache for a few seconds: keeps D1 reads far below the free quota. */
async function cachedGet(request, ctx, seconds, build) {
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  if (cache) {
    const hit = await cache.match(request);
    if (hit) return hit;
  }
  const res = await build();
  if (cache && res.status === 200) {
    const p = cache.put(request, res.clone());
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p); else await p;
  }
  return res;
}

export default {
  fetch(request, env, ctx) { return handle(request, env, ctx); },
};

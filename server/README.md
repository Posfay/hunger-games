# Daily leaderboard service

A tiny backend for the daily challenge: one Cloudflare Worker (`worker.js`) plus one D1
(SQLite) database (`schema.sql`). It fits Cloudflare's **free plan**, so it costs nothing to
run: 100,000 requests/day, 5 million database row reads/day, 100,000 row writes/day, 5 GB
storage (figures from Cloudflare's pricing pages; check them before you rely on them).
The game works without it. Leave `leaderboardUrl` empty in `js/config.js` and the Daily
screen just shows the player's own scores and nothing is ever sent anywhere.

## Try it on your own machine (no account)

Needs Node 22.5 or newer.

```bash
node server/dev-server.js
```

It listens on `http://127.0.0.1:8787` with an in-memory database (pass a file name as the
second argument to keep the data). Set `leaderboardUrl: 'http://127.0.0.1:8787'` in
`js/config.js`, open the game, play the daily Show and press *Submit*.

## Put it online (about 10 minutes)

1. Make a free Cloudflare account at <https://dash.cloudflare.com/sign-up>.
2. In this folder:

```bash
cd server
npx wrangler login
npx wrangler d1 create arena-leaderboard
```

3. Paste the `database_id` it prints into `wrangler.toml`.
4. Create the table and deploy:

```bash
npx wrangler d1 execute arena-leaderboard --remote --file=schema.sql
npx wrangler deploy
```

5. Wrangler prints the address, like `https://arena-leaderboard.<you>.workers.dev`. Put it into
   `leaderboardUrl` in `js/config.js`, run `node tools/build.js`, and ship the new build.
   Check `https://<that address>/v1/health` in a browser: it should answer `{"ok":true,...}`.

## API

| Request | What |
|---|---|
| `GET /v1/daily/YYYY-MM-DD?limit=50` | top scores of that UTC day and the number of entries |
| `GET /v1/alltime?limit=50` | best score per player over all days, plus player and score counts |
| `POST /v1/daily/YYYY-MM-DD` | submit a finished daily Show (only the player's best of the day is kept) |
| `GET /v1/health` | liveness check |

Lists are cached at the edge for 15 s (all-time: 5 min), which keeps database reads far below
the free quota even with many viewers. Rows carry a short hash of the player id (`pidh`), never
the id itself.

## What it can and cannot stop

The game runs on the player's machine, so a submitted score is **reported, not proven**. The
worker refuses obviously wrong input: scores outside 0-100, a grade that does not match the
score, a cast size or twist that does not match that day's challenge, dates other than today and
yesterday (UTC), oversized or malformed bodies. A determined cheater can still post a believable
fake. Treat the board as a friendly leaderboard, not a prize ladder. If cheaters show up, remove
them and add rules (for example a per-day cap on score jumps):

```bash
npx wrangler d1 execute arena-leaderboard --remote --command "DELETE FROM scores WHERE name = 'Bad Name'"
npx wrangler d1 execute arena-leaderboard --remote --command "SELECT date, name, score, pid FROM scores ORDER BY score DESC LIMIT 20"
```

Real protection would need the server to replay the Show from the player's inputs. The Show is
not deterministic across frame rates today, so that is a bigger project.

## Privacy

Stored per entry: a random id the game generated, the display name the player typed, the Show
score, grade, viewers, days, cast size, winner type, the day's twist and a timestamp. No account,
no e-mail, no IP address in the database. Cloudflare itself sees requests the way any host does,
so mention the leaderboard in the game's privacy note once it is live. The game only sends data
after the player presses *Submit*.

## Keeping it in step with the game

`worker.js` carries its own copy of the daily challenge rules (the day's seed, cast size and twist,
the grade cut-offs, the archetype list). `node tools/daily-test.js` fails when they drift from
`js/daily.js`, `js/career.js` and `js/contestants.js`, and also runs the worker against a real SQLite
database. Run it after changing any of them, and redeploy the worker (`npx wrangler deploy`).

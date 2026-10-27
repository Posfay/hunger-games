-- Daily leaderboard: one row per player and day (their best score of that day).
CREATE TABLE IF NOT EXISTS scores (
  date    TEXT    NOT NULL,            -- 'YYYY-MM-DD' (UTC)
  pid     TEXT    NOT NULL,            -- anonymous player id chosen by the game
  name    TEXT    NOT NULL,            -- display name (1-16 chars)
  score   REAL    NOT NULL,            -- Show score, 0-100
  grade   TEXT    NOT NULL,            -- S / A / B / C / D
  viewers INTEGER NOT NULL,
  day     INTEGER NOT NULL,
  cast_n  INTEGER NOT NULL,
  winner  TEXT    NOT NULL DEFAULT '',
  twist   TEXT    NOT NULL DEFAULT '',
  ts      INTEGER NOT NULL,            -- ms since epoch, when the best score arrived
  PRIMARY KEY (date, pid)
);
CREATE INDEX IF NOT EXISTS idx_scores_day_rank ON scores (date, score DESC, ts ASC);
CREATE INDEX IF NOT EXISTS idx_scores_pid ON scores (pid);

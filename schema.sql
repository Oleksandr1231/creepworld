CREATE TABLE IF NOT EXISTS players (
  twitch_id  TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  avatar     TEXT,
  xp         INTEGER NOT NULL DEFAULT 0,
  run_started INTEGER 
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  twitch_id  TEXT NOT NULL REFERENCES players(twitch_id),
  score      INTEGER NOT NULL,
  hits       INTEGER NOT NULL,
  shots      INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_players_xp ON players(xp DESC);

-- Constellate Engine schema

CREATE TABLE IF NOT EXISTS ideas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT 'manual',
  url         TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT '',
  stack       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ideas_url ON ideas(url) WHERE url != '';

CREATE TABLE IF NOT EXISTS idea_embeddings (
  idea_id    INTEGER PRIMARY KEY REFERENCES ideas(id),
  embedding  BLOB NOT NULL,
  model      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS constellations_cache (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  neighborhood_hash  TEXT NOT NULL,
  constellation_type TEXT NOT NULL,
  idea_ids           TEXT NOT NULL,
  title              TEXT NOT NULL,
  explanation        TEXT NOT NULL,
  score              INTEGER NOT NULL,
  model              TEXT NOT NULL,
  prompt_version     TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_constellations_hash_version
  ON constellations_cache (neighborhood_hash, prompt_version);

CREATE TABLE IF NOT EXISTS cluster_patterns_cache (
  cluster_hash        TEXT NOT NULL,
  pattern_title       TEXT NOT NULL,
  pattern_description TEXT NOT NULL,
  idea_ids            TEXT NOT NULL,
  model               TEXT NOT NULL,
  prompt_version      TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (cluster_hash, pattern_title, prompt_version)
);

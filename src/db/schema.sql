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
  actionability      INTEGER,
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

-- Latest response per deterministic job. This is the resume cache, including
-- valid empty results and the latest invalid/refused response.
CREATE TABLE IF NOT EXISTS api_call_cache (
  input_hash      TEXT NOT NULL,
  stage           TEXT NOT NULL,
  scope_hash      TEXT NOT NULL,
  model           TEXT NOT NULL,
  prompt_version  TEXT NOT NULL,
  status          TEXT NOT NULL,
  response_json   TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL,
  output_tokens   INTEGER NOT NULL,
  cost_usd        REAL NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (input_hash, model, prompt_version)
);

-- Append-only accounting ledger. Retries never replace earlier paid attempts.
CREATE TABLE IF NOT EXISTS api_call_attempts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  input_hash      TEXT NOT NULL,
  stage           TEXT NOT NULL,
  scope_hash      TEXT NOT NULL,
  model           TEXT NOT NULL,
  prompt_version  TEXT NOT NULL,
  status          TEXT NOT NULL,
  response_json   TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL,
  output_tokens   INTEGER NOT NULL,
  cost_usd        REAL NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_api_call_attempts_job
  ON api_call_attempts (input_hash, model, prompt_version);

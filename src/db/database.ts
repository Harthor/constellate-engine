import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (!db) {
    const path = dbPath || join(process.cwd(), 'constellate.db');
    db = new Database(path);
    db.pragma('journal_mode = WAL');
    initSchema(db);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function createDb(dbPath: string): Database.Database {
  const instance = new Database(dbPath);
  instance.pragma('journal_mode = WAL');
  initSchema(instance);
  return instance;
}

function initSchema(instance: Database.Database): void {
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  instance.exec(schema);
}

// ─── Idea helpers ───────────────────────────────────────────────────

export interface IdeaRow {
  id: number;
  title: string;
  description: string;
  source: string;
  url: string;
  category: string;
  stack: string;
}

type IdeaInput = {
  title: string;
  description: string;
  source: string;
  url: string;
  category?: string;
  stack?: string;
};

function normalizeWhitespace(value: string | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function normalizeUrl(value: string | undefined): string {
  const raw = (value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return raw;
  }
}

function normalizeIdea(idea: IdeaInput): Required<IdeaInput> {
  return {
    title: normalizeWhitespace(idea.title),
    description: normalizeWhitespace(idea.description),
    source: normalizeWhitespace(idea.source).toLowerCase() || 'manual',
    url: normalizeUrl(idea.url),
    category: normalizeWhitespace(idea.category),
    stack: normalizeWhitespace(idea.stack),
  };
}

function ideaFingerprint(idea: Pick<IdeaInput, 'url' | 'source' | 'title'>): string {
  const url = normalizeUrl(idea.url);
  return url
    ? `url:${url.toLowerCase()}`
    : `title:${normalizeWhitespace(idea.source).toLowerCase()}:${normalizeWhitespace(idea.title).toLowerCase()}`;
}

export function loadIdeas(instance?: Database.Database): IdeaRow[] {
  const d = instance || getDb();
  return d
    .prepare(
      `SELECT id, title, description, source, url, category, stack
       FROM ideas
       WHERE description != '' OR title != ''
       ORDER BY id ASC`,
    )
    .all() as IdeaRow[];
}

export function insertIdea(
  idea: IdeaInput,
  instance?: Database.Database,
): number {
  const d = instance || getDb();
  const normalized = normalizeIdea(idea);
  bulkInsertIdeas([normalized], d);
  const row = normalized.url
    ? d.prepare(`SELECT id FROM ideas WHERE url = ?`).get(normalized.url)
    : d
        .prepare(`SELECT id FROM ideas WHERE lower(source) = ? AND lower(trim(title)) = ? ORDER BY id LIMIT 1`)
        .get(normalized.source.toLowerCase(), normalized.title.toLowerCase());
  return Number((row as { id?: number } | undefined)?.id ?? 0);
}

export function bulkInsertIdeas(
  ideas: IdeaInput[],
  instance?: Database.Database,
): number {
  const d = instance || getDb();
  const existing = d
    .prepare(`SELECT title, source, url FROM ideas`)
    .all() as Array<Pick<IdeaInput, 'title' | 'source' | 'url'>>;
  const fingerprints = new Set(existing.map(ideaFingerprint));
  const normalized: Array<Required<IdeaInput>> = [];
  for (const raw of ideas) {
    const idea = normalizeIdea(raw);
    if (!idea.title && !idea.description) continue;
    const fingerprint = ideaFingerprint(idea);
    if (fingerprints.has(fingerprint)) continue;
    fingerprints.add(fingerprint);
    normalized.push(idea);
  }

  const stmt = d.prepare(
    `INSERT OR IGNORE INTO ideas (title, description, source, url, category, stack)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const tx = d.transaction((items: Array<Required<IdeaInput>>) => {
    let count = 0;
    for (const idea of items) {
      const r = stmt.run(idea.title, idea.description, idea.source, idea.url, idea.category, idea.stack);
      if (r.changes > 0) count++;
    }
    return count;
  });
  return tx(normalized);
}

// ─── Embedding cache ────────────────────────────────────────────────

export function getCachedEmbeddings(
  model: string,
  instance?: Database.Database,
): Map<number, Float64Array> {
  const d = instance || getDb();
  const rows = d
    .prepare(`SELECT idea_id, embedding FROM idea_embeddings WHERE model = ?`)
    .all(model) as Array<{ idea_id: number; embedding: Buffer }>;

  const map = new Map<number, Float64Array>();
  for (const row of rows) {
    const arr = new Float64Array(
      row.embedding.buffer,
      row.embedding.byteOffset,
      row.embedding.byteLength / 8,
    );
    map.set(row.idea_id, arr);
  }
  return map;
}

export function cacheEmbeddings(
  entries: Array<{ id: number; vector: Float64Array }>,
  model: string,
  instance?: Database.Database,
): void {
  const d = instance || getDb();
  const stmt = d.prepare(
    `INSERT OR REPLACE INTO idea_embeddings (idea_id, embedding, model) VALUES (?, ?, ?)`,
  );
  const tx = d.transaction((items: typeof entries) => {
    for (const item of items) {
      stmt.run(item.id, Buffer.from(item.vector.buffer), model);
    }
  });
  tx(entries);
}

// ─── Constellation cache ────────────────────────────────────────────

export function getCachedConstellations(
  neighborhoodHash: string,
  promptVersion: string,
  model: string,
  instance?: Database.Database,
): Array<{
  constellation_type: string;
  idea_ids: string;
  title: string;
  explanation: string;
  score: number;
  actionability: number | null;
}> {
  const d = instance || getDb();
  return d
    .prepare(
      `SELECT constellation_type, idea_ids, title, explanation, score, actionability
       FROM constellations_cache
       WHERE neighborhood_hash = ? AND prompt_version = ? AND model = ?`,
    )
    .all(neighborhoodHash, promptVersion, model) as Array<{
    constellation_type: string;
    idea_ids: string;
    title: string;
    explanation: string;
    score: number;
    actionability: number | null;
  }>;
}

export function cacheConstellation(
  data: {
    neighborhood_hash: string;
    constellation_type: string;
    idea_ids: number[];
    title: string;
    explanation: string;
    score: number;
    actionability?: number | null;
    model: string;
    prompt_version: string;
  },
  instance?: Database.Database,
): void {
  const d = instance || getDb();
  d.prepare(
    `INSERT INTO constellations_cache
     (neighborhood_hash, constellation_type, idea_ids, title, explanation, score, actionability, model, prompt_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    data.neighborhood_hash,
    data.constellation_type,
    JSON.stringify(data.idea_ids),
    data.title,
    data.explanation,
    data.score,
    data.actionability ?? null,
    data.model,
    data.prompt_version,
  );
}

// ─── Pattern cache ──────────────────────────────────────────────────

export function getCachedPatterns(
  clusterHash: string,
  promptVersion: string,
  model: string,
  instance?: Database.Database,
): Array<{
  pattern_title: string;
  pattern_description: string;
  idea_ids: string;
}> {
  const d = instance || getDb();
  return d
    .prepare(
      `SELECT pattern_title, pattern_description, idea_ids
       FROM cluster_patterns_cache
       WHERE cluster_hash = ? AND prompt_version = ? AND model = ?`,
    )
    .all(clusterHash, promptVersion, model) as Array<{
    pattern_title: string;
    pattern_description: string;
    idea_ids: string;
  }>;
}

export function cachePattern(
  data: {
    cluster_hash: string;
    pattern_title: string;
    pattern_description: string;
    idea_ids: number[];
    model: string;
    prompt_version: string;
  },
  instance?: Database.Database,
): void {
  const d = instance || getDb();
  d.prepare(
    `INSERT OR REPLACE INTO cluster_patterns_cache
     (cluster_hash, pattern_title, pattern_description, idea_ids, model, prompt_version)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    data.cluster_hash,
    data.pattern_title,
    data.pattern_description,
    JSON.stringify(data.idea_ids),
    data.model,
    data.prompt_version,
  );
}

// ─── Paid-call resume ledger ──────────────────────────────────────

export interface ApiCallCacheRow {
  input_hash: string;
  stage: string;
  scope_hash: string;
  model: string;
  prompt_version: string;
  status: 'valid' | 'invalid' | 'refusal';
  response_json: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  created_at: string;
}

export function getCachedApiCall(
  inputHash: string,
  model: string,
  promptVersion: string,
  instance?: Database.Database,
): ApiCallCacheRow | undefined {
  const d = instance || getDb();
  return d
    .prepare(
      `SELECT input_hash, stage, scope_hash, model, prompt_version, status,
              response_json, input_tokens, output_tokens, cost_usd, created_at
       FROM api_call_cache
       WHERE input_hash = ? AND model = ? AND prompt_version = ?`,
    )
    .get(inputHash, model, promptVersion) as ApiCallCacheRow | undefined;
}

export function cacheApiCall(
  data: Omit<ApiCallCacheRow, 'created_at'>,
  instance?: Database.Database,
): void {
  const d = instance || getDb();
  const values = [
    data.input_hash,
    data.stage,
    data.scope_hash,
    data.model,
    data.prompt_version,
    data.status,
    data.response_json,
    data.input_tokens,
    data.output_tokens,
    data.cost_usd,
  ] as const;
  const record = d.transaction(() => {
    d.prepare(
      `INSERT INTO api_call_attempts
       (input_hash, stage, scope_hash, model, prompt_version, status,
        response_json, input_tokens, output_tokens, cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(...values);
    d.prepare(
      `INSERT INTO api_call_cache
       (input_hash, stage, scope_hash, model, prompt_version, status,
        response_json, input_tokens, output_tokens, cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(input_hash, model, prompt_version) DO UPDATE SET
         stage = excluded.stage,
         scope_hash = excluded.scope_hash,
         status = excluded.status,
         response_json = excluded.response_json,
         input_tokens = excluded.input_tokens,
         output_tokens = excluded.output_tokens,
         cost_usd = excluded.cost_usd,
         created_at = excluded.created_at`,
    ).run(...values);
  });
  record();
}

// ─── Cleanup ────────────────────────────────────────────────────────

export function clearCache(instance?: Database.Database): void {
  const d = instance || getDb();
  d.exec(`DELETE FROM idea_embeddings`);
  d.exec(`DELETE FROM constellations_cache`);
  d.exec(`DELETE FROM cluster_patterns_cache`);
  d.exec(`DELETE FROM api_call_cache`);
  d.exec(`DELETE FROM api_call_attempts`);
}

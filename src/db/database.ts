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

export function loadIdeas(instance?: Database.Database): IdeaRow[] {
  const d = instance || getDb();
  return d
    .prepare(
      `SELECT id, title, description, source, url, category, stack
       FROM ideas
       WHERE description != '' OR title != ''`,
    )
    .all() as IdeaRow[];
}

export function insertIdea(
  idea: { title: string; description: string; source: string; url: string; category?: string; stack?: string },
  instance?: Database.Database,
): number {
  const d = instance || getDb();
  const result = d
    .prepare(
      `INSERT OR IGNORE INTO ideas (title, description, source, url, category, stack)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(idea.title, idea.description, idea.source, idea.url, idea.category || '', idea.stack || '');
  return Number(result.lastInsertRowid);
}

export function bulkInsertIdeas(
  ideas: Array<{ title: string; description: string; source: string; url: string; category?: string; stack?: string }>,
  instance?: Database.Database,
): number {
  const d = instance || getDb();
  const stmt = d.prepare(
    `INSERT OR IGNORE INTO ideas (title, description, source, url, category, stack)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const tx = d.transaction((items: typeof ideas) => {
    let count = 0;
    for (const idea of items) {
      const r = stmt.run(idea.title, idea.description, idea.source, idea.url, idea.category || '', idea.stack || '');
      if (r.changes > 0) count++;
    }
    return count;
  });
  return tx(ideas);
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
       WHERE neighborhood_hash = ? AND prompt_version = ?`,
    )
    .all(neighborhoodHash, promptVersion) as Array<{
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
       WHERE cluster_hash = ? AND prompt_version = ?`,
    )
    .all(clusterHash, promptVersion) as Array<{
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

// ─── Cleanup ────────────────────────────────────────────────────────

export function clearCache(instance?: Database.Database): void {
  const d = instance || getDb();
  d.exec(`DELETE FROM idea_embeddings`);
  d.exec(`DELETE FROM constellations_cache`);
  d.exec(`DELETE FROM cluster_patterns_cache`);
}

/**
 * Export constellate-engine data into a DB format compatible with constellate-landing.
 *
 * The landing expects:
 *   - ideas table with columns: id, nombre, fuente, url, descripcion
 *   - constellations_cache with prompt_version matching its query
 *
 * Usage:
 *   npx tsx scripts/export-landing-db.ts [output-path]
 *   Default output: ./landing-ideas.db
 */

import Database from 'better-sqlite3';
import { getDb } from '../src/db/database.js';

const outputPath = process.argv[2] || 'landing-ideas.db';

function main() {
  const srcDb = getDb();

  // Create landing-compatible DB
  const dst = new Database(outputPath);
  dst.pragma('journal_mode = WAL');

  // Landing schema (matches catalogo-ideas)
  dst.exec(`
    CREATE TABLE IF NOT EXISTS ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT DEFAULT (date('now')),
      nombre TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      descripcion TEXT,
      fuente TEXT,
      stack TEXT DEFAULT '',
      problema_que_resuelve TEXT DEFAULT '',
      potencial_negocio TEXT DEFAULT '',
      dificultad_implementacion TEXT DEFAULT '',
      apto_inversores TEXT DEFAULT 'pendiente',
      razon_inversores TEXT DEFAULT '',
      revisado TEXT DEFAULT 'pendiente',
      notas TEXT DEFAULT '',
      combina_con TEXT DEFAULT '',
      categoria TEXT DEFAULT '',
      frontier TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS constellations_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      neighborhood_hash TEXT NOT NULL,
      constellation_type TEXT NOT NULL,
      idea_ids TEXT NOT NULL,
      title TEXT NOT NULL,
      explanation TEXT NOT NULL,
      score INTEGER NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_constellations_hash_version
      ON constellations_cache (neighborhood_hash, prompt_version);

    CREATE TABLE IF NOT EXISTS cluster_patterns_cache (
      cluster_hash TEXT NOT NULL,
      pattern_title TEXT NOT NULL,
      pattern_description TEXT NOT NULL,
      idea_ids TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (cluster_hash, pattern_title, prompt_version)
    );
  `);

  // Export ideas: map title→nombre, source→fuente
  const srcIdeas = srcDb.prepare(
    `SELECT id, title, description, source, url, category, stack FROM ideas`
  ).all() as Array<{
    id: number; title: string; description: string; source: string;
    url: string; category: string; stack: string;
  }>;

  const insertIdea = dst.prepare(
    `INSERT OR IGNORE INTO ideas (id, nombre, url, descripcion, fuente, categoria, stack)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const idMapping = new Map<number, number>();

  const insertIdeas = dst.transaction(() => {
    for (const idea of srcIdeas) {
      const r = insertIdea.run(
        idea.id, idea.title, idea.url, idea.description,
        idea.source, idea.category, idea.stack
      );
      idMapping.set(idea.id, Number(r.lastInsertRowid) || idea.id);
    }
  });
  insertIdeas();
  console.log(`Exported ${srcIdeas.length} ideas`);

  // Export constellations — rewrite prompt_version to what landing expects
  const LANDING_PROMPT_VERSION = 'constellation_v3_sonnet';

  const srcConstellations = srcDb.prepare(
    `SELECT neighborhood_hash, constellation_type, idea_ids, title, explanation, score, model, prompt_version, created_at
     FROM constellations_cache`
  ).all() as Array<{
    neighborhood_hash: string; constellation_type: string; idea_ids: string;
    title: string; explanation: string; score: number; model: string;
    prompt_version: string; created_at: string;
  }>;

  const insertConstellation = dst.prepare(
    `INSERT INTO constellations_cache
     (neighborhood_hash, constellation_type, idea_ids, title, explanation, score, model, prompt_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const insertConstellations = dst.transaction(() => {
    for (const c of srcConstellations) {
      insertConstellation.run(
        c.neighborhood_hash, c.constellation_type, c.idea_ids,
        c.title, c.explanation, c.score, c.model,
        LANDING_PROMPT_VERSION, c.created_at
      );
    }
  });
  insertConstellations();
  console.log(`Exported ${srcConstellations.length} constellations (prompt_version → ${LANDING_PROMPT_VERSION})`);

  // Export patterns
  const srcPatterns = srcDb.prepare(
    `SELECT cluster_hash, pattern_title, pattern_description, idea_ids, model, prompt_version, created_at
     FROM cluster_patterns_cache`
  ).all() as Array<{
    cluster_hash: string; pattern_title: string; pattern_description: string;
    idea_ids: string; model: string; prompt_version: string; created_at: string;
  }>;

  const insertPattern = dst.prepare(
    `INSERT OR IGNORE INTO cluster_patterns_cache
     (cluster_hash, pattern_title, pattern_description, idea_ids, model, prompt_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const insertPatterns = dst.transaction(() => {
    for (const p of srcPatterns) {
      insertPattern.run(
        p.cluster_hash, p.pattern_title, p.pattern_description,
        p.idea_ids, p.model, p.prompt_version, p.created_at
      );
    }
  });
  insertPatterns();
  console.log(`Exported ${srcPatterns.length} patterns`);

  dst.close();
  srcDb.close();
  console.log(`\nLanding-compatible DB written to: ${outputPath}`);
  console.log(`Copy this file to the constellate-landing project as ideas.db`);
}

main();

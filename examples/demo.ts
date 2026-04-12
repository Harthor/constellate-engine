/**
 * Demo: ingest sample ideas and run the pipeline.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx tsx examples/demo.ts
 *
 * Without an API key, it will ingest ideas and run stages 1-2 only
 * (embeddings + neighborhoods), which is useful for testing the
 * local pipeline without spending money.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createDb, bulkInsertIdeas, loadIdeas, closeDb } from '../src/db/database.js';
import { createEmbedder } from '../src/embeddings/embedder.js';
import { stage1Embeddings } from '../src/pipeline/stage1-embeddings.js';
import { stage2Neighborhoods } from '../src/pipeline/stage2-neighborhoods.js';
import { runPipeline, DEFAULT_CONFIG } from '../src/pipeline/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const dbPath = join(__dirname, '..', 'demo.db');
  const db = createDb(dbPath);

  // Ingest sample ideas
  const samplePath = join(__dirname, 'sample-ideas.json');
  const ideas = JSON.parse(readFileSync(samplePath, 'utf-8'));
  const count = bulkInsertIdeas(ideas, db);
  console.log(`Ingested ${count} ideas (${ideas.length - count} duplicates skipped)`);

  const allIdeas = loadIdeas(db);
  console.log(`Total ideas in DB: ${allIdeas.length}`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('\nNo ANTHROPIC_API_KEY set — running local-only stages (1-2)\n');

    const embedder = await createEmbedder('tfidf');
    const config = { ...DEFAULT_CONFIG, num_clusters: 8 };

    const s1 = await stage1Embeddings(allIdeas, embedder, config, false, db);
    console.log(`\nClusters formed: ${s1.clusters.size}`);
    for (const [cid, ids] of s1.clusters) {
      const titles = ids.map((id) => allIdeas.find((i) => i.id === id)?.title || '?');
      console.log(`  Cluster ${cid} (${ids.length} ideas):`);
      for (const t of titles) console.log(`    - ${t}`);
    }

    const s2 = stage2Neighborhoods(s1.clusters, s1.embeddings, config);
    console.log(`\nNeighborhoods: ${s2.neighborhoods.length} (${s2.intraCount} intra + ${s2.crossCount} cross)`);

    db.close();
    console.log('\nDone! To run the full pipeline, set ANTHROPIC_API_KEY.');
    return;
  }

  // Full pipeline
  console.log('\nRunning full pipeline...\n');
  const result = await runPipeline({
    config: { num_clusters: 8 },
    db,
  });

  const outputPath = join(__dirname, '..', 'demo-output.json');
  writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`\nResults written to ${outputPath}`);

  // Print highlights
  if (result.constellations.length > 0) {
    console.log('\n--- Top Constellations ---');
    const sorted = [...result.constellations].sort((a, b) => b.score - a.score);
    for (const c of sorted.slice(0, 5)) {
      console.log(`\n[${c.score}/10] ${c.constellation_type.toUpperCase()}: ${c.title}`);
      console.log(`  ${c.explanation}`);
      console.log(`  Ideas: ${c.idea_ids.map((id) => result.ideas[id]?.title || id).join(', ')}`);
    }
  }

  if (result.patterns.length > 0) {
    console.log('\n--- Emergent Patterns ---');
    for (const p of result.patterns) {
      console.log(`\n${p.pattern_title}`);
      console.log(`  ${p.pattern_description}`);
    }
  }

  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

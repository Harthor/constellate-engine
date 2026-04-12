/**
 * Weekly pipeline: scrape all sources → run constellation pipeline → export for landing.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx tsx scripts/weekly-run.ts
 *
 * This is the script you'd run via cron or scheduled task.
 */

import { writeFileSync } from 'fs';
import { scrapeAll } from '../src/sources/scrapers.js';
import { getDb, bulkInsertIdeas, closeDb } from '../src/db/database.js';
import { runPipeline } from '../src/pipeline/index.js';

async function main() {
  const startTime = Date.now();
  console.log('=== CONSTELLATE WEEKLY RUN ===');
  console.log(`Started: ${new Date().toISOString()}\n`);

  // Step 1: Scrape all sources
  console.log('--- Step 1: Scraping sources ---');
  const results = await scrapeAll();
  let totalNew = 0;
  let totalFetched = 0;

  for (const r of results) {
    if (r.error) {
      console.log(`  [${r.source}] ERROR: ${r.error}`);
      continue;
    }
    const count = bulkInsertIdeas(r.ideas);
    totalNew += count;
    totalFetched += r.ideas.length;
    console.log(`  [${r.source}] ${r.ideas.length} fetched, ${count} new`);
  }
  console.log(`  Total: ${totalFetched} fetched, ${totalNew} new\n`);

  if (totalNew === 0) {
    console.log('No new ideas found. Skipping pipeline run.');
    closeDb();
    return;
  }

  // Step 2: Run pipeline
  console.log('--- Step 2: Running pipeline ---');
  const result = await runPipeline({
    config: {
      num_clusters: 15,
      max_total_neighborhoods: 25,
    },
  });

  // Step 3: Save output
  const outputPath = 'output.json';
  writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`\nOutput saved to ${outputPath}`);

  // Step 4: Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n=== SUMMARY ===');
  console.log(`Ideas scraped: ${totalFetched} (${totalNew} new)`);
  console.log(`Constellations: ${result.metadata.constellations_found}`);
  console.log(`Patterns: ${result.patterns.length}`);
  console.log(`Cost: $${result.metadata.estimated_cost_usd.toFixed(4)}`);
  console.log(`Total time: ${elapsed}s`);
  console.log(`\nRun 'npx tsx scripts/export-landing-db.ts' to generate landing-compatible DB`);

  closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Weekly pipeline: scrape all sources → run constellation pipeline → save a dated snapshot.
 *
 * Zero-cost usage:
 *   npm run weekly-run
 *
 * Paid usage still requires non-zero environment limits, a process-only API
 * key, and the explicit --yes flag.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { scrapeAll } from '../src/sources/scrapers.js';
import {
  evaluateSources,
  formatSourceSummary,
  hasHardFailure,
  logSourceReports,
  type SourceReport,
} from '../src/sources/health.js';
import { bulkInsertIdeas, closeDb } from '../src/db/database.js';
import { runPipeline } from '../src/pipeline/index.js';
import { isDryRunConfig, loadPipelineConfig } from '../src/config.js';

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

async function main() {
  const startTime = Date.now();
  console.log('=== CONSTELLATE WEEKLY RUN ===');
  console.log(`Started: ${new Date().toISOString()}\n`);

  let totalNew = 0;
  let totalFetched = 0;
  let sourceReports: SourceReport[] = [];
  if (process.argv.includes('--skip-scrape')) {
    console.log('--- Step 1: Source refresh skipped explicitly ---\n');
  } else {
    console.log('--- Step 1: Scraping sources ---');
    const results = await scrapeAll();
    const outcomes = results.map((r) => {
      if (r.error) return { source: r.source, fetched: 0, inserted: 0, error: r.error };
      const inserted = bulkInsertIdeas(r.ideas);
      totalNew += inserted;
      totalFetched += r.ideas.length;
      return { source: r.source, fetched: r.ideas.length, inserted };
    });
    sourceReports = evaluateSources(outcomes);
    logSourceReports(sourceReports);
    console.log(`  Total: ${totalFetched} fetched, ${totalNew} new`);
    console.log(formatSourceSummary(sourceReports));
    console.log('');
  }

  // Step 2: Run pipeline
  console.log('--- Step 2: Running pipeline ---');
  const config = loadPipelineConfig();
  const dryRun = isDryRunConfig(config);
  const saveCacheSnapshot = process.argv.includes('--save-cache-snapshot');
  const yes = process.argv.includes('--yes');
  const forceRecompute = process.argv.includes('--force');
  const retryFailed = process.argv.includes('--retry-failed');
  const skipFailed = process.argv.includes('--skip-failed');
  const result = await runPipeline({ dryRun, yes, forceRecompute, retryFailed, skipFailed });

  // Step 3: Save latest output plus an immutable, dated local snapshot.
  if (!dryRun || saveCacheSnapshot) {
    const outputPath = resolve(optionValue('--output') ?? 'output.json');
    const snapshotName = `constellate-${result.metadata.generated_at!
      .replace(/[:.]/g, '-')}.json`;
    const snapshotPath = resolve('runs', snapshotName);
    const serialized = JSON.stringify(result, null, 2);
    mkdirSync(dirname(outputPath), { recursive: true });
    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(outputPath, serialized);
    if (snapshotPath !== outputPath) writeFileSync(snapshotPath, serialized);
    console.log(`\n${dryRun ? 'Cache-only' : 'Latest'} output saved to ${outputPath}`);
    console.log(`Dated snapshot saved to ${snapshotPath}`);
  } else {
    console.log('\nDry run complete. Existing outputs and dated snapshots were not changed.');
  }

  // Step 4: Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n=== SUMMARY ===');
  console.log(`Ideas scraped: ${totalFetched} (${totalNew} new)`);
  console.log(`Constellations: ${result.metadata.constellations_found}`);
  console.log(`Patterns: ${result.patterns.length}`);
  console.log(`Cost: $${result.metadata.estimated_cost_usd.toFixed(4)}`);
  console.log(`Total time: ${elapsed}s`);
  if (!dryRun || saveCacheSnapshot) {
    console.log("\nReview the snapshot, then run 'npm run publish-data -- --input <snapshot>' to publish it.");
  }

  closeDb();

  // Exit non-zero AFTER the run completes, so a scheduled job goes red on a
  // broken source without losing the analysis of the sources that did work.
  if (hasHardFailure(sourceReports)) {
    const failed = sourceReports
      .filter((report) => report.status === 'failed')
      .map((report) => report.source)
      .join(', ');
    console.error(`\nFAILED: no usable rows from ${failed}. Exiting non-zero.`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

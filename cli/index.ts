import { Command } from 'commander';
import { readFileSync } from 'fs';
import { writeFileSync } from 'fs';
import { runPipeline, DEFAULT_CONFIG } from '../src/pipeline/index.js';
import { getDb, bulkInsertIdeas, clearCache, closeDb } from '../src/db/database.js';
import { createEmbedder } from '../src/embeddings/embedder.js';
import { SCRAPERS, SOURCE_NAMES, scrapeAll } from '../src/sources/scrapers.js';

const program = new Command();

program
  .name('constellate')
  .description('Discover non-obvious patterns across idea corpora')
  .version('0.1.0');

program
  .command('run')
  .description('Run the full constellation pipeline')
  .option('--force', 'Force recompute (ignore cache)', false)
  .option('--clusters <n>', 'Number of clusters', String(DEFAULT_CONFIG.num_clusters))
  .option('--min-score <n>', 'Minimum constellation score', String(DEFAULT_CONFIG.min_constellation_score))
  .option('--model <model>', 'Discovery model', DEFAULT_CONFIG.discovery_model)
  .option('--output <path>', 'Output JSON path', 'output.json')
  .option('--embedder <name>', 'Embedder to use', 'tfidf')
  .action(async (opts) => {
    try {
      const embedder = await createEmbedder(opts.embedder);
      const result = await runPipeline({
        config: {
          num_clusters: parseInt(opts.clusters),
          min_constellation_score: parseInt(opts.minScore),
          discovery_model: opts.model,
        },
        embedder,
        forceRecompute: opts.force,
      });

      writeFileSync(opts.output, JSON.stringify(result, null, 2));
      console.log(`\nResults written to ${opts.output}`);

      printSummary(result);
      closeDb();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });

program
  .command('ingest <file>')
  .description('Import ideas from a JSON file')
  .action((file) => {
    try {
      const data = JSON.parse(readFileSync(file, 'utf-8'));
      const ideas = Array.isArray(data) ? data : data.ideas || [];

      if (ideas.length === 0) {
        console.error('No ideas found in file.');
        process.exit(1);
      }

      const count = bulkInsertIdeas(ideas);
      console.log(`Ingested ${count} new ideas (${ideas.length - count} duplicates skipped).`);
      closeDb();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });

program
  .command('clear-cache')
  .description('Clear all cached embeddings, constellations, and patterns')
  .action(() => {
    clearCache();
    console.log('Cache cleared.');
    closeDb();
  });

program
  .command('scrape [source]')
  .description('Scrape ideas from sources (all sources if none specified)')
  .action(async (source?: string) => {
    try {
      if (source && !SCRAPERS[source]) {
        console.error(`Unknown source: ${source}`);
        console.error(`Available: ${SOURCE_NAMES.join(', ')}`);
        process.exit(1);
      }

      if (source) {
        console.log(`Scraping ${source}...`);
        const ideas = await SCRAPERS[source]();
        console.log(`  Fetched ${ideas.length} ideas`);
        const count = bulkInsertIdeas(ideas);
        console.log(`  Ingested ${count} new (${ideas.length - count} duplicates)`);
      } else {
        console.log(`Scraping all ${SOURCE_NAMES.length} sources...\n`);
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
        console.log(`\nTotal: ${totalFetched} fetched, ${totalNew} new ideas ingested`);
      }
      closeDb();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });

program
  .command('stats')
  .description('Show database statistics')
  .action(() => {
    const db = getDb();
    const ideas = db.prepare('SELECT COUNT(*) as count FROM ideas').get() as { count: number };
    const embeddings = db.prepare('SELECT COUNT(*) as count FROM idea_embeddings').get() as { count: number };
    const constellations = db.prepare('SELECT COUNT(*) as count FROM constellations_cache').get() as { count: number };
    const patterns = db.prepare('SELECT COUNT(*) as count FROM cluster_patterns_cache').get() as { count: number };

    console.log(`Ideas:          ${ideas.count}`);
    console.log(`Embeddings:     ${embeddings.count}`);
    console.log(`Constellations: ${constellations.count} (cached)`);
    console.log(`Patterns:       ${patterns.count} (cached)`);
    closeDb();
  });

function printSummary(result: Awaited<ReturnType<typeof runPipeline>>) {
  const { metadata, constellations } = result;

  console.log('\n─── Summary ───');
  console.log(`Ideas analyzed:  ${metadata.total_ideas}`);
  console.log(`Neighborhoods:   ${metadata.neighborhoods_total}`);
  console.log(`Constellations:  ${metadata.constellations_found}`);
  console.log(`Patterns:        ${result.patterns.length}`);
  console.log(`Cost:            $${metadata.estimated_cost_usd.toFixed(4)}`);
  console.log(`Time:            ${(metadata.elapsed_ms / 1000).toFixed(1)}s`);

  if (constellations.length > 0) {
    console.log('\n─── Top Constellations ───');
    const sorted = [...constellations].sort((a, b) => b.score - a.score);
    for (const c of sorted.slice(0, 5)) {
      console.log(`  [${c.score}/10] ${c.constellation_type.toUpperCase()}: ${c.title}`);
      console.log(`          ${c.explanation.slice(0, 120)}...`);
    }
  }
}

program.parse();

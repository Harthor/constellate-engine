import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { runPipeline } from '../src/pipeline/index.js';
import { loadPipelineConfig } from '../src/config.js';
import type { PipelineConfig, PreflightReport, RawIdea } from '../src/types/index.js';
import { getDb, bulkInsertIdeas, clearCache, closeDb } from '../src/db/database.js';
import { createEmbedder } from '../src/embeddings/embedder.js';
import { SCRAPERS, SOURCE_NAMES, scrapeAll } from '../src/sources/scrapers.js';
import {
  evaluateSources,
  formatSourceSummary,
  hasHardFailure,
  logSourceReports,
} from '../src/sources/health.js';
import { validatePipelineResult } from '../src/output-schema.js';

const program = new Command();
const defaults = loadPipelineConfig();

program
  .name('constellate')
  .description('Discover non-obvious patterns across idea corpora')
  .version('0.2.0');

function addPipelineOptions(command: Command): Command {
  return command
    .option('--force', 'Ignore reusable caches', false)
    .option('--retry-failed', 'Retry only reviewed invalid/refused cache entries', false)
    .option('--skip-failed', 'Skip reviewed invalid/refused entries without retrying', false)
    .option('--clusters <n>', 'Number of clusters', String(defaults.num_clusters))
    .option('--min-score <n>', 'Minimum constellation score', String(defaults.min_constellation_score))
    .option('--model <model>', 'Anthropic model', defaults.model)
    .option('--max-output-tokens <n>', 'Maximum output tokens per call', String(defaults.max_output_tokens))
    .option('--effort <level>', 'Fable reasoning effort', defaults.effort)
    .option('--max-budget-usd <n>', 'Hard run budget in USD', String(defaults.max_budget_usd))
    .option('--max-calls <n>', 'Hard provider call limit', String(defaults.max_calls))
    .option('--concurrency <n>', 'Provider request concurrency', String(defaults.concurrency))
    .option('--input-usd-per-million <n>', 'Input price per million tokens', String(defaults.input_usd_per_million))
    .option('--output-usd-per-million <n>', 'Output price per million tokens', String(defaults.output_usd_per_million))
    .option('--limit <n>', 'Analyze only the first N ideas')
    .option('--embedder <name>', 'Embedder to use', 'tfidf');
}

function configFromOptions(opts: Record<string, string>): Partial<PipelineConfig> {
  return {
    num_clusters: Number(opts.clusters),
    min_constellation_score: Number(opts.minScore),
    model: opts.model,
    max_output_tokens: Number(opts.maxOutputTokens),
    effort: opts.effort as PipelineConfig['effort'],
    max_budget_usd: Number(opts.maxBudgetUsd),
    max_calls: Number(opts.maxCalls),
    concurrency: Number(opts.concurrency),
    input_usd_per_million: Number(opts.inputUsdPerMillion),
    output_usd_per_million: Number(opts.outputUsdPerMillion),
  };
}

async function confirmSpend(report: PreflightReport): Promise<boolean> {
  if (!stdin.isTTY || !stdout.isTTY) return false;
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await readline.question(
      `Maximum theoretical cost is USD ${report.maximum_theoretical_cost_usd.toFixed(4)} ` +
        `(hard budget USD ${report.configured_budget_usd.toFixed(4)}). Type YES to spend: `,
    );
    return answer.trim() === 'YES';
  } finally {
    readline.close();
  }
}

addPipelineOptions(
  program
    .command('run')
    .description('Run the pipeline; defaults to a zero-call dry run')
    .option('--output <path>', 'Output JSON path', 'output.json')
    .option('--dry-run', 'Force zero provider calls', false)
    .option('--yes', 'Skip the interactive paid-run confirmation', false),
).action(async (opts) => {
  try {
    const config = configFromOptions(opts);
    const dryRun = opts.dryRun || Number(opts.maxBudgetUsd) === 0 || Number(opts.maxCalls) === 0;
    const result = await runPipeline({
      config,
      embedder: await createEmbedder(opts.embedder),
      forceRecompute: opts.force,
      retryFailed: opts.retryFailed,
      skipFailed: opts.skipFailed,
      limit: opts.limit ? Number(opts.limit) : undefined,
      dryRun,
      yes: opts.yes,
      confirmSpend,
    });

    if (dryRun) {
      console.log('\nDry run complete. No output file was written and no provider call was made.');
    } else {
      const validation = validatePipelineResult(result);
      if (!validation.success) throw new Error(validation.errors.join('; '));
      writeFileSync(opts.output, JSON.stringify(result, null, 2));
      console.log(`\nValidated results written to ${opts.output}`);
      printSummary(result);
    }
    closeDb();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    closeDb();
    process.exitCode = 1;
  }
});

addPipelineOptions(
  program.command('dry-run').description('Estimate 30 ideas, 50 ideas, and the full local dataset'),
).action(async (opts) => {
  try {
    const db = getDb();
    const total = (db.prepare('SELECT COUNT(*) AS count FROM ideas').get() as { count: number }).count;
    const requested = opts.limit ? [Number(opts.limit)] : [30, 50, total];
    const limits = Array.from(new Set(requested.filter((value) => value >= 3 && value <= total)));
    if (limits.length === 0) throw new Error(`No valid dry-run scenario for ${total} stored ideas.`);

    for (const limit of limits) {
      console.log(`\n\n########## DRY-RUN SCENARIO: ${limit} IDEAS ##########`);
      await runPipeline({
        db,
        config: configFromOptions(opts),
        embedder: await createEmbedder(opts.embedder),
        forceRecompute: opts.force,
        retryFailed: opts.retryFailed,
        skipFailed: opts.skipFailed,
        limit,
        dryRun: true,
      });
    }
    closeDb();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    closeDb();
    process.exitCode = 1;
  }
});

program
  .command('ingest <file>')
  .description('Import ideas from an array or pipeline-output JSON file')
  .action((file) => {
    try {
      const data: unknown = JSON.parse(readFileSync(file, 'utf8'));
      let ideas: RawIdea[] = [];
      if (Array.isArray(data)) ideas = data as RawIdea[];
      else if (typeof data === 'object' && data !== null && 'ideas' in data) {
        const value = (data as { ideas?: unknown }).ideas;
        ideas = Array.isArray(value)
          ? (value as RawIdea[])
          : typeof value === 'object' && value !== null
            ? (Object.values(value) as RawIdea[])
            : [];
      }
      if (ideas.length === 0) throw new Error('No ideas found in file.');
      const count = bulkInsertIdeas(ideas);
      console.log(`Ingested ${count} new ideas (${ideas.length - count} duplicates skipped).`);
      closeDb();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      closeDb();
      process.exitCode = 1;
    }
  });

program
  .command('clear-cache')
  .description('Clear embeddings and AI response caches')
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
        throw new Error(`Unknown source: ${source}. Available: ${SOURCE_NAMES.join(', ')}`);
      }
      const results = source
        ? [{ source, ideas: await SCRAPERS[source]() }]
        : await scrapeAll();
      let totalFetched = 0;
      let totalNew = 0;
      const outcomes = results.map((result) => {
        if (result.error) {
          return { source: result.source, fetched: 0, inserted: 0, error: result.error };
        }
        const inserted = bulkInsertIdeas(result.ideas);
        totalFetched += result.ideas.length;
        totalNew += inserted;
        return { source: result.source, fetched: result.ideas.length, inserted };
      });
      const reports = evaluateSources(outcomes);
      logSourceReports(reports);
      console.log(`Total: ${totalFetched} fetched, ${totalNew} new ideas ingested.`);
      console.log(formatSourceSummary(reports));
      closeDb();
      if (hasHardFailure(reports)) process.exitCode = 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      closeDb();
      process.exitCode = 1;
    }
  });

program
  .command('stats')
  .description('Show database statistics')
  .action(() => {
    const db = getDb();
    for (const [label, table] of [
      ['Ideas', 'ideas'],
      ['Embeddings', 'idea_embeddings'],
      ['Constellations', 'constellations_cache'],
      ['Patterns', 'cluster_patterns_cache'],
      ['Cached API jobs', 'api_call_cache'],
      ['API attempts', 'api_call_attempts'],
    ]) {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
      console.log(`${label.padEnd(15)} ${row.count}`);
    }
    closeDb();
  });

function printSummary(result: Awaited<ReturnType<typeof runPipeline>>) {
  console.log('\n─── Summary ───');
  console.log(`Ideas analyzed:  ${result.metadata.total_ideas}`);
  console.log(`Neighborhoods:   ${result.metadata.neighborhoods_total}`);
  console.log(`Constellations:  ${result.metadata.constellations_found}`);
  console.log(`Patterns:        ${result.patterns.length}`);
  console.log(`Actual cost:     USD ${result.metadata.estimated_cost_usd.toFixed(4)}`);
  console.log(`Time:            ${(result.metadata.elapsed_ms / 1000).toFixed(1)}s`);
}

await program.parseAsync();

import Anthropic from '@anthropic-ai/sdk';
import type {
  PipelineConfig,
  PipelineResult,
  Embedder,
  PreflightReport,
} from '../types/index.js';
import { DEFAULT_CONFIG, isDryRunConfig, loadPipelineConfig } from '../config.js';
import { getDb, loadIdeas } from '../db/database.js';
import { createEmbedder } from '../embeddings/embedder.js';
import { stage1Embeddings } from './stage1-embeddings.js';
import { stage2Neighborhoods } from './stage2-neighborhoods.js';
import { stage3Constellations } from './stage3-constellations.js';
import { stage4Patterns } from './stage4-patterns.js';
import { buildConstellationJobs, buildPatternJobs } from './inputs.js';
import { buildPreflightReport, formatPreflightReport } from './preflight.js';
import { CostTracker } from '../utils/cost-tracker.js';
import { ApiBudget } from '../utils/api-budget.js';
import { timer } from '../utils/timer.js';
import { validatePipelineResult } from '../output-schema.js';
import Database from 'better-sqlite3';

export { DEFAULT_CONFIG } from '../config.js';

export interface RunOptions {
  config?: Partial<PipelineConfig>;
  embedder?: Embedder;
  forceRecompute?: boolean;
  retryFailed?: boolean;
  skipFailed?: boolean;
  db?: Database.Database;
  limit?: number;
  dryRun?: boolean;
  yes?: boolean;
  confirmSpend?: (report: PreflightReport) => Promise<boolean>;
  onPreflight?: (report: PreflightReport) => void;
}

export async function runPipeline(options: RunOptions = {}): Promise<PipelineResult> {
  const totalElapsed = timer();
  const config = loadPipelineConfig(process.env, options.config);
  const dryRun = options.dryRun === true || isDryRunConfig(config);
  const db = options.db || getDb();
  const pricing = {
    input_per_million: config.input_usd_per_million,
    output_per_million: config.output_usd_per_million,
  };
  const costTracker = new CostTracker(pricing);
  const embedder = options.embedder || (await createEmbedder('tfidf'));

  console.log('\n========== CONSTELLATE PIPELINE START ==========');
  console.log(`[config] Mode: ${dryRun ? 'dry-run' : 'paid'}`);
  console.log(`[config] Model: ${config.model}`);
  console.log(`[config] Max output tokens: ${config.max_output_tokens}`);
  console.log(`[config] Effort: ${config.effort}`);
  console.log(`[config] Hard limits: USD ${config.max_budget_usd.toFixed(4)}, ${config.max_calls} calls`);
  console.log(`[config] Concurrency: ${config.concurrency}`);
  console.log(`[config] Embedder: ${embedder.model}`);
  console.log(
    `[config] Corpus window: ${
      config.corpus_window_days > 0 ? `${config.corpus_window_days} days` : 'disabled (full corpus)'
    }`,
  );

  const windowDays = config.corpus_window_days;
  const allIdeas = loadIdeas(db, windowDays);
  const ideas = options.limit ? allIdeas.slice(0, options.limit) : allIdeas;
  const windowLabel = windowDays > 0 ? `last ${windowDays} days` : 'full corpus, no window';
  console.log(
    `[pipeline] ${ideas.length} ideas loaded (${windowLabel})${options.limit ? ` (limit ${options.limit})` : ''}`,
  );
  if (ideas.length < 3) {
    const hint =
      windowDays > 0
        ? ` The ${windowDays}-day window may be too narrow — scrape first, or raise CORPUS_WINDOW_DAYS.`
        : '';
    throw new Error(`Need at least 3 ideas to run the pipeline. Found ${ideas.length}.${hint}`);
  }

  const ideaMap = new Map(ideas.map((idea) => [idea.id, idea]));
  const forceRecompute = options.forceRecompute || false;
  const s1 = await stage1Embeddings(ideas, embedder, config, forceRecompute, db);
  const s2 = stage2Neighborhoods(s1.clusters, s1.embeddings, config);
  const constellationJobs = buildConstellationJobs(s2.neighborhoods, ideaMap, config);
  const patternJobs = buildPatternJobs(s1.clusters, ideaMap, config);
  const jobs = [...constellationJobs, ...patternJobs];
  const report = buildPreflightReport({
    jobs,
    documents: ideas.length,
    sources: new Set(ideas.map((idea) => idea.source)).size,
    clusters: s1.clusters.size,
    neighborhoods: s2.neighborhoods.length,
    config,
    dryRun,
    forceRecompute,
    skipFailed: options.skipFailed === true,
    db,
  });
  console.log(formatPreflightReport(report));
  options.onPreflight?.(report);

  let client: Anthropic | null = null;
  if (!dryRun) {
    if (!options.yes) {
      if (!options.confirmSpend || !(await options.confirmSpend(report))) {
        throw new Error('Paid run cancelled: explicit confirmation was not received.');
      }
    }
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for a paid run.');
    client = new Anthropic({ apiKey });
  }

  const budget = new ApiBudget(config.max_calls, config.max_budget_usd, pricing);
  const s3 = await stage3Constellations(
    constellationJobs,
    client,
    config,
    costTracker,
    budget,
    forceRecompute,
    db,
    options.retryFailed,
    options.skipFailed,
  );
  const s4 = await stage4Patterns(
    patternJobs,
    client,
    config,
    costTracker,
    budget,
    forceRecompute,
    db,
    options.retryFailed,
    options.skipFailed,
  );

  const totalCost = costTracker.totalCost();
  const byType: Record<string, number> = {};
  for (const constellation of s3.constellations) {
    byType[constellation.constellation_type] =
      (byType[constellation.constellation_type] || 0) + 1;
  }
  const totalMs = totalElapsed();

  console.log('\n========== PIPELINE COMPLETE ==========');
  console.log(`[mode] ${dryRun ? 'DRY RUN — zero provider calls' : 'PAID RUN'}`);
  console.log(`[constellations] ${s3.constellations.length} (${s3.cacheHits} cache hits)`);
  console.log(`[patterns] ${s4.patterns.length} (${s4.cacheHits} cache hits)`);
  console.log(`[api] ${budget.calls} calls, USD ${totalCost.toFixed(4)} actual`);
  console.log(`[time] ${totalMs}ms`);

  const ideasRef: PipelineResult['ideas'] = {};
  for (const idea of ideas) {
    ideasRef[idea.id] = {
      title: idea.title,
      url: idea.url,
      source: idea.source,
      category: idea.category,
      description: idea.description,
    };
  }

  const result: PipelineResult = {
    constellations: s3.constellations,
    patterns: s4.patterns,
    ideas: ideasRef,
    metadata: {
      generated_at: new Date().toISOString(),
      total_ideas: ideas.length,
      neighborhoods_intra: s2.intraCount,
      neighborhoods_cross: s2.crossCount,
      neighborhoods_total: s2.neighborhoods.length,
      constellations_found: s3.constellations.length,
      constellations_by_type: byType,
      constellation_cache_hits: s3.cacheHits,
      constellation_api_calls: s3.apiCalls,
      constellation_failed_skips: s3.failedSkips,
      pattern_cache_hits: s4.cacheHits,
      pattern_api_calls: s4.apiCalls,
      pattern_failed_skips: s4.failedSkips,
      estimated_cost_usd: totalCost,
      elapsed_ms: totalMs,
    },
  };

  const validation = validatePipelineResult(result);
  if (!validation.success) {
    throw new Error(`Pipeline produced invalid output: ${validation.errors.join('; ')}`);
  }
  console.log('[schema] Output shape validated');
  return result;
}

export { DEFAULT_CONFIG as defaultConfig };

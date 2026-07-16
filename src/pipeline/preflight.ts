import type Database from 'better-sqlite3';
import type { PipelineConfig, PreflightReport } from '../types/index.js';
import type { AiJob } from './inputs.js';
import { getCachedApiCall } from '../db/database.js';
import { calculateCost } from '../utils/cost-tracker.js';

export function buildPreflightReport(options: {
  jobs: AiJob[];
  documents: number;
  sources: number;
  clusters: number;
  neighborhoods: number;
  config: PipelineConfig;
  dryRun: boolean;
  forceRecompute: boolean;
  skipFailed: boolean;
  db: Database.Database;
}): PreflightReport {
  const { jobs, config, dryRun, forceRecompute, skipFailed, db } = options;
  const uncached: AiJob[] = [];
  let cacheReusable = 0;
  let cacheSkippedFailed = 0;

  for (const job of jobs) {
    const cached = forceRecompute
      ? undefined
      : getCachedApiCall(job.inputHash, job.model, job.promptVersion, db);
    if (cached?.status === 'valid') cacheReusable += 1;
    else if (cached && skipFailed) cacheSkippedFailed += 1;
    else uncached.push(job);
  }

  const planned = config.max_calls === 0
    ? uncached
    : uncached.slice(0, config.max_calls);
  const inputEstimated = planned.reduce((sum, job) => sum + job.estimatedInputTokens, 0);
  const inputMaximum = planned.reduce((sum, job) => sum + job.maximumInputTokens, 0);
  const outputMaximum = planned.length * config.max_output_tokens;
  const pricing = {
    input_per_million: config.input_usd_per_million,
    output_per_million: config.output_usd_per_million,
  };

  return {
    documents: options.documents,
    sources: options.sources,
    clusters: options.clusters,
    neighborhoods: options.neighborhoods,
    constellation_jobs: jobs.filter((job) => job.stage === 'constellations').length,
    pattern_jobs: jobs.filter((job) => job.stage === 'patterns').length,
    calls_estimated: uncached.length,
    calls_planned: planned.length,
    cache_reusable: cacheReusable,
    cache_skipped_failed: cacheSkippedFailed,
    input_tokens_estimated: inputEstimated,
    input_tokens_maximum: inputMaximum,
    output_tokens_maximum: outputMaximum,
    expected_cost_usd: calculateCost(
      inputEstimated,
      Math.ceil(outputMaximum * 0.35),
      pricing,
    ),
    maximum_theoretical_cost_usd: calculateCost(inputMaximum, outputMaximum, pricing),
    configured_budget_usd: config.max_budget_usd,
    configured_max_calls: config.max_calls,
    dry_run: dryRun,
  };
}

export function formatPreflightReport(report: PreflightReport): string {
  return [
    '',
    '========== API PREFLIGHT ==========',
    `Mode: ${report.dry_run ? 'DRY RUN — no API calls' : 'PAID RUN'}`,
    `Documents: ${report.documents} from ${report.sources} sources`,
    `Clusters: ${report.clusters}`,
    `Neighborhoods: ${report.neighborhoods}`,
    `Jobs: ${report.constellation_jobs} constellation + ${report.pattern_jobs} pattern`,
    `Calls estimated: ${report.calls_estimated}`,
    `Calls planned under current cap: ${report.calls_planned}`,
    `Reusable cache entries: ${report.cache_reusable}`,
    `Reviewed failed entries skipped: ${report.cache_skipped_failed}`,
    `Estimated input tokens: ${report.input_tokens_estimated}`,
    `Conservative maximum input tokens: ${report.input_tokens_maximum}`,
    `Maximum output tokens: ${report.output_tokens_maximum}`,
    `Expected cost: USD ${report.expected_cost_usd.toFixed(4)}`,
    `Maximum theoretical cost: USD ${report.maximum_theoretical_cost_usd.toFixed(4)}`,
    `Hard limits: USD ${report.configured_budget_usd.toFixed(4)}, ${report.configured_max_calls} calls`,
    '===================================',
  ].join('\n');
}

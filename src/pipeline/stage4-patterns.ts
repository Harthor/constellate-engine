import Anthropic from '@anthropic-ai/sdk';
import type { EmergentPattern, PipelineConfig } from '../types/index.js';
import {
  cacheApiCall,
  cachePattern,
  getCachedApiCall,
  getCachedPatterns,
} from '../db/database.js';
import type { AiJob } from './inputs.js';
import { executeAiJob } from './api-call.js';
import { parsePatternResponse, type PatternCandidate } from './response-parser.js';
import { timer } from '../utils/timer.js';
import { CostTracker } from '../utils/cost-tracker.js';
import { ApiBudget, PipelineLimitError } from '../utils/api-budget.js';
import Database from 'better-sqlite3';

export interface Stage4Result {
  patterns: EmergentPattern[];
  cacheHits: number;
  apiCalls: number;
  failedSkips: number;
  elapsed: number;
  tokenCount: { input: number; output: number };
}

function materialize(candidates: PatternCandidate[], job: AiJob): EmergentPattern[] {
  return candidates.map((candidate) => ({
    cluster_hash: job.scopeHash,
    pattern_title: candidate.name,
    pattern_description: candidate.explanation,
    idea_ids: candidate.idea_ids,
    model: job.model,
    prompt_version: job.promptVersion,
  }));
}

export async function stage4Patterns(
  jobs: AiJob[],
  client: Anthropic | null,
  config: PipelineConfig,
  costTracker: CostTracker,
  budget: ApiBudget,
  forceRecompute: boolean,
  db?: Database.Database,
  retryFailed = false,
  skipFailed = false,
): Promise<Stage4Result> {
  const elapsed = timer();
  const callsBefore = budget.calls;
  let cacheHits = 0;
  let failedSkips = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const results: EmergentPattern[] = [];

  for (const job of jobs) {
    try {
      if (!forceRecompute) {
        const cachedCall = getCachedApiCall(job.inputHash, job.model, job.promptVersion, db);
        if (cachedCall) {
          if (cachedCall.status !== 'valid') {
            if (skipFailed) {
              failedSkips += 1;
              continue;
            } else if (!retryFailed) {
              throw new Error(
                `Cached ${cachedCall.status} response for ${job.scopeHash.slice(0, 8)} blocks automatic retry. Use --retry-failed only after reviewing it.`,
              );
            }
          } else {
            const parsed = parsePatternResponse(JSON.parse(cachedCall.response_json), job.ideaIds);
            results.push(...materialize(parsed.patterns, job));
            cacheHits += 1;
            continue;
          }
        }

        const legacy = getCachedPatterns(job.scopeHash, job.promptVersion, job.model, db);
        if (legacy.length > 0) {
          cacheHits += 1;
          for (const row of legacy) {
            results.push({
              cluster_hash: job.scopeHash,
              pattern_title: row.pattern_title,
              pattern_description: row.pattern_description,
              idea_ids: JSON.parse(row.idea_ids) as number[],
              model: job.model,
              prompt_version: job.promptVersion,
            });
          }
          continue;
        }
      }

      if (!client) continue;
      const call = await executeAiJob(job, client, config, budget, costTracker);
      totalInputTokens += call.inputTokens;
      totalOutputTokens += call.outputTokens;

      if (call.stopReason === 'refusal') {
        cacheApiCall({
          input_hash: job.inputHash,
          stage: job.stage,
          scope_hash: job.scopeHash,
          model: job.model,
          prompt_version: job.promptVersion,
          status: 'refusal',
          response_json: JSON.stringify({ stop_reason: 'refusal' }),
          input_tokens: call.inputTokens,
          output_tokens: call.outputTokens,
          cost_usd: call.costUsd,
        }, db);
        throw new Error('Claude Fable 5 refused a request; fallback is disabled to protect budget.');
      }

      let parsed: ReturnType<typeof parsePatternResponse>;
      try {
        parsed = parsePatternResponse(call.text, job.ideaIds);
      } catch (error) {
        cacheApiCall({
          input_hash: job.inputHash,
          stage: job.stage,
          scope_hash: job.scopeHash,
          model: job.model,
          prompt_version: job.promptVersion,
          status: 'invalid',
          response_json: JSON.stringify({ raw: call.text }),
          input_tokens: call.inputTokens,
          output_tokens: call.outputTokens,
          cost_usd: call.costUsd,
        }, db);
        throw error;
      }

      cacheApiCall({
        input_hash: job.inputHash,
        stage: job.stage,
        scope_hash: job.scopeHash,
        model: job.model,
        prompt_version: job.promptVersion,
        status: 'valid',
        response_json: JSON.stringify(parsed),
        input_tokens: call.inputTokens,
        output_tokens: call.outputTokens,
        cost_usd: call.costUsd,
      }, db);
      const materialized = materialize(parsed.patterns, job);
      for (const pattern of materialized) cachePattern(pattern, db);
      results.push(...materialized);
    } catch (error) {
      if (error instanceof PipelineLimitError) {
        console.log(`[stage4] Stopped safely: ${error.message}`);
        break;
      }
      const failure = error instanceof Error ? error : new Error(String(error));
      budget.halt(`Persistent provider or parsing error: ${failure.message}`);
      throw failure;
    }
  }

  console.log(
    `[stage4] ${results.length} patterns (${cacheHits} cache hits, ${budget.calls - callsBefore} API calls, ${elapsed()}ms)`,
  );
  return {
    patterns: results,
    cacheHits,
    apiCalls: budget.calls - callsBefore,
    failedSkips,
    elapsed: elapsed(),
    tokenCount: { input: totalInputTokens, output: totalOutputTokens },
  };
}

import Anthropic from '@anthropic-ai/sdk';
import type { Constellation, PipelineConfig, ConstellationType } from '../types/index.js';
import {
  cacheApiCall,
  cacheConstellation,
  getCachedApiCall,
  getCachedConstellations,
} from '../db/database.js';
import type { AiJob } from './inputs.js';
import { executeAiJob } from './api-call.js';
import { parseConstellationResponse, type ConstellationCandidate } from './response-parser.js';
import { pLimit } from '../utils/concurrency.js';
import { timer } from '../utils/timer.js';
import { CostTracker } from '../utils/cost-tracker.js';
import { ApiBudget, PipelineLimitError } from '../utils/api-budget.js';
import Database from 'better-sqlite3';

export interface Stage3Result {
  constellations: Constellation[];
  cacheHits: number;
  apiCalls: number;
  failedSkips: number;
  elapsed: number;
  tokenCount: { input: number; output: number };
}

function materialize(
  candidates: ConstellationCandidate[],
  job: AiJob,
  config: PipelineConfig,
): Constellation[] {
  return candidates
    .filter((candidate) => candidate.score >= config.min_constellation_score)
    .map((candidate) => ({
      neighborhood_hash: job.scopeHash,
      constellation_type: candidate.type,
      idea_ids: candidate.idea_ids,
      title: candidate.title,
      explanation: candidate.explanation,
      score: candidate.score,
      actionability: candidate.type === 'absence' ? candidate.actionability : undefined,
      model: job.model,
      prompt_version: job.promptVersion,
    }));
}

export async function stage3Constellations(
  jobs: AiJob[],
  client: Anthropic | null,
  config: PipelineConfig,
  costTracker: CostTracker,
  budget: ApiBudget,
  forceRecompute: boolean,
  db?: Database.Database,
  retryFailed = false,
  skipFailed = false,
): Promise<Stage3Result> {
  const elapsed = timer();
  const limit = pLimit(config.concurrency);
  const callsBefore = budget.calls;
  let cacheHits = 0;
  let failedSkips = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let fatalError: Error | null = null;
  let limitMessageShown = false;
  const allConstellations: Constellation[] = [];

  const tasks = jobs.map((job) =>
    limit(async () => {
      if (fatalError) return;
      try {
        if (!forceRecompute) {
          const cachedCall = getCachedApiCall(job.inputHash, job.model, job.promptVersion, db);
          if (cachedCall) {
            if (cachedCall.status !== 'valid') {
              if (skipFailed) {
                failedSkips += 1;
                return;
              } else if (!retryFailed) {
                throw new Error(
                  `Cached ${cachedCall.status} response for ${job.scopeHash.slice(0, 8)} blocks automatic retry. Use --retry-failed only after reviewing it.`,
                );
              }
            } else {
              const parsed = parseConstellationResponse(
                JSON.parse(cachedCall.response_json),
                job.ideaIds,
              );
              allConstellations.push(...materialize(parsed.constellations, job, config));
              cacheHits += 1;
              return;
            }
          }

          const legacy = getCachedConstellations(
            job.scopeHash,
            job.promptVersion,
            job.model,
            db,
          );
          if (legacy.length > 0) {
            cacheHits += 1;
            for (const row of legacy) {
              if (row.title === '__ERROR__') continue;
              allConstellations.push({
                neighborhood_hash: job.scopeHash,
                constellation_type: row.constellation_type as ConstellationType,
                idea_ids: JSON.parse(row.idea_ids) as number[],
                title: row.title,
                explanation: row.explanation,
                score: row.score,
                actionability: row.actionability ?? undefined,
                model: job.model,
                prompt_version: job.promptVersion,
              });
            }
            return;
          }
        }

        if (!client) return;
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

        let parsed: ReturnType<typeof parseConstellationResponse>;
        try {
          parsed = parseConstellationResponse(call.text, job.ideaIds);
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

        const materialized = materialize(parsed.constellations, job, config);
        for (const constellation of materialized) {
          cacheConstellation({
            neighborhood_hash: constellation.neighborhood_hash,
            constellation_type: constellation.constellation_type,
            idea_ids: constellation.idea_ids,
            title: constellation.title,
            explanation: constellation.explanation,
            score: constellation.score,
            actionability: constellation.actionability,
            model: constellation.model,
            prompt_version: constellation.prompt_version,
          }, db);
        }
        allConstellations.push(...materialized);
      } catch (error) {
        if (error instanceof PipelineLimitError) {
          if (!limitMessageShown) {
            console.log(`[stage3] Stopped safely: ${error.message}`);
            limitMessageShown = true;
          }
          return;
        }
        const failure = error instanceof Error ? error : new Error(String(error));
        fatalError = failure;
        budget.halt(`Persistent provider or parsing error: ${failure.message}`);
      }
    }),
  );

  await Promise.all(tasks);
  if (fatalError) throw fatalError;

  console.log(
    `[stage3] ${allConstellations.length} constellations found (${cacheHits} cache hits, ${budget.calls - callsBefore} API calls, ${elapsed()}ms)`,
  );
  return {
    constellations: allConstellations,
    cacheHits,
    apiCalls: budget.calls - callsBefore,
    failedSkips,
    elapsed: elapsed(),
    tokenCount: { input: totalInputTokens, output: totalOutputTokens },
  };
}

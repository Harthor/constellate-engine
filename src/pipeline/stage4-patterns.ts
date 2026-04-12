import Anthropic from '@anthropic-ai/sdk';
import type { EmergentPattern, PipelineConfig } from '../types/index.js';
import type { IdeaRow } from '../db/database.js';
import { getCachedPatterns, cachePattern } from '../db/database.js';
import {
  EMERGENT_PATTERNS_VERSION,
  EMERGENT_PATTERNS_SYSTEM,
  emergentPatternsPrompt,
} from '../prompts/emergent-patterns.js';
import { withRetry } from '../utils/retry.js';
import { hashIds } from '../utils/hash.js';
import { timer } from '../utils/timer.js';
import { CostTracker } from '../utils/cost-tracker.js';
import Database from 'better-sqlite3';

export interface Stage4Result {
  patterns: EmergentPattern[];
  cacheHits: number;
  apiCalls: number;
  elapsed: number;
  tokenCount: { input: number; output: number };
}

export async function stage4Patterns(
  clusters: Map<number, number[]>,
  ideas: Map<number, IdeaRow>,
  client: Anthropic,
  config: PipelineConfig,
  costTracker: CostTracker,
  forceRecompute: boolean,
  db?: Database.Database,
): Promise<Stage4Result> {
  const elapsed = timer();

  let cacheHits = 0;
  let apiCalls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const results: EmergentPattern[] = [];

  for (const [, ideaIds] of clusters) {
    if (ideaIds.length < 3) continue;

    const hash = hashIds(ideaIds);

    // Check cache
    if (!forceRecompute) {
      const cached = getCachedPatterns(hash, EMERGENT_PATTERNS_VERSION, db);
      if (cached.length > 0) {
        cacheHits++;
        for (const row of cached) {
          results.push({
            cluster_hash: hash,
            pattern_title: row.pattern_title,
            pattern_description: row.pattern_description,
            idea_ids: JSON.parse(row.idea_ids),
            model: config.patterns_model,
            prompt_version: EMERGENT_PATTERNS_VERSION,
          });
        }
        continue;
      }
    }

    const clusterIdeas = ideaIds
      .map((id: number) => ideas.get(id)!)
      .filter(Boolean);
    const ideasText = clusterIdeas
      .map((i: IdeaRow) => {
        const desc = (i.description || '').slice(0, 200);
        return `[ID:${i.id}] "${i.title}" (${i.source}, ${i.category || 'uncategorized'}): ${desc}`;
      })
      .join('\n');

    const prompt = emergentPatternsPrompt(ideasText);

    try {
      const msg = await withRetry(() =>
        client.messages.create({
          model: config.patterns_model,
          max_tokens: 1024,
          system: EMERGENT_PATTERNS_SYSTEM,
          messages: [{ role: 'user', content: prompt }],
        }),
      );

      apiCalls++;
      const inputTokens = msg.usage?.input_tokens || 0;
      const outputTokens = msg.usage?.output_tokens || 0;
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      costTracker.record(config.patterns_model, inputTokens, outputTokens, 'patterns');

      const text =
        msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const patterns = parsed.patterns || [];

        for (const p of patterns) {
          cachePattern(
            {
              cluster_hash: hash,
              pattern_title: p.name,
              pattern_description: p.explanation,
              idea_ids: p.idea_ids || [],
              model: config.patterns_model,
              prompt_version: EMERGENT_PATTERNS_VERSION,
            },
            db,
          );
          results.push({
            cluster_hash: hash,
            pattern_title: p.name,
            pattern_description: p.explanation,
            idea_ids: p.idea_ids || [],
            model: config.patterns_model,
            prompt_version: EMERGENT_PATTERNS_VERSION,
          });
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `[stage4] API error for cluster ${hash.slice(0, 8)}: ${msg}`,
      );
    }
  }

  console.log(
    `[stage4] ${results.length} patterns from ${clusters.size} clusters (${cacheHits} cache hits, ${apiCalls} API calls, ${elapsed()}ms)`,
  );

  return {
    patterns: results,
    cacheHits,
    apiCalls,
    elapsed: elapsed(),
    tokenCount: { input: totalInputTokens, output: totalOutputTokens },
  };
}

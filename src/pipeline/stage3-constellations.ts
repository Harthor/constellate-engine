import Anthropic from '@anthropic-ai/sdk';
import type { Constellation, PipelineConfig, ConstellationType } from '../types/index.js';
import type { IdeaRow } from '../db/database.js';
import { getCachedConstellations, cacheConstellation } from '../db/database.js';
import {
  CONSTELLATION_DISCOVERY_VERSION,
  CONSTELLATION_DISCOVERY_SYSTEM,
  constellationDiscoveryPrompt,
} from '../prompts/constellation-discovery.js';
import { pLimit } from '../utils/concurrency.js';
import { withRetry } from '../utils/retry.js';
import { hashIds } from '../utils/hash.js';
import { timer } from '../utils/timer.js';
import { CostTracker } from '../utils/cost-tracker.js';
import Database from 'better-sqlite3';

export interface Stage3Result {
  constellations: Constellation[];
  cacheHits: number;
  apiCalls: number;
  elapsed: number;
  tokenCount: { input: number; output: number };
}

export async function stage3Constellations(
  neighborhoods: number[][],
  ideas: Map<number, IdeaRow>,
  client: Anthropic,
  config: PipelineConfig,
  costTracker: CostTracker,
  forceRecompute: boolean,
  db?: Database.Database,
): Promise<Stage3Result> {
  const elapsed = timer();
  const limit = pLimit(config.discovery_concurrency);

  let cacheHits = 0;
  let apiCalls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const allConstellations: Constellation[] = [];

  const tasks = neighborhoods.map((neighborhood) =>
    limit(async () => {
      const hash = hashIds(neighborhood);

      // Check cache
      if (!forceRecompute) {
        const cached = getCachedConstellations(
          hash,
          CONSTELLATION_DISCOVERY_VERSION,
          db,
        );
        if (cached.length > 0) {
          cacheHits++;
          for (const row of cached) {
            const parsedIds = JSON.parse(row.idea_ids) as number[];
            if (row.title !== '__ERROR__') {
              allConstellations.push({
                neighborhood_hash: hash,
                constellation_type: row.constellation_type as ConstellationType,
                idea_ids: parsedIds,
                title: row.title,
                explanation: row.explanation,
                score: row.score,
                actionability: row.actionability ?? undefined,
                model: config.discovery_model,
                prompt_version: CONSTELLATION_DISCOVERY_VERSION,
              });
            }
          }
          return;
        }
      }

      // Build ideas text
      const ideasText = neighborhood
        .map((id) => {
          const idea = ideas.get(id);
          if (!idea) return null;
          const desc = (idea.description || '').slice(0, 300);
          return `[ID:${id}] "${idea.title}" (${idea.source}, ${idea.category || 'uncategorized'}): ${desc}`;
        })
        .filter(Boolean)
        .join('\n');

      const prompt = constellationDiscoveryPrompt(ideasText, neighborhood.length);

      try {
        const msg = await withRetry(() =>
          client.messages.create({
            model: config.discovery_model,
            max_tokens: 2048,
            system: CONSTELLATION_DISCOVERY_SYSTEM,
            messages: [{ role: 'user', content: prompt }],
          }),
        );

        apiCalls++;
        const inputTokens = msg.usage?.input_tokens || 0;
        const outputTokens = msg.usage?.output_tokens || 0;
        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;
        costTracker.record(config.discovery_model, inputTokens, outputTokens, 'constellations');

        const text =
          msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const constellations = parsed.constellations || [];

          for (const c of constellations) {
            if (c.score < config.min_constellation_score) continue;

            // Only keep actionability for absences; ignore if Claude emits
            // it elsewhere or clamp to [1..10] if it comes back out of range.
            const rawAct = typeof c.actionability === 'number' ? c.actionability : null;
            const actionability =
              c.type === 'absence' && rawAct !== null
                ? Math.max(1, Math.min(10, Math.round(rawAct)))
                : null;

            const constellation: Constellation = {
              neighborhood_hash: hash,
              constellation_type: c.type as ConstellationType,
              idea_ids: c.idea_ids,
              title: c.title,
              explanation: c.explanation,
              score: c.score,
              actionability: actionability ?? undefined,
              model: config.discovery_model,
              prompt_version: CONSTELLATION_DISCOVERY_VERSION,
            };

            cacheConstellation(
              {
                neighborhood_hash: hash,
                constellation_type: c.type,
                idea_ids: c.idea_ids,
                title: c.title,
                explanation: c.explanation,
                score: c.score,
                actionability,
                model: config.discovery_model,
                prompt_version: CONSTELLATION_DISCOVERY_VERSION,
              },
              db,
            );
            allConstellations.push(constellation);
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(
          `[stage3] API error for neighborhood ${hash.slice(0, 8)}: ${msg}`,
        );
      }
    }),
  );

  await Promise.all(tasks);

  console.log(
    `[stage3] ${allConstellations.length} constellations found (${cacheHits} cache hits, ${apiCalls} API calls, ${elapsed()}ms)`,
  );

  return {
    constellations: allConstellations,
    cacheHits,
    apiCalls,
    elapsed: elapsed(),
    tokenCount: { input: totalInputTokens, output: totalOutputTokens },
  };
}

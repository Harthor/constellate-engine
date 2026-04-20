import Anthropic from '@anthropic-ai/sdk';
import type { PipelineConfig, PipelineResult, Embedder } from '../types/index.js';
import { getDb, loadIdeas } from '../db/database.js';
import { createEmbedder } from '../embeddings/embedder.js';
import { stage1Embeddings } from './stage1-embeddings.js';
import { stage2Neighborhoods } from './stage2-neighborhoods.js';
import { stage3Constellations } from './stage3-constellations.js';
import { stage4Patterns } from './stage4-patterns.js';
import { CostTracker } from '../utils/cost-tracker.js';
import { timer } from '../utils/timer.js';
import Database from 'better-sqlite3';

export const DEFAULT_CONFIG: PipelineConfig = {
  num_clusters: 30,
  max_neighborhood_size: 30,
  min_neighborhood_size: 20,
  max_cross_cluster_neighborhoods: 10,
  max_total_neighborhoods: 50,
  discovery_model: 'claude-sonnet-4-5-20250929',
  patterns_model: 'claude-opus-4-5-20251101',
  min_constellation_score: 6,
  discovery_concurrency: 5,
  cost_budget_usd: 15.0,
};

export interface RunOptions {
  config?: Partial<PipelineConfig>;
  embedder?: Embedder;
  forceRecompute?: boolean;
  db?: Database.Database;
  apiKey?: string;
}

export async function runPipeline(options: RunOptions = {}): Promise<PipelineResult> {
  const totalElapsed = timer();
  const config: PipelineConfig = { ...DEFAULT_CONFIG, ...options.config };
  const db = options.db || getDb();
  const costTracker = new CostTracker();

  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required. Set it as an environment variable or pass it via options.');
  }
  const client = new Anthropic({ apiKey });

  const embedder = options.embedder || (await createEmbedder('tfidf'));

  console.log('\n========== CONSTELLATE PIPELINE START ==========');
  console.log(`[config] Clusters: ${config.num_clusters}`);
  console.log(`[config] Max neighborhoods: ${config.max_total_neighborhoods}`);
  console.log(`[config] Discovery model: ${config.discovery_model}`);
  console.log(`[config] Patterns model: ${config.patterns_model}`);
  console.log(`[config] Min score: ${config.min_constellation_score}`);
  console.log(`[config] Embedder: ${embedder.model}`);

  // Load ideas
  const ideas = loadIdeas(db);
  console.log(`[pipeline] ${ideas.length} ideas loaded`);

  if (ideas.length < 3) {
    throw new Error(`Need at least 3 ideas to run the pipeline. Found ${ideas.length}.`);
  }

  const ideaMap = new Map(ideas.map((i) => [i.id, i]));

  // Stage 1: Embeddings + clustering
  const s1 = await stage1Embeddings(ideas, embedder, config, options.forceRecompute || false, db);

  // Stage 2: Neighborhood formation
  const s2 = stage2Neighborhoods(s1.clusters, s1.embeddings, config);

  // Stage 3: Constellation discovery
  const s3 = await stage3Constellations(
    s2.neighborhoods,
    ideaMap,
    client,
    config,
    costTracker,
    options.forceRecompute || false,
    db,
  );

  // Stage 4: Emergent patterns
  const s4 = await stage4Patterns(
    s1.clusters,
    ideaMap,
    client,
    config,
    costTracker,
    options.forceRecompute || false,
    db,
  );

  // Cost summary
  const totalCost = costTracker.totalCost();
  const costByStage = costTracker.costByStage();

  // Count by type
  const byType: Record<string, number> = {};
  for (const c of s3.constellations) {
    byType[c.constellation_type] = (byType[c.constellation_type] || 0) + 1;
  }

  const totalMs = totalElapsed();

  console.log('\n========== PIPELINE COMPLETE ==========');
  console.log(`[neighborhoods] ${s2.intraCount} intra + ${s2.crossCount} cross = ${s2.neighborhoods.length} total`);
  console.log(`[constellations] ${s3.constellations.length} found (score >= ${config.min_constellation_score})`);
  console.log(`[constellations] By type:`, byType);
  console.log(`[patterns] ${s4.patterns.length} emergent patterns`);
  console.log(`[cost] Constellations: $${(costByStage['constellations'] || 0).toFixed(4)}`);
  console.log(`[cost] Patterns: $${(costByStage['patterns'] || 0).toFixed(4)}`);
  console.log(`[cost] TOTAL: $${totalCost.toFixed(4)}`);
  if (totalCost > config.cost_budget_usd) {
    console.warn(`[cost] WARNING: Exceeded budget of $${config.cost_budget_usd}!`);
  }
  console.log(`[time] Total: ${totalMs}ms`);

  // Build ideas reference
  const ideasRef: Record<number, { title: string; source: string; url: string; category: string; description: string }> = {};
  for (const idea of ideas) {
    ideasRef[idea.id] = {
      title: idea.title,
      url: idea.url,
      source: idea.source,
      category: idea.category,
      description: idea.description,
    };
  }

  return {
    constellations: s3.constellations,
    patterns: s4.patterns,
    ideas: ideasRef,
    metadata: {
      total_ideas: ideas.length,
      neighborhoods_intra: s2.intraCount,
      neighborhoods_cross: s2.crossCount,
      neighborhoods_total: s2.neighborhoods.length,
      constellations_found: s3.constellations.length,
      constellations_by_type: byType,
      constellation_cache_hits: s3.cacheHits,
      constellation_api_calls: s3.apiCalls,
      pattern_cache_hits: s4.cacheHits,
      pattern_api_calls: s4.apiCalls,
      estimated_cost_usd: totalCost,
      elapsed_ms: totalMs,
    },
  };
}

export { DEFAULT_CONFIG as defaultConfig };

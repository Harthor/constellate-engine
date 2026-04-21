// ─── Core domain types ──────────────────────────────────────────────
// SYNC NOTE: A subset of these types is duplicated in constellate-web/lib/types.ts.
// Update both files when changing Constellation, EmergentPattern, IdeaRef, or PipelineMetadata.

export interface Idea {
  id: number;
  title: string;
  description: string;
  source: string;
  url: string;
  category: string;
  stack: string;
  created_at: string;
}

export type ConstellationType =
  | 'triangulation'
  | 'spectrum'
  | 'chain'
  | 'convergence'
  | 'absence';

export const CONSTELLATION_TYPES: readonly ConstellationType[] = [
  'triangulation',
  'spectrum',
  'chain',
  'convergence',
  'absence',
] as const;

export interface Constellation {
  id?: number;
  neighborhood_hash: string;
  constellation_type: ConstellationType;
  idea_ids: number[];
  title: string;
  explanation: string;
  score: number;
  /**
   * For constellation_type === "absence" only: 1-10 score of how buildable
   * the missing piece is for an indie hacker / solo founder. Omitted on
   * other types.
   */
  actionability?: number;
  model: string;
  prompt_version: string;
  created_at?: string;
}

export interface EmergentPattern {
  cluster_hash: string;
  pattern_title: string;
  pattern_description: string;
  idea_ids: number[];
  model: string;
  prompt_version: string;
  created_at?: string;
}

// ─── Pipeline types ─────────────────────────────────────────────────

export interface PipelineConfig {
  num_clusters: number;
  max_neighborhood_size: number;
  min_neighborhood_size: number;
  max_cross_cluster_neighborhoods: number;
  max_total_neighborhoods: number;
  discovery_model: string;
  patterns_model: string;
  min_constellation_score: number;
  discovery_concurrency: number;
  cost_budget_usd: number;
}

export interface PipelineMetadata {
  total_ideas: number;
  neighborhoods_intra: number;
  neighborhoods_cross: number;
  neighborhoods_total: number;
  constellations_found: number;
  constellations_by_type: Record<string, number>;
  constellation_cache_hits: number;
  constellation_api_calls: number;
  pattern_cache_hits: number;
  pattern_api_calls: number;
  estimated_cost_usd: number;
  elapsed_ms: number;
}

export interface PipelineResult {
  constellations: Constellation[];
  patterns: EmergentPattern[];
  ideas: Record<number, { title: string; source: string; url: string; category: string; description: string }>;
  metadata: PipelineMetadata;
}

// ─── Embeddings ─────────────────────────────────────────────────────

export interface EmbeddingResult {
  vectors: Float64Array[];
  dimensions: number;
}

export interface Embedder {
  readonly model: string;
  embed(documents: string[]): Promise<EmbeddingResult>;
}

// ─── Sources ────────────────────────────────────────────────────────

export interface RawIdea {
  title: string;
  description: string;
  url: string;
  source: string;
  category?: string;
  stack?: string;
}

export interface SourceScraper {
  readonly name: string;
  fetch(): Promise<RawIdea[]>;
}

// ─── Pricing ────────────────────────────────────────────────────────

export interface ModelPricing {
  input_per_million: number;
  output_per_million: number;
}

// Model IDs include date snapshots. If Anthropic releases new snapshots,
// add them here or cost tracking will silently report $0 for unknown models.
// Check https://docs.anthropic.com/en/docs/about-claude/models for current IDs.
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-haiku-4-5-20251001': { input_per_million: 0.80, output_per_million: 4.00 },
  'claude-sonnet-4-5-20250929': { input_per_million: 3.00, output_per_million: 15.00 },
  'claude-sonnet-4-6-20260514': { input_per_million: 3.00, output_per_million: 15.00 },
  'claude-opus-4-5-20251101': { input_per_million: 15.00, output_per_million: 75.00 },
  'claude-opus-4-6-20260409': { input_per_million: 15.00, output_per_million: 75.00 },
};

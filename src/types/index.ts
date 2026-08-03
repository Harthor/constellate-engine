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
  /**
   * Rolling window, in days, applied to the corpus before vectorizing. The
   * corpus table is cumulative, so without this the analysis mixes the current
   * week with every week before it and the "what's emerging" signal decays.
   *
   * Filtered on ideas.created_at, which is INGESTION time, not publication
   * time — the scrapers do not preserve the latter. A weekly cadence keeps the
   * two roughly aligned; skipping a run drops items that are still recent.
   *
   * 0 disables the window and analyses the whole corpus.
   */
  corpus_window_days: number;
  num_clusters: number;
  max_neighborhood_size: number;
  min_neighborhood_size: number;
  max_cross_cluster_neighborhoods: number;
  max_total_neighborhoods: number;
  model: string;
  min_constellation_score: number;
  max_output_tokens: number;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  max_budget_usd: number;
  max_calls: number;
  concurrency: number;
  input_usd_per_million: number;
  output_usd_per_million: number;
}

export interface PipelineMetadata {
  /** ISO-8601 timestamp for the analysis that produced this snapshot. */
  generated_at?: string;
  total_ideas: number;
  neighborhoods_intra: number;
  neighborhoods_cross: number;
  neighborhoods_total: number;
  constellations_found: number;
  constellations_by_type: Record<string, number>;
  constellation_cache_hits: number;
  constellation_api_calls: number;
  constellation_failed_skips?: number;
  pattern_cache_hits: number;
  pattern_api_calls: number;
  pattern_failed_skips?: number;
  estimated_cost_usd: number;
  elapsed_ms: number;
}

export interface PipelineResult {
  constellations: Constellation[];
  patterns: EmergentPattern[];
  ideas: Record<number, { title: string; source: string; url: string; category: string; description: string }>;
  metadata: PipelineMetadata;
}

export interface PreflightReport {
  documents: number;
  sources: number;
  clusters: number;
  neighborhoods: number;
  constellation_jobs: number;
  pattern_jobs: number;
  calls_estimated: number;
  calls_planned: number;
  cache_reusable: number;
  cache_skipped_failed: number;
  input_tokens_estimated: number;
  input_tokens_maximum: number;
  output_tokens_maximum: number;
  expected_cost_usd: number;
  maximum_theoretical_cost_usd: number;
  configured_budget_usd: number;
  configured_max_calls: number;
  dry_run: boolean;
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

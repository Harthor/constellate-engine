// Constellate Engine — public API

export { runPipeline, DEFAULT_CONFIG } from './pipeline/index.js';
export type { RunOptions } from './pipeline/index.js';

export type {
  Idea,
  Constellation,
  ConstellationType,
  EmergentPattern,
  PipelineConfig,
  PipelineResult,
  PipelineMetadata,
  Embedder,
  EmbeddingResult,
  SourceScraper,
  RawIdea,
} from './types/index.js';

export { CONSTELLATION_TYPES } from './types/index.js';

export { createEmbedder } from './embeddings/embedder.js';
export { TfIdfEmbedder } from './embeddings/tfidf.js';

export { getDb, closeDb, createDb, bulkInsertIdeas, loadIdeas, clearCache } from './db/database.js';

import type { Embedder, EmbeddingResult } from '../types/index.js';

export type { Embedder, EmbeddingResult };

/**
 * Create an embedder instance by name.
 *
 * Built-in: "tfidf" (default, zero cost, no external dependencies).
 * To add your own, implement the Embedder interface and pass it directly
 * to the pipeline config.
 */
export async function createEmbedder(name: string = 'tfidf'): Promise<Embedder> {
  switch (name) {
    case 'tfidf': {
      const { TfIdfEmbedder } = await import('./tfidf.js');
      return new TfIdfEmbedder();
    }
    default:
      throw new Error(`Unknown embedder: "${name}". Available: tfidf`);
  }
}

import type { Embedder, EmbeddingResult } from '../types/index.js';

/**
 * TF-IDF embedder — zero cost, zero external dependencies.
 *
 * Intentional design choice: for corpora of a few hundred ideas,
 * TF-IDF produces clusters that are good enough for the neighborhood
 * formation stage. The heavy lifting (finding non-obvious patterns)
 * is done by Claude, not by the embeddings.
 *
 * If you need denser semantic representations (e.g. for 10k+ ideas),
 * implement the Embedder interface with OpenAI, Voyage, or Cohere.
 */
export class TfIdfEmbedder implements Embedder {
  readonly model = 'tfidf_v1';

  async embed(documents: string[]): Promise<EmbeddingResult> {
    return computeTfIdf(documents);
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function computeTfIdf(docs: string[]): EmbeddingResult {
  const df = new Map<string, number>();
  const tokenizedDocs = docs.map((doc) => {
    const tokens = tokenize(doc);
    const unique = new Set(tokens);
    for (const t of unique) df.set(t, (df.get(t) || 0) + 1);
    return tokens;
  });

  const maxDf = docs.length * 0.8;
  const vocab: string[] = [];
  const vocabIndex = new Map<string, number>();

  for (const [term, count] of df.entries()) {
    if (count >= 2 && count <= maxDf) {
      vocabIndex.set(term, vocab.length);
      vocab.push(term);
    }
  }

  const dim = vocab.length;
  const N = docs.length;

  const vectors = tokenizedDocs.map((tokens) => {
    const vec = new Float64Array(dim);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);

    for (const [term, count] of tf.entries()) {
      const idx = vocabIndex.get(term);
      if (idx !== undefined) {
        const idf = Math.log(N / (df.get(term)! + 1));
        vec[idx] = (count / tokens.length) * idf;
      }
    }

    // L2 normalize
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < dim; i++) vec[i] /= norm;

    return vec;
  });

  return { vectors, dimensions: dim };
}

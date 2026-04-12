import { describe, it, expect } from 'vitest';
import { TfIdfEmbedder } from '../src/embeddings/tfidf.js';

describe('TfIdfEmbedder', () => {
  const embedder = new TfIdfEmbedder();

  it('has model name', () => {
    expect(embedder.model).toBe('tfidf_v1');
  });

  it('returns vectors with correct count', async () => {
    const docs = ['hello world', 'foo bar baz', 'hello foo world'];
    const result = await embedder.embed(docs);
    expect(result.vectors).toHaveLength(3);
  });

  it('vectors are L2-normalized', async () => {
    const docs = [
      'machine learning neural networks deep learning',
      'web development frontend backend api',
      'database query optimization indexing',
    ];
    const { vectors } = await embedder.embed(docs);

    for (const vec of vectors) {
      let norm = 0;
      for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
      norm = Math.sqrt(norm);
      // Should be ~1.0 (or 0 for empty docs)
      if (norm > 0) {
        expect(norm).toBeCloseTo(1.0, 4);
      }
    }
  });

  it('similar documents produce closer vectors', async () => {
    // Need enough docs and shared terms for TF-IDF to build a meaningful vocabulary
    const docs = [
      'machine learning model training neural network deep learning optimization',
      'deep learning neural network inference model training gpu acceleration',
      'cooking recipe italian pasta tomato sauce fresh basil olive oil',
      'baking bread sourdough flour yeast fermentation oven temperature',
    ];
    const { vectors } = await embedder.embed(docs);

    function cosine(a: Float64Array, b: Float64Array): number {
      let dot = 0;
      for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
      return dot; // Already normalized
    }

    const simMlMl = cosine(vectors[0], vectors[1]);
    const simMlCooking = cosine(vectors[0], vectors[2]);
    expect(simMlMl).toBeGreaterThan(simMlCooking);
  });

  it('handles single document', async () => {
    const { vectors, dimensions } = await embedder.embed(['just one doc here']);
    expect(vectors).toHaveLength(1);
    expect(dimensions).toBeGreaterThanOrEqual(0);
  });

  it('dimensions match vector length', async () => {
    const docs = ['alpha beta gamma', 'delta epsilon zeta', 'eta theta iota'];
    const { vectors, dimensions } = await embedder.embed(docs);
    for (const v of vectors) {
      expect(v.length).toBe(dimensions);
    }
  });
});

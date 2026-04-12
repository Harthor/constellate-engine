import type { Embedder, PipelineConfig } from '../types/index.js';
import type { IdeaRow } from '../db/database.js';
import { getCachedEmbeddings, cacheEmbeddings } from '../db/database.js';
import { timer } from '../utils/timer.js';
import Database from 'better-sqlite3';

// ─── KMeans ─────────────────────────────────────────────────────────

function seededRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function kmeans(vectors: Float64Array[], k: number, maxIter = 30): number[] {
  const n = vectors.length;
  const dim = vectors[0].length;
  if (n <= k) return vectors.map((_, i) => i);

  // K-means++ init
  const centroids: Float64Array[] = [];
  const rng = seededRng(42);

  centroids.push(new Float64Array(vectors[Math.floor(rng() * n)]));

  for (let c = 1; c < k; c++) {
    const dists = vectors.map((v) => {
      let minD = Infinity;
      for (const cent of centroids) {
        let d = 0;
        for (let i = 0; i < dim; i++) d += (v[i] - cent[i]) ** 2;
        minD = Math.min(minD, d);
      }
      return minD;
    });
    const totalDist = dists.reduce((a, b) => a + b, 0);
    let r = rng() * totalDist;
    let idx = 0;
    for (let i = 0; i < n; i++) {
      r -= dists[i];
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    centroids.push(new Float64Array(vectors[idx]));
  }

  const assignments = new Int32Array(n);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;

    for (let i = 0; i < n; i++) {
      let bestC = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        let d = 0;
        for (let j = 0; j < dim; j++) d += (vectors[i][j] - centroids[c][j]) ** 2;
        if (d < bestD) {
          bestD = d;
          bestC = c;
        }
      }
      if (assignments[i] !== bestC) {
        assignments[i] = bestC;
        changed = true;
      }
    }

    if (!changed) break;

    const counts = new Int32Array(k);
    for (const cent of centroids) cent.fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      counts[c]++;
      for (let j = 0; j < dim; j++) centroids[c][j] += vectors[i][j];
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        for (let j = 0; j < dim; j++) centroids[c][j] /= counts[c];
      }
    }
  }

  return Array.from(assignments);
}

// ─── Stage 1 ────────────────────────────────────────────────────────

export interface Stage1Result {
  clusters: Map<number, number[]>;
  embeddings: Map<number, Float64Array>;
  ideaIds: number[];
  elapsed: number;
}

export async function stage1Embeddings(
  ideas: IdeaRow[],
  embedder: Embedder,
  config: PipelineConfig,
  forceRecompute: boolean,
  db?: Database.Database,
): Promise<Stage1Result> {
  const elapsed = timer();

  let cachedEmbeddings = new Map<number, Float64Array>();

  if (!forceRecompute) {
    cachedEmbeddings = getCachedEmbeddings(embedder.model, db);
  }

  const needCompute = ideas.filter((i) => !cachedEmbeddings.has(i.id));

  console.log(
    `[stage1] ${cachedEmbeddings.size} cached, ${needCompute.length} to compute`,
  );

  if (needCompute.length > 0 || cachedEmbeddings.size === 0) {
    const docs = ideas.map((i) => {
      const content = (i.description || '').slice(0, 500);
      return `${i.title} ${i.category || ''} ${content}`;
    });

    const { vectors } = await embedder.embed(docs);

    const entries = ideas.map((idea, idx) => ({
      id: idea.id,
      vector: vectors[idx],
    }));
    cacheEmbeddings(entries, embedder.model, db);

    cachedEmbeddings.clear();
    for (let i = 0; i < ideas.length; i++) {
      cachedEmbeddings.set(ideas[i].id, vectors[i]);
    }
  }

  const ideaIds = ideas.map((i) => i.id);
  const vecs = ideaIds.map((id) => cachedEmbeddings.get(id)!).filter(Boolean);

  const k = Math.min(config.num_clusters, Math.floor(vecs.length / 3));
  const assignments = kmeans(vecs, Math.max(k, 1));

  const clusters = new Map<number, number[]>();
  for (let i = 0; i < assignments.length; i++) {
    const clusterId = assignments[i];
    const ideaId = ideaIds[i];
    if (!clusters.has(clusterId)) clusters.set(clusterId, []);
    clusters.get(clusterId)!.push(ideaId);
  }

  console.log(`[stage1] ${clusters.size} clusters formed (${elapsed()}ms)`);

  return { clusters, embeddings: cachedEmbeddings, ideaIds, elapsed: elapsed() };
}

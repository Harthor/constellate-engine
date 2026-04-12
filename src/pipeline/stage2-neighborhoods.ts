import type { PipelineConfig } from '../types/index.js';
import { timer } from '../utils/timer.js';

// ─── Vector math ────────────────────────────────────────────────────

function computeCentroid(vectors: Float64Array[]): Float64Array {
  const dim = vectors[0].length;
  const centroid = new Float64Array(dim);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) centroid[i] += v[i];
  }
  for (let i = 0; i < dim; i++) centroid[i] /= vectors.length;
  return centroid;
}

function euclideanDist(a: Float64Array, b: Float64Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += (a[i] - b[i]) ** 2;
  return Math.sqrt(d);
}

function seededRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// ─── Stage 2 ────────────────────────────────────────────────────────

export interface Stage2Result {
  neighborhoods: number[][];
  intraCount: number;
  crossCount: number;
  elapsed: number;
}

export function stage2Neighborhoods(
  clusters: Map<number, number[]>,
  embeddings: Map<number, Float64Array>,
  config: PipelineConfig,
): Stage2Result {
  const elapsed = timer();
  const neighborhoods: number[][] = [];

  // --- Intra-cluster neighborhoods ---
  for (const [, ideaIds] of clusters) {
    if (ideaIds.length <= 30) {
      if (ideaIds.length >= 3) {
        neighborhoods.push(ideaIds);
      }
    } else {
      // Split large clusters by distance to centroid
      const vecs = ideaIds.map((id) => embeddings.get(id)!).filter(Boolean);
      if (vecs.length === 0) continue;
      const centroid = computeCentroid(vecs);

      const withDist = ideaIds
        .map((id) => ({
          id,
          dist: euclideanDist(embeddings.get(id)!, centroid),
        }))
        .sort((a, b) => a.dist - b.dist);

      const chunkSize = 22;
      for (let i = 0; i < withDist.length; i += chunkSize) {
        const chunk = withDist.slice(i, i + chunkSize).map((x) => x.id);
        if (chunk.length >= config.min_neighborhood_size || i === 0) {
          neighborhoods.push(chunk);
        } else if (neighborhoods.length > 0) {
          // Merge small remainder into previous
          const prev = neighborhoods[neighborhoods.length - 1];
          for (const id of chunk) prev.push(id);
        }
      }
    }
  }

  const intraCount = neighborhoods.length;
  console.log(`[stage2] ${intraCount} intra-cluster neighborhoods`);

  // --- Cross-cluster neighborhoods ---
  const clusterCentroids = new Map<number, Float64Array>();
  for (const [cid, ids] of clusters) {
    const vecs = ids.map((id) => embeddings.get(id)!).filter(Boolean);
    if (vecs.length > 0) clusterCentroids.set(cid, computeCentroid(vecs));
  }

  // Find most distant cluster pairs
  const clusterPairDists: Array<{ ci: number; cj: number; dist: number }> = [];
  const cids = Array.from(clusterCentroids.keys());
  for (let i = 0; i < cids.length; i++) {
    for (let j = i + 1; j < cids.length; j++) {
      const d = euclideanDist(
        clusterCentroids.get(cids[i])!,
        clusterCentroids.get(cids[j])!,
      );
      clusterPairDists.push({ ci: cids[i], cj: cids[j], dist: d });
    }
  }
  clusterPairDists.sort((a, b) => b.dist - a.dist);

  const rng = seededRng(777);
  let crossCount = 0;
  const maxCross = config.max_cross_cluster_neighborhoods;

  for (const { ci, cj } of clusterPairDists) {
    if (crossCount >= maxCross) break;

    const idsA = clusters.get(ci)!;
    const idsB = clusters.get(cj)!;

    const sampleSize = Math.min(4, idsA.length, idsB.length);
    if (sampleSize < 3) continue;

    const sampleA: number[] = [];
    const usedA = new Set<number>();
    while (sampleA.length < sampleSize && sampleA.length < idsA.length) {
      const idx = Math.floor(rng() * idsA.length);
      if (!usedA.has(idx)) {
        usedA.add(idx);
        sampleA.push(idsA[idx]);
      }
    }

    const sampleB: number[] = [];
    const usedB = new Set<number>();
    while (sampleB.length < sampleSize && sampleB.length < idsB.length) {
      const idx = Math.floor(rng() * idsB.length);
      if (!usedB.has(idx)) {
        usedB.add(idx);
        sampleB.push(idsB[idx]);
      }
    }

    neighborhoods.push([...sampleA, ...sampleB]);
    crossCount++;
  }

  console.log(`[stage2] ${crossCount} cross-cluster neighborhoods`);

  // Cap total
  let finalNeighborhoods = neighborhoods;
  if (finalNeighborhoods.length > config.max_total_neighborhoods) {
    const intra = finalNeighborhoods.slice(0, intraCount);
    const cross = finalNeighborhoods.slice(intraCount);
    const maxIntra = config.max_total_neighborhoods - cross.length;

    const sampledIntra: number[][] = [];
    const step = Math.max(1, Math.floor(intra.length / maxIntra));
    for (let i = 0; i < intra.length && sampledIntra.length < maxIntra; i += step) {
      sampledIntra.push(intra[i]);
    }

    finalNeighborhoods = [...sampledIntra, ...cross];
    console.log(
      `[stage2] Capped to ${finalNeighborhoods.length} total (${sampledIntra.length} intra + ${cross.length} cross)`,
    );
  }

  console.log(
    `[stage2] Total: ${finalNeighborhoods.length} neighborhoods (${elapsed()}ms)`,
  );

  return {
    neighborhoods: finalNeighborhoods,
    intraCount: Math.min(intraCount, finalNeighborhoods.length - crossCount),
    crossCount,
    elapsed: elapsed(),
  };
}

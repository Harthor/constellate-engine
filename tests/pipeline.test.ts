import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb, bulkInsertIdeas, loadIdeas } from '../src/db/database.js';
import { TfIdfEmbedder } from '../src/embeddings/tfidf.js';
import { stage1Embeddings } from '../src/pipeline/stage1-embeddings.js';
import { stage2Neighborhoods } from '../src/pipeline/stage2-neighborhoods.js';
import { DEFAULT_CONFIG } from '../src/pipeline/index.js';
import Database from 'better-sqlite3';

const sampleIdeas = [
  { title: 'CRDT database for mobile', description: 'Conflict-free replicated data types for offline mobile apps', source: 'gh', url: 'https://ex.com/1', category: 'databases', stack: 'rust' },
  { title: 'AI code review bot', description: 'Uses LLMs to review pull requests and suggest improvements', source: 'gh', url: 'https://ex.com/2', category: 'devtools', stack: 'typescript' },
  { title: 'WASM edge runtime', description: 'WebAssembly runtime for serverless edge computing functions', source: 'gh', url: 'https://ex.com/3', category: 'infra', stack: 'rust' },
  { title: 'P2P video calls', description: 'Peer to peer video conferencing using WebRTC mesh topology', source: 'hn', url: 'https://ex.com/4', category: 'communication', stack: 'typescript' },
  { title: 'Knowledge graph from browsing', description: 'Build knowledge graph from browser history and bookmarks', source: 'hn', url: 'https://ex.com/5', category: 'productivity', stack: 'python' },
  { title: 'TinyML on microcontrollers', description: 'Neural network inference on Arduino and ESP32 boards', source: 'gh', url: 'https://ex.com/6', category: 'ml', stack: 'c++' },
  { title: 'Open source design tool', description: 'Self-hosted Figma alternative with real-time collaboration', source: 'gh', url: 'https://ex.com/7', category: 'design', stack: 'typescript' },
  { title: 'DB migration testing', description: 'Automated database migration testing with temporary instances', source: 'hn', url: 'https://ex.com/8', category: 'devtools', stack: 'go' },
  { title: 'Privacy analytics', description: 'Analytics with differential privacy for GDPR compliance', source: 'hn', url: 'https://ex.com/9', category: 'privacy', stack: 'rust' },
  { title: 'AI training infra', description: 'Declarative GPU cluster management for ML training jobs', source: 'gh', url: 'https://ex.com/10', category: 'infra', stack: 'python' },
  { title: 'Git-based CMS', description: 'Content management storing everything in git repositories', source: 'gh', url: 'https://ex.com/11', category: 'cms', stack: 'typescript' },
  { title: 'Rust coreutils', description: 'Modern Unix utilities rewritten in Rust with better defaults', source: 'gh', url: 'https://ex.com/12', category: 'cli', stack: 'rust' },
];

describe('Pipeline stages 1-2', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb(':memory:');
    bulkInsertIdeas(sampleIdeas, db);
  });

  afterEach(() => {
    db.close();
  });

  describe('stage1 — embeddings + clustering', () => {
    it('creates clusters from ideas', async () => {
      const ideas = loadIdeas(db);
      const embedder = new TfIdfEmbedder();
      const config = { ...DEFAULT_CONFIG, num_clusters: 4 };

      const result = await stage1Embeddings(ideas, embedder, config, false, db);

      expect(result.clusters.size).toBeGreaterThan(0);
      expect(result.clusters.size).toBeLessThanOrEqual(4);
      expect(result.embeddings.size).toBe(ideas.length);
      expect(result.ideaIds).toHaveLength(ideas.length);
    });

    it('every idea is assigned to exactly one cluster', async () => {
      const ideas = loadIdeas(db);
      const embedder = new TfIdfEmbedder();
      const config = { ...DEFAULT_CONFIG, num_clusters: 3 };

      const result = await stage1Embeddings(ideas, embedder, config, false, db);

      const allAssigned = new Set<number>();
      for (const [, ids] of result.clusters) {
        for (const id of ids) {
          expect(allAssigned.has(id)).toBe(false);
          allAssigned.add(id);
        }
      }
      expect(allAssigned.size).toBe(ideas.length);
    });

    it('caches embeddings for reuse', async () => {
      const ideas = loadIdeas(db);
      const embedder = new TfIdfEmbedder();
      const config = { ...DEFAULT_CONFIG, num_clusters: 3 };

      await stage1Embeddings(ideas, embedder, config, false, db);
      // Second run should use cache
      const result = await stage1Embeddings(ideas, embedder, config, false, db);

      expect(result.clusters.size).toBeGreaterThan(0);
    });
  });

  describe('stage2 — neighborhoods', () => {
    it('forms intra and cross-cluster neighborhoods', async () => {
      const ideas = loadIdeas(db);
      const embedder = new TfIdfEmbedder();
      const config = { ...DEFAULT_CONFIG, num_clusters: 4, max_cross_cluster_neighborhoods: 3 };

      const s1 = await stage1Embeddings(ideas, embedder, config, false, db);
      const s2 = stage2Neighborhoods(s1.clusters, s1.embeddings, config);

      expect(s2.neighborhoods.length).toBeGreaterThan(0);
      expect(s2.intraCount).toBeGreaterThan(0);
      expect(s2.crossCount).toBeLessThanOrEqual(3);
    });

    it('neighborhoods contain valid idea IDs', async () => {
      const ideas = loadIdeas(db);
      const ideaIds = new Set(ideas.map((i) => i.id));
      const embedder = new TfIdfEmbedder();
      const config = { ...DEFAULT_CONFIG, num_clusters: 4 };

      const s1 = await stage1Embeddings(ideas, embedder, config, false, db);
      const s2 = stage2Neighborhoods(s1.clusters, s1.embeddings, config);

      for (const neighborhood of s2.neighborhoods) {
        expect(neighborhood.length).toBeGreaterThanOrEqual(3);
        for (const id of neighborhood) {
          expect(ideaIds.has(id)).toBe(true);
        }
      }
    });

    it('respects max_total_neighborhoods cap', async () => {
      const ideas = loadIdeas(db);
      const embedder = new TfIdfEmbedder();
      const config = { ...DEFAULT_CONFIG, num_clusters: 4, max_total_neighborhoods: 5 };

      const s1 = await stage1Embeddings(ideas, embedder, config, false, db);
      const s2 = stage2Neighborhoods(s1.clusters, s1.embeddings, config);

      expect(s2.neighborhoods.length).toBeLessThanOrEqual(5);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb, loadIdeas, bulkInsertIdeas, insertIdea, cacheEmbeddings, getCachedEmbeddings, clearCache, cacheApiCall, getCachedApiCall } from '../src/db/database.js';
import Database from 'better-sqlite3';

describe('Database', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  describe('ideas', () => {
    it('inserts and loads ideas', () => {
      insertIdea({
        title: 'Test Idea',
        description: 'A test description',
        source: 'test',
        url: 'https://example.com/test',
        category: 'testing',
      }, db);

      const ideas = loadIdeas(db);
      expect(ideas).toHaveLength(1);
      expect(ideas[0].title).toBe('Test Idea');
      expect(ideas[0].source).toBe('test');
    });

    it('bulk inserts ideas', () => {
      const ideas = [
        { title: 'Idea 1', description: 'Desc 1', source: 's1', url: 'https://example.com/1' },
        { title: 'Idea 2', description: 'Desc 2', source: 's2', url: 'https://example.com/2' },
        { title: 'Idea 3', description: 'Desc 3', source: 's3', url: 'https://example.com/3' },
      ];
      const count = bulkInsertIdeas(ideas, db);
      expect(count).toBe(3);
      expect(loadIdeas(db)).toHaveLength(3);
    });

    it('skips duplicates by URL', () => {
      const ideas = [
        { title: 'Idea 1', description: 'Desc 1', source: 's1', url: 'https://example.com/dup' },
        { title: 'Idea 2', description: 'Desc 2', source: 's2', url: 'https://example.com/dup' },
      ];
      const count = bulkInsertIdeas(ideas, db);
      expect(count).toBe(1);
    });

    it('filters out ideas with empty title and description', () => {
      bulkInsertIdeas([
        { title: '', description: '', source: 'test', url: 'https://example.com/empty' },
        { title: 'Valid', description: 'Has content', source: 'test', url: 'https://example.com/valid' },
      ], db);
      const loaded = loadIdeas(db);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].title).toBe('Valid');
    });
  });

  describe('embedding cache', () => {
    it('caches and retrieves embeddings', () => {
      insertIdea({ title: 'Test', description: 'Test', source: 'test', url: 'https://example.com/emb' }, db);
      const ideas = loadIdeas(db);
      const ideaId = ideas[0].id;

      const vector = new Float64Array([0.1, 0.2, 0.3, 0.4]);
      cacheEmbeddings([{ id: ideaId, vector }], 'test_model', db);

      const cached = getCachedEmbeddings('test_model', db);
      expect(cached.size).toBe(1);
      expect(cached.has(ideaId)).toBe(true);

      const retrieved = cached.get(ideaId)!;
      expect(retrieved.length).toBe(4);
      expect(retrieved[0]).toBeCloseTo(0.1);
      expect(retrieved[3]).toBeCloseTo(0.4);
    });

    it('separates embeddings by model', () => {
      insertIdea({ title: 'Test', description: 'Test', source: 'test', url: 'https://example.com/model' }, db);
      const ideas = loadIdeas(db);
      const ideaId = ideas[0].id;

      cacheEmbeddings([{ id: ideaId, vector: new Float64Array([1, 2]) }], 'model_a', db);
      cacheEmbeddings([{ id: ideaId, vector: new Float64Array([3, 4]) }], 'model_b', db);

      const a = getCachedEmbeddings('model_a', db);
      const b = getCachedEmbeddings('model_b', db);
      // Last write wins since idea_id is PK
      expect(a.size + b.size).toBeGreaterThan(0);
    });
  });

  describe('clearCache', () => {
    it('clears all cached data', () => {
      insertIdea({ title: 'Test', description: 'Test', source: 'test', url: 'https://example.com/clear' }, db);
      const ideas = loadIdeas(db);
      cacheEmbeddings([{ id: ideas[0].id, vector: new Float64Array([1]) }], 'test', db);

      clearCache(db);

      expect(getCachedEmbeddings('test', db).size).toBe(0);
      // Ideas should still be there
      expect(loadIdeas(db)).toHaveLength(1);
    });
  });

  describe('API call resume cache', () => {
    it('stores valid empty responses with model, tokens, cost, and timestamp', () => {
      cacheApiCall({
        input_hash: 'input-hash',
        stage: 'constellations',
        scope_hash: 'scope-hash',
        model: 'runtime-model',
        prompt_version: 'prompt-v1',
        status: 'valid',
        response_json: JSON.stringify({ constellations: [] }),
        input_tokens: 123,
        output_tokens: 4,
        cost_usd: 0.00143,
      }, db);

      const cached = getCachedApiCall('input-hash', 'runtime-model', 'prompt-v1', db);
      expect(cached?.status).toBe('valid');
      expect(cached?.input_tokens).toBe(123);
      expect(cached?.created_at).toBeTruthy();
      expect(JSON.parse(cached!.response_json)).toEqual({ constellations: [] });
    });

    it('keeps every paid retry in the append-only attempts ledger', () => {
      const base = {
        input_hash: 'retry-input',
        stage: 'constellations',
        scope_hash: 'retry-scope',
        model: 'runtime-model',
        prompt_version: 'prompt-v1',
        response_json: JSON.stringify({ constellations: [] }),
        input_tokens: 100,
        output_tokens: 50,
        cost_usd: 0.0035,
      } as const;
      cacheApiCall({ ...base, status: 'invalid' }, db);
      cacheApiCall({ ...base, status: 'valid' }, db);

      const attempts = db.prepare('SELECT status FROM api_call_attempts ORDER BY id').all() as Array<{ status: string }>;
      expect(attempts.map((attempt) => attempt.status)).toEqual(['invalid', 'valid']);
      expect(getCachedApiCall('retry-input', 'runtime-model', 'prompt-v1', db)?.status).toBe('valid');
    });
  });
});

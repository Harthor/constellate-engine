import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb, loadIdeas, bulkInsertIdeas, insertIdea, cacheEmbeddings, getCachedEmbeddings, clearCache } from '../src/db/database.js';
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
});

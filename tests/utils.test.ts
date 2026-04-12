import { describe, it, expect } from 'vitest';
import { hashIds } from '../src/utils/hash.js';
import { timer } from '../src/utils/timer.js';
import { pLimit } from '../src/utils/concurrency.js';
import { CostTracker } from '../src/utils/cost-tracker.js';

describe('hashIds', () => {
  it('produces consistent hash for same ids', () => {
    expect(hashIds([1, 2, 3])).toBe(hashIds([1, 2, 3]));
  });

  it('is order-independent', () => {
    expect(hashIds([3, 1, 2])).toBe(hashIds([1, 2, 3]));
  });

  it('different ids produce different hashes', () => {
    expect(hashIds([1, 2, 3])).not.toBe(hashIds([4, 5, 6]));
  });

  it('returns 64-char hex string', () => {
    const hash = hashIds([1, 2]);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('timer', () => {
  it('returns elapsed milliseconds', async () => {
    const elapsed = timer();
    await new Promise((r) => setTimeout(r, 50));
    const ms = elapsed();
    expect(ms).toBeGreaterThanOrEqual(40);
    expect(ms).toBeLessThan(200);
  });
});

describe('pLimit', () => {
  it('limits concurrency', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const limit = pLimit(2);

    const task = () =>
      limit(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 50));
        concurrent--;
      });

    await Promise.all([task(), task(), task(), task(), task()]);

    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(concurrent).toBe(0);
  });

  it('returns values from tasks', async () => {
    const limit = pLimit(3);
    const results = await Promise.all([
      limit(() => Promise.resolve(1)),
      limit(() => Promise.resolve(2)),
      limit(() => Promise.resolve(3)),
    ]);
    expect(results).toEqual([1, 2, 3]);
  });

  it('propagates errors', async () => {
    const limit = pLimit(1);
    await expect(limit(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
  });
});

describe('CostTracker', () => {
  it('tracks total cost', () => {
    const tracker = new CostTracker();
    // Haiku: $0.80/M input, $4.00/M output
    tracker.record('claude-haiku-4-5-20251001', 1_000_000, 100_000, 'test');

    const cost = tracker.totalCost();
    // 1M input * 0.80/M + 100K output * 4.00/M = 0.80 + 0.40 = 1.20
    expect(cost).toBeCloseTo(1.20, 2);
  });

  it('tracks cost by stage', () => {
    const tracker = new CostTracker();
    tracker.record('claude-haiku-4-5-20251001', 500_000, 50_000, 'constellations');
    tracker.record('claude-haiku-4-5-20251001', 200_000, 20_000, 'patterns');

    const byStage = tracker.costByStage();
    expect(byStage['constellations']).toBeGreaterThan(0);
    expect(byStage['patterns']).toBeGreaterThan(0);
    expect(byStage['constellations']).toBeGreaterThan(byStage['patterns']);
  });

  it('handles unknown models gracefully', () => {
    const tracker = new CostTracker();
    tracker.record('unknown-model', 1000, 1000, 'test');
    expect(tracker.totalCost()).toBe(0);
  });
});

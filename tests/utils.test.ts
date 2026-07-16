import { describe, it, expect } from 'vitest';
import { hashIds } from '../src/utils/hash.js';
import { timer } from '../src/utils/timer.js';
import { pLimit } from '../src/utils/concurrency.js';
import { CostTracker } from '../src/utils/cost-tracker.js';
import { ApiBudget, PipelineLimitError } from '../src/utils/api-budget.js';

const pricing = { input_per_million: 10, output_per_million: 50 };

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
    const tracker = new CostTracker(pricing);
    tracker.record('configured-model', 1_000_000, 100_000, 'test');

    const cost = tracker.totalCost();
    expect(cost).toBeCloseTo(15, 2);
  });

  it('tracks cost by stage', () => {
    const tracker = new CostTracker(pricing);
    tracker.record('configured-model', 500_000, 50_000, 'constellations');
    tracker.record('configured-model', 200_000, 20_000, 'patterns');

    const byStage = tracker.costByStage();
    expect(byStage['constellations']).toBeGreaterThan(0);
    expect(byStage['patterns']).toBeGreaterThan(0);
    expect(byStage['constellations']).toBeGreaterThan(byStage['patterns']);
  });

  it('uses centralized configured pricing for any selected model id', () => {
    const tracker = new CostTracker(pricing);
    tracker.record('runtime-model', 1000, 1000, 'test');
    expect(tracker.totalCost()).toBeCloseTo(0.06, 6);
  });
});

describe('ApiBudget', () => {
  it('enforces the maximum call count', () => {
    const budget = new ApiBudget(1, 1, pricing);
    const reservation = budget.reserve(100, 100);
    budget.recordSuccess(reservation, 50, 50);
    expect(() => budget.reserve(100, 100)).toThrow(PipelineLimitError);
  });

  it('rejects a call whose theoretical maximum exceeds the remaining budget', () => {
    const budget = new ApiBudget(10, 0.01, pricing);
    expect(() => budget.reserve(1_000, 1_000)).toThrow(/could exceed/);
    expect(budget.calls).toBe(0);
  });
});

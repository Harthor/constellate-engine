import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, isDryRunConfig, loadPipelineConfig } from '../src/config.js';

describe('pipeline configuration', () => {
  it('defaults to Fable 5 with zero spend and one concurrent request', () => {
    const config = loadPipelineConfig({});
    expect(config.model).toBe(DEFAULT_MODEL);
    expect(config.max_budget_usd).toBe(0);
    expect(config.max_calls).toBe(0);
    expect(config.concurrency).toBe(1);
    expect(config.effort).toBe('low');
    expect(isDryRunConfig(config)).toBe(true);
  });

  it('reads all Anthropic controls from their centralized environment names', () => {
    const config = loadPipelineConfig({
      ANTHROPIC_MODEL: 'configured-at-runtime',
      ANTHROPIC_MAX_OUTPUT_TOKENS: '512',
      ANTHROPIC_EFFORT: 'medium',
      ANTHROPIC_MAX_BUDGET_USD: '0.25',
      ANTHROPIC_MAX_CALLS: '2',
      ANTHROPIC_CONCURRENCY: '1',
      ANTHROPIC_INPUT_USD_PER_MILLION: '10',
      ANTHROPIC_OUTPUT_USD_PER_MILLION: '50',
    });
    expect(config.model).toBe('configured-at-runtime');
    expect(config.max_output_tokens).toBe(512);
    expect(config.effort).toBe('medium');
    expect(config.max_budget_usd).toBe(0.25);
    expect(config.max_calls).toBe(2);
    expect(isDryRunConfig(config)).toBe(false);
  });

  it('defaults the corpus window to seven days', () => {
    expect(loadPipelineConfig({}).corpus_window_days).toBe(7);
  });

  it('reads the corpus window from the environment', () => {
    expect(loadPipelineConfig({ CORPUS_WINDOW_DAYS: '14' }).corpus_window_days).toBe(14);
  });

  it('accepts zero to disable the window', () => {
    expect(loadPipelineConfig({ CORPUS_WINDOW_DAYS: '0' }).corpus_window_days).toBe(0);
  });

  it('rejects a negative corpus window', () => {
    expect(() => loadPipelineConfig({ CORPUS_WINDOW_DAYS: '-1' })).toThrow(
      /CORPUS_WINDOW_DAYS/,
    );
  });

  it('lets an explicit override beat the environment', () => {
    const config = loadPipelineConfig({ CORPUS_WINDOW_DAYS: '14' }, { corpus_window_days: 3 });
    expect(config.corpus_window_days).toBe(3);
  });
});

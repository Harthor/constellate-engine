import type { PipelineConfig } from './types/index.js';

export const DEFAULT_MODEL = 'claude-fable-5';

export const DEFAULT_CONFIG: PipelineConfig = {
  num_clusters: 30,
  max_neighborhood_size: 30,
  min_neighborhood_size: 20,
  max_cross_cluster_neighborhoods: 10,
  max_total_neighborhoods: 50,
  model: DEFAULT_MODEL,
  min_constellation_score: 6,
  max_output_tokens: 1024,
  effort: 'low',
  max_budget_usd: 0,
  max_calls: 0,
  concurrency: 1,
  input_usd_per_million: 10,
  output_usd_per_million: 50,
};

type Environment = Record<string, string | undefined>;

function numberFromEnv(
  env: Environment,
  name: string,
  fallback: number,
  minimum: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`${name} must be a finite number >= ${minimum}.`);
  }
  return value;
}

export function loadPipelineConfig(
  env: Environment = process.env,
  overrides: Partial<PipelineConfig> = {},
): PipelineConfig {
  const fromEnvironment: PipelineConfig = {
    ...DEFAULT_CONFIG,
    model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_CONFIG.model,
    max_output_tokens: Math.floor(
      numberFromEnv(env, 'ANTHROPIC_MAX_OUTPUT_TOKENS', DEFAULT_CONFIG.max_output_tokens, 1),
    ),
    effort: (env.ANTHROPIC_EFFORT?.trim() || DEFAULT_CONFIG.effort) as PipelineConfig['effort'],
    max_budget_usd: numberFromEnv(
      env,
      'ANTHROPIC_MAX_BUDGET_USD',
      DEFAULT_CONFIG.max_budget_usd,
      0,
    ),
    max_calls: Math.floor(
      numberFromEnv(env, 'ANTHROPIC_MAX_CALLS', DEFAULT_CONFIG.max_calls, 0),
    ),
    concurrency: Math.floor(
      numberFromEnv(env, 'ANTHROPIC_CONCURRENCY', DEFAULT_CONFIG.concurrency, 1),
    ),
    input_usd_per_million: numberFromEnv(
      env,
      'ANTHROPIC_INPUT_USD_PER_MILLION',
      DEFAULT_CONFIG.input_usd_per_million,
      0,
    ),
    output_usd_per_million: numberFromEnv(
      env,
      'ANTHROPIC_OUTPUT_USD_PER_MILLION',
      DEFAULT_CONFIG.output_usd_per_million,
      0,
    ),
  };

  const config = { ...fromEnvironment, ...overrides };
  if (!config.model.trim()) throw new Error('ANTHROPIC_MODEL cannot be empty.');
  if (!Number.isInteger(config.max_calls) || config.max_calls < 0) {
    throw new Error('ANTHROPIC_MAX_CALLS must be a non-negative integer.');
  }
  if (!Number.isInteger(config.concurrency) || config.concurrency < 1) {
    throw new Error('ANTHROPIC_CONCURRENCY must be an integer >= 1.');
  }
  if (!Number.isInteger(config.max_output_tokens) || config.max_output_tokens < 1) {
    throw new Error('ANTHROPIC_MAX_OUTPUT_TOKENS must be an integer >= 1.');
  }
  if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(config.effort)) {
    throw new Error('ANTHROPIC_EFFORT must be low, medium, high, xhigh, or max.');
  }
  return config;
}

export function isDryRunConfig(config: PipelineConfig): boolean {
  return config.max_budget_usd === 0 || config.max_calls === 0;
}

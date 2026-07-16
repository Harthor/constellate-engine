import type { ModelPricing } from '../types/index.js';

export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing,
): number {
  return (
    (inputTokens / 1_000_000) * pricing.input_per_million +
    (outputTokens / 1_000_000) * pricing.output_per_million
  );
}

export class CostTracker {
  constructor(private readonly pricing: ModelPricing) {}

  private entries: Array<{
    model: string;
    input_tokens: number;
    output_tokens: number;
    stage: string;
  }> = [];

  record(model: string, input_tokens: number, output_tokens: number, stage: string): void {
    this.entries.push({ model, input_tokens, output_tokens, stage });
  }

  totalCost(): number {
    let total = 0;
    for (const e of this.entries) {
      total += calculateCost(e.input_tokens, e.output_tokens, this.pricing);
    }
    return total;
  }

  costByStage(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const e of this.entries) {
      const cost = calculateCost(e.input_tokens, e.output_tokens, this.pricing);
      result[e.stage] = (result[e.stage] || 0) + cost;
    }
    return result;
  }

  tokensByStage(): Record<string, { input: number; output: number }> {
    const result: Record<string, { input: number; output: number }> = {};
    for (const e of this.entries) {
      if (!result[e.stage]) result[e.stage] = { input: 0, output: 0 };
      result[e.stage].input += e.input_tokens;
      result[e.stage].output += e.output_tokens;
    }
    return result;
  }
}

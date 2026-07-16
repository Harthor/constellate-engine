import Anthropic from '@anthropic-ai/sdk';
import type { PipelineConfig } from '../types/index.js';
import type { AiJob } from './inputs.js';
import { ApiBudget } from '../utils/api-budget.js';
import { CostTracker } from '../utils/cost-tracker.js';
import { withRetry } from '../utils/retry.js';

export interface AiCallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  stopReason: string | null;
}

export async function executeAiJob(
  job: AiJob,
  client: Anthropic,
  config: PipelineConfig,
  budget: ApiBudget,
  costTracker: CostTracker,
): Promise<AiCallResult> {
  return withRetry(async () => {
    const reservation = budget.reserve(job.maximumInputTokens, config.max_output_tokens);
    try {
      const message = await client.messages.create({
        model: job.model,
        max_tokens: config.max_output_tokens,
        output_config: { effort: config.effort },
        system: job.system,
        messages: [{ role: 'user', content: job.prompt }],
      });
      const inputTokens = message.usage?.input_tokens || 0;
      const outputTokens = message.usage?.output_tokens || 0;
      const costUsd = budget.recordSuccess(reservation, inputTokens, outputTokens);
      costTracker.record(job.model, inputTokens, outputTokens, job.stage);
      const text = message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();
      return {
        text,
        inputTokens,
        outputTokens,
        costUsd,
        stopReason: (message as unknown as { stop_reason?: string }).stop_reason ?? null,
      };
    } catch (error) {
      budget.recordFailure(reservation);
      throw error;
    }
  }, 2);
}

import type { PipelineConfig } from '../types/index.js';
import type { IdeaRow } from '../db/database.js';
import {
  CONSTELLATION_DISCOVERY_SYSTEM,
  CONSTELLATION_DISCOVERY_VERSION,
  constellationDiscoveryPrompt,
} from '../prompts/constellation-discovery.js';
import {
  EMERGENT_PATTERNS_SYSTEM,
  EMERGENT_PATTERNS_VERSION,
  emergentPatternsPrompt,
} from '../prompts/emergent-patterns.js';
import { hashIds, hashText } from '../utils/hash.js';

export type AiStage = 'constellations' | 'patterns';

export interface AiJob {
  stage: AiStage;
  scopeHash: string;
  inputHash: string;
  ideaIds: number[];
  system: string;
  prompt: string;
  promptVersion: string;
  model: string;
  estimatedInputTokens: number;
  maximumInputTokens: number;
}

function withTokenEstimates(job: Omit<AiJob, 'estimatedInputTokens' | 'maximumInputTokens'>): AiJob {
  const input = `${job.system}\n${job.prompt}`;
  return {
    ...job,
    // Fable 5 uses a newer tokenizer. Three characters/token is deliberately
    // conservative for expected-cost reporting; bytes + overhead is the hard
    // reservation used before a paid call.
    estimatedInputTokens: Math.ceil(input.length / 3),
    maximumInputTokens: Buffer.byteLength(input, 'utf8') + 256,
  };
}

export function buildConstellationJobs(
  neighborhoods: number[][],
  ideas: Map<number, IdeaRow>,
  config: PipelineConfig,
): AiJob[] {
  const seen = new Set<string>();
  const jobs: AiJob[] = [];

  for (const neighborhood of neighborhoods) {
    const ideaIds = Array.from(new Set(neighborhood)).sort((a, b) => a - b);
    const scopeHash = hashIds(ideaIds);
    if (seen.has(scopeHash)) continue;
    seen.add(scopeHash);

    const ideasText = ideaIds
      .map((id) => {
        const idea = ideas.get(id);
        if (!idea) return null;
        const desc = (idea.description || '').slice(0, 300);
        return `[ID:${id}] "${idea.title}" (${idea.source}, ${idea.category || 'uncategorized'}): ${desc}`;
      })
      .filter((line): line is string => line !== null)
      .join('\n');
    const prompt = constellationDiscoveryPrompt(ideasText, ideaIds.length);
    const inputHash = hashText(
      [config.model, config.effort, CONSTELLATION_DISCOVERY_VERSION, CONSTELLATION_DISCOVERY_SYSTEM, prompt].join('\n'),
    );
    jobs.push(
      withTokenEstimates({
        stage: 'constellations',
        scopeHash,
        inputHash,
        ideaIds,
        system: CONSTELLATION_DISCOVERY_SYSTEM,
        prompt,
        promptVersion: CONSTELLATION_DISCOVERY_VERSION,
        model: config.model,
      }),
    );
  }
  return jobs;
}

export function buildPatternJobs(
  clusters: Map<number, number[]>,
  ideas: Map<number, IdeaRow>,
  config: PipelineConfig,
): AiJob[] {
  const jobs: AiJob[] = [];
  for (const [, rawIdeaIds] of clusters) {
    const ideaIds = Array.from(new Set(rawIdeaIds)).sort((a, b) => a - b);
    if (ideaIds.length < 3) continue;
    const scopeHash = hashIds(ideaIds);
    const ideasText = ideaIds
      .map((id) => ideas.get(id))
      .filter((idea): idea is IdeaRow => Boolean(idea))
      .map((idea) => {
        const desc = (idea.description || '').slice(0, 200);
        return `[ID:${idea.id}] "${idea.title}" (${idea.source}, ${idea.category || 'uncategorized'}): ${desc}`;
      })
      .join('\n');
    const prompt = emergentPatternsPrompt(ideasText);
    const inputHash = hashText(
      [config.model, config.effort, EMERGENT_PATTERNS_VERSION, EMERGENT_PATTERNS_SYSTEM, prompt].join('\n'),
    );
    jobs.push(
      withTokenEstimates({
        stage: 'patterns',
        scopeHash,
        inputHash,
        ideaIds,
        system: EMERGENT_PATTERNS_SYSTEM,
        prompt,
        promptVersion: EMERGENT_PATTERNS_VERSION,
        model: config.model,
      }),
    );
  }
  return jobs;
}

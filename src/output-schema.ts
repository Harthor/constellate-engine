import type { PipelineResult } from './types/index.js';

export type OutputValidationResult =
  | { success: true; data: PipelineResult }
  | { success: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validatePipelineResult(value: unknown): OutputValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { success: false, errors: ['root must be an object'] };
  if (!Array.isArray(value.constellations)) errors.push('constellations must be an array');
  if (!Array.isArray(value.patterns)) errors.push('patterns must be an array');
  if (!isRecord(value.ideas)) errors.push('ideas must be an object');
  if (!isRecord(value.metadata)) errors.push('metadata must be an object');

  const ideaIds = new Set<number>();
  if (isRecord(value.ideas)) {
    for (const [rawId, rawIdea] of Object.entries(value.ideas)) {
      const id = Number(rawId);
      if (!Number.isInteger(id) || id < 0) {
        errors.push(`ideas.${rawId} has an invalid numeric key`);
        continue;
      }
      ideaIds.add(id);
      if (!isRecord(rawIdea)) {
        errors.push(`ideas.${rawId} must be an object`);
        continue;
      }
      for (const key of ['title', 'source', 'url', 'category', 'description']) {
        if (typeof rawIdea[key] !== 'string') errors.push(`ideas.${rawId}.${key} must be a string`);
      }
    }
  }

  const validateReferences = (rawIds: unknown, path: string) => {
    if (!Array.isArray(rawIds)) {
      errors.push(`${path} must be an array`);
      return;
    }
    for (const id of rawIds) {
      if (!Number.isInteger(id) || !ideaIds.has(id as number)) {
        errors.push(`${path} references a missing idea`);
      }
    }
  };

  if (Array.isArray(value.constellations)) {
    value.constellations.forEach((raw, index) => {
      if (!isRecord(raw)) {
        errors.push(`constellations[${index}] must be an object`);
        return;
      }
      for (const key of ['neighborhood_hash', 'constellation_type', 'title', 'explanation', 'model', 'prompt_version']) {
        if (typeof raw[key] !== 'string') errors.push(`constellations[${index}].${key} must be a string`);
      }
      if (!finite(raw.score)) errors.push(`constellations[${index}].score must be a number`);
      validateReferences(raw.idea_ids, `constellations[${index}].idea_ids`);
    });
  }

  if (Array.isArray(value.patterns)) {
    value.patterns.forEach((raw, index) => {
      if (!isRecord(raw)) {
        errors.push(`patterns[${index}] must be an object`);
        return;
      }
      for (const key of ['cluster_hash', 'pattern_title', 'pattern_description', 'model', 'prompt_version']) {
        if (typeof raw[key] !== 'string') errors.push(`patterns[${index}].${key} must be a string`);
      }
      validateReferences(raw.idea_ids, `patterns[${index}].idea_ids`);
    });
  }

  if (isRecord(value.metadata)) {
    if (
      value.metadata.generated_at !== undefined &&
      (typeof value.metadata.generated_at !== 'string' ||
        Number.isNaN(Date.parse(value.metadata.generated_at)))
    ) {
      errors.push('metadata.generated_at must be an ISO-8601 timestamp');
    }
    for (const key of [
      'total_ideas',
      'neighborhoods_intra',
      'neighborhoods_cross',
      'neighborhoods_total',
      'constellations_found',
      'constellation_cache_hits',
      'constellation_api_calls',
      'pattern_cache_hits',
      'pattern_api_calls',
      'estimated_cost_usd',
      'elapsed_ms',
    ]) {
      if (!finite(value.metadata[key])) errors.push(`metadata.${key} must be a number`);
    }
    for (const key of ['constellation_failed_skips', 'pattern_failed_skips']) {
      if (value.metadata[key] !== undefined && !finite(value.metadata[key])) {
        errors.push(`metadata.${key} must be a number`);
      }
    }
    if (!isRecord(value.metadata.constellations_by_type)) {
      errors.push('metadata.constellations_by_type must be an object');
    }
  }

  return errors.length > 0
    ? { success: false, errors }
    : { success: true, data: value as unknown as PipelineResult };
}

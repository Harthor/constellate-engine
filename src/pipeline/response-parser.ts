import { CONSTELLATION_TYPES, type ConstellationType } from '../types/index.js';

export interface ConstellationCandidate {
  type: ConstellationType;
  idea_ids: number[];
  title: string;
  explanation: string;
  score: number;
  actionability?: number;
}

export interface PatternCandidate {
  name: string;
  idea_ids: number[];
  explanation: string;
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('Provider response did not contain a JSON object.');
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateIdeaIds(value: unknown, allowed: Set<number>, path: string): number[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  const ids = Array.from(new Set(value));
  if (!ids.every((id) => Number.isInteger(id) && allowed.has(id as number))) {
    throw new Error(`${path} contains an invalid or out-of-scope idea ID.`);
  }
  return ids as number[];
}

export function parseConstellationResponse(
  response: string | unknown,
  allowedIdeaIds: number[],
): { constellations: ConstellationCandidate[] } {
  const value = typeof response === 'string' ? parseJsonObject(response) : response;
  if (!isRecord(value) || !Array.isArray(value.constellations)) {
    throw new Error('Provider response must contain a constellations array.');
  }

  const allowed = new Set(allowedIdeaIds);
  const constellations = value.constellations.map((item, index) => {
    if (!isRecord(item)) throw new Error(`constellations[${index}] must be an object.`);
    if (!CONSTELLATION_TYPES.includes(item.type as ConstellationType)) {
      throw new Error(`constellations[${index}].type is invalid.`);
    }
    const ideaIds = validateIdeaIds(item.idea_ids, allowed, `constellations[${index}].idea_ids`);
    if (ideaIds.length < 3 || ideaIds.length > 6) {
      throw new Error(`constellations[${index}].idea_ids must contain 3-6 unique IDs.`);
    }
    if (typeof item.title !== 'string' || item.title.trim() === '') {
      throw new Error(`constellations[${index}].title is required.`);
    }
    if (typeof item.explanation !== 'string' || item.explanation.trim() === '') {
      throw new Error(`constellations[${index}].explanation is required.`);
    }
    if (typeof item.score !== 'number' || item.score < 1 || item.score > 10) {
      throw new Error(`constellations[${index}].score must be between 1 and 10.`);
    }

    const type = item.type as ConstellationType;
    const candidate: ConstellationCandidate = {
      type,
      idea_ids: ideaIds,
      title: item.title.trim(),
      explanation: item.explanation.trim(),
      score: item.score,
    };
    if (type === 'absence' && typeof item.actionability === 'number') {
      candidate.actionability = Math.max(1, Math.min(10, Math.round(item.actionability)));
    }
    return candidate;
  });
  return { constellations };
}

export function parsePatternResponse(
  response: string | unknown,
  allowedIdeaIds: number[],
): { patterns: PatternCandidate[] } {
  const value = typeof response === 'string' ? parseJsonObject(response) : response;
  if (!isRecord(value) || !Array.isArray(value.patterns)) {
    throw new Error('Provider response must contain a patterns array.');
  }
  if (value.patterns.length > 3) throw new Error('Provider returned more than 3 patterns.');

  const allowed = new Set(allowedIdeaIds);
  const patterns = value.patterns.map((item, index) => {
    if (!isRecord(item)) throw new Error(`patterns[${index}] must be an object.`);
    if (typeof item.name !== 'string' || item.name.trim() === '') {
      throw new Error(`patterns[${index}].name is required.`);
    }
    if (typeof item.explanation !== 'string' || item.explanation.trim() === '') {
      throw new Error(`patterns[${index}].explanation is required.`);
    }
    const ideaIds = validateIdeaIds(item.idea_ids, allowed, `patterns[${index}].idea_ids`);
    return { name: item.name.trim(), explanation: item.explanation.trim(), idea_ids: ideaIds };
  });
  return { patterns };
}

import { describe, expect, it } from 'vitest';
import { parseConstellationResponse, parsePatternResponse } from '../src/pipeline/response-parser.js';

describe('structured response parsing', () => {
  it('parses and clamps a valid absence', () => {
    const parsed = parseConstellationResponse(JSON.stringify({
      constellations: [{
        type: 'absence',
        idea_ids: [1, 2, 3],
        title: 'Missing layer',
        explanation: 'A valid explanation.',
        score: 8,
        actionability: 14,
      }],
    }), [1, 2, 3]);
    expect(parsed.constellations[0].actionability).toBe(10);
  });

  it('rejects out-of-scope idea IDs', () => {
    expect(() => parseConstellationResponse({
      constellations: [{
        type: 'chain',
        idea_ids: [1, 2, 99],
        title: 'Bad chain',
        explanation: 'Invalid reference.',
        score: 8,
      }],
    }, [1, 2, 3])).toThrow(/out-of-scope/);
  });

  it('parses empty pattern results without fabricating output', () => {
    expect(parsePatternResponse({ patterns: [] }, [1, 2, 3])).toEqual({ patterns: [] });
  });
});

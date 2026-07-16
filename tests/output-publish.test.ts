import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publishData } from '../src/publish-data.js';
import { validatePipelineResult } from '../src/output-schema.js';

const temporary: string[] = [];

function validOutput(totalIdeas = 1) {
  return {
    constellations: [],
    patterns: [],
    ideas: totalIdeas === 0 ? {} : {
      1: { title: 'Idea', source: 'test', url: 'https://example.com', category: '', description: 'Description' },
    },
    metadata: {
      total_ideas: totalIdeas,
      neighborhoods_intra: 0,
      neighborhoods_cross: 0,
      neighborhoods_total: 0,
      constellations_found: 0,
      constellations_by_type: {},
      constellation_cache_hits: 0,
      constellation_api_calls: 0,
      pattern_cache_hits: 0,
      pattern_api_calls: 0,
      estimated_cost_usd: 0,
      elapsed_ms: 0,
    },
  };
}

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('output schema and safe publication', () => {
  it('accepts a valid empty dataset and rejects malformed JSON-shaped data', () => {
    expect(validatePipelineResult(validOutput(0)).success).toBe(true);
    expect(validatePipelineResult({ constellations: 'bad' }).success).toBe(false);
  });

  it('backs up, copies, and verifies a valid output without commit or push', () => {
    const root = mkdtempSync(join(tmpdir(), 'constellate-publish-'));
    temporary.push(root);
    const webDir = join(root, 'web');
    mkdirSync(join(webDir, 'public'), { recursive: true });
    writeFileSync(join(webDir, 'package.json'), '{}');
    writeFileSync(join(webDir, 'public', 'data.json'), JSON.stringify(validOutput(0)));
    const input = join(root, 'output.json');
    writeFileSync(input, JSON.stringify(validOutput(1)));

    const summary = publishData({ inputPath: input, webDir, runBuild: () => 0 });
    expect(summary.backupPath).toBeTruthy();
    expect(summary.newIdeas).toBe(1);
    expect(JSON.parse(readFileSync(summary.targetPath, 'utf8')).metadata.total_ideas).toBe(1);
  });

  it('rolls back data.json when the web build fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'constellate-rollback-'));
    temporary.push(root);
    const webDir = join(root, 'web');
    mkdirSync(join(webDir, 'public'), { recursive: true });
    writeFileSync(join(webDir, 'package.json'), '{}');
    const previous = JSON.stringify(validOutput(0));
    writeFileSync(join(webDir, 'public', 'data.json'), previous);
    const input = join(root, 'output.json');
    writeFileSync(input, JSON.stringify(validOutput(1)));

    expect(() => publishData({ inputPath: input, webDir, runBuild: () => 1 })).toThrow(/rolled back/);
    expect(readFileSync(join(webDir, 'public', 'data.json'), 'utf8')).toBe(previous);
  });

  it('keeps the preview build but restores public data after success', () => {
    const root = mkdtempSync(join(tmpdir(), 'constellate-preview-'));
    temporary.push(root);
    const webDir = join(root, 'web');
    mkdirSync(join(webDir, 'public'), { recursive: true });
    writeFileSync(join(webDir, 'package.json'), '{}');
    const previous = JSON.stringify(validOutput(0));
    writeFileSync(join(webDir, 'public', 'data.json'), previous);
    const input = join(root, 'output.json');
    writeFileSync(input, JSON.stringify(validOutput(1)));

    const summary = publishData({ inputPath: input, webDir, previewOnly: true, runBuild: () => 0 });
    expect(summary.previewOnly).toBe(true);
    expect(readFileSync(summary.targetPath, 'utf8')).toBe(previous);
  });
});

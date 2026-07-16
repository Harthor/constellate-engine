import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validatePipelineResult } from './output-schema.js';
import type { PipelineResult } from './types/index.js';

export interface PublishOptions {
  inputPath: string;
  webDir: string;
  backupDir?: string;
  runBuild?: (webDir: string) => number;
  previewOnly?: boolean;
}

export interface PublishSummary {
  inputPath: string;
  targetPath: string;
  backupPath: string | null;
  oldIdeas: number;
  newIdeas: number;
  oldConstellations: number;
  newConstellations: number;
  oldBytes: number;
  newBytes: number;
  previewOnly: boolean;
}

function readValidated(path: string): PipelineResult {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const validation = validatePipelineResult(parsed);
  if (!validation.success) {
    throw new Error(`Invalid pipeline output: ${validation.errors.slice(0, 10).join('; ')}`);
  }
  return validation.data;
}

function defaultBuild(webDir: string): number {
  return spawnSync('npm', ['run', 'build'], { cwd: webDir, stdio: 'inherit' }).status ?? 1;
}

export function publishData(options: PublishOptions): PublishSummary {
  const inputPath = resolve(options.inputPath);
  const webDir = resolve(options.webDir);
  const targetPath = join(webDir, 'public', 'data.json');
  if (!existsSync(inputPath)) throw new Error(`Input file does not exist: ${inputPath}`);
  if (!existsSync(join(webDir, 'package.json'))) throw new Error(`Invalid web directory: ${webDir}`);
  const next = readValidated(inputPath);
  const nextBytes = statSync(inputPath).size;

  let previous: PipelineResult | null = null;
  let oldBytes = 0;
  let backupPath: string | null = null;
  if (existsSync(targetPath)) {
    oldBytes = statSync(targetPath).size;
    try {
      previous = readValidated(targetPath);
    } catch {
      previous = null;
    }
    const backupDir = resolve(options.backupDir ?? join(dirname(inputPath), '.backups'));
    mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = join(backupDir, `constellate-web-data-${stamp}.json`);
    copyFileSync(targetPath, backupPath);
  }

  copyFileSync(inputPath, targetPath);
  const buildStatus = (options.runBuild ?? defaultBuild)(webDir);
  if (buildStatus !== 0) {
    if (backupPath) copyFileSync(backupPath, targetPath);
    else rmSync(targetPath, { force: true });
    throw new Error('constellate-web build failed; data.json was rolled back.');
  }

  if (options.previewOnly) {
    if (backupPath) copyFileSync(backupPath, targetPath);
    else rmSync(targetPath, { force: true });
  }

  return {
    inputPath,
    targetPath,
    backupPath,
    oldIdeas: previous?.metadata.total_ideas ?? 0,
    newIdeas: next.metadata.total_ideas,
    oldConstellations: previous?.constellations.length ?? 0,
    newConstellations: next.constellations.length,
    oldBytes,
    newBytes: nextBytes,
    previewOnly: options.previewOnly === true,
  };
}

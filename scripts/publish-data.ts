import { Command } from 'commander';
import { publishData } from '../src/publish-data.js';

const program = new Command();
program
  .description('Validate, back up, copy, and build constellate-web data safely')
  .option('--input <path>', 'Pipeline output to publish', 'output.json')
  .option('--web-dir <path>', 'Path to constellate-web', '../constellate-web')
  .option('--preview-only', 'Build the candidate, then restore public/data.json', false)
  .parse();

try {
  const options = program.opts<{ input: string; webDir: string; previewOnly: boolean }>();
  const summary = publishData({
    inputPath: options.input,
    webDir: options.webDir,
    previewOnly: options.previewOnly,
  });
  console.log(`\nData ${summary.previewOnly ? 'preview build' : 'publication'} verified. No commit or push was performed.`);
  console.log(`Target: ${summary.targetPath}`);
  console.log(`Backup: ${summary.backupPath ?? 'none (no previous file)'}`);
  console.log(`Ideas: ${summary.oldIdeas} -> ${summary.newIdeas}`);
  console.log(`Constellations: ${summary.oldConstellations} -> ${summary.newConstellations}`);
  console.log(`Bytes: ${summary.oldBytes} -> ${summary.newBytes}`);
  if (summary.previewOnly) console.log('public/data.json was restored after the preview build.');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Publication failed: ${message}`);
  process.exitCode = 1;
}

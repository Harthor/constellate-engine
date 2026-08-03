import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIN_FETCHED,
  evaluateSources,
  formatSourceSummary,
  hasHardFailure,
  logSourceReports,
  resolveThresholds,
  type ScrapeOutcome,
} from '../src/sources/health.js';

const thresholds = { arxiv: 100, hn: 50, tiny: 5 };

describe('source health', () => {
  it('marks a source that threw as failed', () => {
    const outcomes: ScrapeOutcome[] = [
      { source: 'arxiv', fetched: 0, inserted: 0, error: 'ETIMEDOUT' },
    ];
    const [report] = evaluateSources(outcomes, thresholds);
    expect(report.status).toBe('failed');
    expect(report.reason).toBe('ETIMEDOUT');
  });

  it('marks a silent empty scraper as failed, not merely degraded', () => {
    const [report] = evaluateSources([{ source: 'hn', fetched: 0, inserted: 0 }], thresholds);
    expect(report.status).toBe('failed');
    expect(report.reason).toMatch(/no rows/);
  });

  it('marks an under-performing source as degraded', () => {
    const [report] = evaluateSources([{ source: 'arxiv', fetched: 12, inserted: 12 }], thresholds);
    expect(report.status).toBe('degraded');
    expect(report.reason).toBe('fetched 12, below the 100 expected');
  });

  it('treats a healthy source that inserted nothing as ok', () => {
    // Hugging Face sorts by all-time likes: on a second run everything is a
    // duplicate. Zero inserts is normal; zero fetches would not be.
    const [report] = evaluateSources([{ source: 'hn', fetched: 200, inserted: 0 }], thresholds);
    expect(report.status).toBe('ok');
    expect(report.reason).toBeUndefined();
  });

  it('falls back to the default threshold for unlisted sources', () => {
    const [report] = evaluateSources(
      [{ source: 'brand-new', fetched: DEFAULT_MIN_FETCHED, inserted: 1 }],
      thresholds,
    );
    expect(report.threshold).toBe(DEFAULT_MIN_FETCHED);
    expect(report.status).toBe('ok');
  });

  it('reports a hard failure only when a source failed', () => {
    const degradedOnly = evaluateSources(
      [{ source: 'arxiv', fetched: 12, inserted: 12 }],
      thresholds,
    );
    expect(hasHardFailure(degradedOnly)).toBe(false);

    const withFailure = evaluateSources(
      [
        { source: 'arxiv', fetched: 500, inserted: 10 },
        { source: 'hn', fetched: 0, inserted: 0 },
      ],
      thresholds,
    );
    expect(hasHardFailure(withFailure)).toBe(true);
  });

  it('logs each source at the level its status warrants', () => {
    const lines: string[] = [];
    const reports = evaluateSources(
      [
        { source: 'arxiv', fetched: 500, inserted: 400 },
        { source: 'hn', fetched: 12, inserted: 12 },
        { source: 'tiny', fetched: 0, inserted: 0 },
      ],
      thresholds,
    );
    logSourceReports(reports, (line) => lines.push(line));
    expect(lines[0]).toMatch(/^ {2}ok {4}\[arxiv\]/);
    expect(lines[1]).toMatch(/^ {2}WARN {2}\[hn\]/);
    expect(lines[2]).toMatch(/^ {2}ERROR \[tiny\]/);
  });

  it('summarises sources by bucket', () => {
    const reports = evaluateSources(
      [
        { source: 'arxiv', fetched: 500, inserted: 400 },
        { source: 'hn', fetched: 12, inserted: 12 },
        { source: 'tiny', fetched: 0, inserted: 0 },
      ],
      thresholds,
    );
    const summary = formatSourceSummary(reports);
    expect(summary).toContain('OK       (1): arxiv');
    expect(summary).toContain('DEGRADED (1): hn');
    expect(summary).toContain('FAILED   (1): tiny');
  });

  it('reads threshold overrides from the environment', () => {
    const resolved = resolveThresholds({
      SCRAPER_MIN_FETCHED: '9',
      SCRAPER_MIN_FETCHED_ARXIV: '250',
    });
    expect(resolved.arxiv).toBe(250);
    // Sources with a built-in floor keep it unless overridden individually.
    expect(resolved.hn).toBe(50);
  });

  it('rejects a non-integer threshold override', () => {
    expect(() => resolveThresholds({ SCRAPER_MIN_FETCHED_ARXIV: 'many' })).toThrow(
      /SCRAPER_MIN_FETCHED_ARXIV/,
    );
  });
});

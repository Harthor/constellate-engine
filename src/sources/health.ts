/**
 * Scraper health checks.
 *
 * `scrapeAll` runs under Promise.allSettled, so a source that throws — or that
 * silently returns an empty array because its HTML changed — is indistinguishable
 * from a source that legitimately had nothing new. That is how the corpus
 * degraded from nine sources to five without anyone noticing.
 *
 * These helpers turn that silence into an explicit, per-source verdict.
 */

/**
 * The threshold is on rows FETCHED, not rows inserted.
 *
 * A healthy scraper routinely inserts zero: Hugging Face sorts by all-time
 * likes and Y Combinator reads fixed batches, so on a second run almost every
 * item is a duplicate. Alarming on inserts would fire every week on sources
 * that are working perfectly, and an alarm that always fires gets ignored.
 * Fetching nothing, on the other hand, always means the scraper is broken.
 */
export const DEFAULT_MIN_FETCHED = 5;

/**
 * Per-source floors for sources whose healthy volume is well above the default.
 * A source missing from this map uses DEFAULT_MIN_FETCHED.
 */
export const SOURCE_MIN_FETCHED: Record<string, number> = {
  arxiv: 100,
  hn: 50,
  github: 30,
  devto: 30,
  huggingface: 50,
  producthunt: 5,
  yc: 5,
  betalist: 5,
  paperswithcode: 5,
};

export type SourceStatus = 'ok' | 'degraded' | 'failed';

export interface SourceReport {
  source: string;
  fetched: number;
  inserted: number;
  threshold: number;
  status: SourceStatus;
  reason?: string;
}

export interface ScrapeOutcome {
  source: string;
  fetched: number;
  inserted: number;
  error?: string;
}

/**
 * Reads per-source overrides from the environment so thresholds can be tuned
 * without a code change: SCRAPER_MIN_FETCHED sets the default, and
 * SCRAPER_MIN_FETCHED_<SOURCE> (uppercased) overrides one source.
 */
export function resolveThresholds(
  env: Record<string, string | undefined> = process.env,
): Record<string, number> {
  const parse = (raw: string | undefined, fallback: number, name: string): number => {
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative integer.`);
    }
    return value;
  };

  const base = parse(env.SCRAPER_MIN_FETCHED, DEFAULT_MIN_FETCHED, 'SCRAPER_MIN_FETCHED');
  const thresholds: Record<string, number> = {};
  for (const source of Object.keys(SOURCE_MIN_FETCHED)) {
    const key = `SCRAPER_MIN_FETCHED_${source.toUpperCase()}`;
    thresholds[source] = parse(env[key], SOURCE_MIN_FETCHED[source] ?? base, key);
  }
  return thresholds;
}

export function evaluateSources(
  outcomes: ScrapeOutcome[],
  thresholds: Record<string, number> = resolveThresholds(),
  fallback = DEFAULT_MIN_FETCHED,
): SourceReport[] {
  return outcomes.map((outcome) => {
    const threshold = thresholds[outcome.source] ?? fallback;
    if (outcome.error) {
      return {
        ...outcome,
        threshold,
        status: 'failed' as const,
        reason: outcome.error,
      };
    }
    if (outcome.fetched === 0) {
      return {
        ...outcome,
        threshold,
        status: 'failed' as const,
        reason: 'returned no rows — the scraper is almost certainly broken',
      };
    }
    if (outcome.fetched < threshold) {
      return {
        ...outcome,
        threshold,
        status: 'degraded' as const,
        reason: `fetched ${outcome.fetched}, below the ${threshold} expected`,
      };
    }
    return { ...outcome, threshold, status: 'ok' as const };
  });
}

/** True when at least one source hard-failed, so the caller can exit non-zero. */
export function hasHardFailure(reports: SourceReport[]): boolean {
  return reports.some((report) => report.status === 'failed');
}

/** One line per source, at the level its status warrants. */
export function logSourceReports(
  reports: SourceReport[],
  log: (line: string) => void = console.log,
): void {
  for (const report of reports) {
    const counts = `${report.fetched} fetched, ${report.inserted} new`;
    if (report.status === 'failed') {
      log(`  ERROR [${report.source}] ${counts} — ${report.reason}`);
    } else if (report.status === 'degraded') {
      log(`  WARN  [${report.source}] ${counts} — ${report.reason}`);
    } else {
      log(`  ok    [${report.source}] ${counts}`);
    }
  }
}

export function formatSourceSummary(reports: SourceReport[]): string {
  const byStatus = (status: SourceStatus) =>
    reports.filter((report) => report.status === status).map((report) => report.source);

  const ok = byStatus('ok');
  const degraded = byStatus('degraded');
  const failed = byStatus('failed');
  const list = (names: string[]) => (names.length ? names.join(', ') : '—');

  return [
    '',
    '========== SOURCE HEALTH ==========',
    `OK       (${ok.length}): ${list(ok)}`,
    `DEGRADED (${degraded.length}): ${list(degraded)}`,
    `FAILED   (${failed.length}): ${list(failed)}`,
    '===================================',
  ].join('\n');
}

import type { SourceScraper, RawIdea } from '../types/index.js';

export type { SourceScraper, RawIdea };

/**
 * Stub scraper for demonstration purposes.
 *
 * To implement a real scraper:
 *
 * 1. Create a new file in src/sources/ (e.g. hackernews.ts)
 * 2. Implement the SourceScraper interface
 * 3. Register it in your pipeline invocation
 *
 * Example:
 *
 * ```ts
 * import type { SourceScraper, RawIdea } from '../types/index.js';
 *
 * export class HackerNewsScraper implements SourceScraper {
 *   readonly name = 'hackernews';
 *
 *   async fetch(): Promise<RawIdea[]> {
 *     // Fetch from HN API, transform to RawIdea[]
 *     const response = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
 *     const ids = await response.json();
 *     // ... fetch each story, map to RawIdea
 *     return ideas;
 *   }
 * }
 * ```
 *
 * Constellate does NOT ship with built-in scrapers to avoid
 * coupling to specific APIs or rate limit policies. The source
 * interface is intentionally minimal.
 */
export class StubScraper implements SourceScraper {
  readonly name = 'stub';

  async fetch(): Promise<RawIdea[]> {
    return [
      {
        title: 'Example Idea',
        description: 'This is a stub. Replace with a real scraper.',
        url: 'https://example.com',
        source: 'stub',
      },
    ];
  }
}

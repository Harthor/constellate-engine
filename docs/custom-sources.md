# Custom Sources

Constellate ships with 9 built-in scrapers. Some popular sources are not included due to ToS constraints. This guide explains how to add your own.

## Sources not included

### Reddit

Reddit requires OAuth2 authentication via their official API since June 2023. Unauthenticated scraping violates their Terms of Service.

To implement your own Reddit scraper:

1. Create an app at https://www.reddit.com/prefs/apps
2. Use the OAuth2 flow to obtain an access token
3. Query `https://oauth.reddit.com/r/{subreddit}/top` with the `Authorization: Bearer <token>` header
4. See https://www.reddit.com/dev/api for full documentation

### Indie Hackers

Indie Hackers does not provide a public API. Scraping their internal endpoints is not authorized under their Terms of Service.

## Adding a custom source

Implement the `SourceScraper` interface or add a function returning `RawIdea[]`:

```typescript
import type { RawIdea } from '../types/index.js';

export async function scrapeMySource(): Promise<RawIdea[]> {
  const res = await fetch('https://api.example.com/items');
  const data = await res.json();

  return data.items.map((item: any) => ({
    title: item.name,
    url: item.link,
    description: item.summary,
    source: 'my-source',
  }));
}
```

Then register it in `src/sources/scrapers.ts`:

```typescript
import { scrapeMySource } from './my-source.js';

export const SCRAPERS: Record<string, () => Promise<RawIdea[]>> = {
  // ... existing scrapers
  'my-source': scrapeMySource,
};
```

## Guidelines

- Respect `robots.txt` and rate limits
- Use descriptive User-Agent strings
- Add inter-request delays for HTML scraping
- Prefer official APIs over HTML scraping when available
- Check the source's Terms of Service before scraping

# Constellate Engine

Discover non-obvious patterns across large idea corpora using AI-powered constellation detection.

Constellate takes a collection of ideas/projects/concepts, clusters them by semantic similarity using TF-IDF embeddings, forms neighborhoods of related ideas, and then uses Claude to find **constellations** — subsets of 3-6 ideas that together reveal something non-obvious that none reveals alone.

## How It Works

The pipeline has 4 stages:

1. **Embeddings + Clustering** — TF-IDF vectors (zero cost, zero dependencies) fed into k-means to group similar ideas
2. **Neighborhood Formation** — Intra-cluster and cross-cluster neighborhoods for Claude to analyze
3. **Constellation Discovery** — Claude examines each neighborhood for 5 types of non-obvious patterns:
   - **Triangulation**: 3 ideas that from different angles illuminate the same deep phenomenon
   - **Spectrum**: Ideas representing positions on the same axis of debate
   - **Chain**: Logical/causal progression where each enables the next
   - **Convergence**: Different domains inadvertently pointing to the same deep problem
   - **Absence**: What's conspicuously missing given the neighborhood's structure
4. **Emergent Patterns** — Claude looks at each cluster as a whole for undercurrents and paradigm shifts

Everything is cached in SQLite. Re-running with the same data costs $0.

## Quick Start

```bash
# Install
npm install

# Ingest ideas from JSON
npx tsx cli/index.ts ingest examples/sample-ideas.json

# Run the pipeline (requires API key)
ANTHROPIC_API_KEY=sk-... npx tsx cli/index.ts run

# Or run the demo (works without API key for stages 1-2)
npx tsx examples/demo.ts
```

## CLI Commands

```bash
constellate run              # Run the full pipeline
  --force                    # Ignore cache, recompute everything
  --clusters <n>             # Number of clusters (default: 15)
  --min-score <n>            # Min constellation score 1-10 (default: 6)
  --model <model>            # Claude model for discovery
  --embedder <name>          # Embedder (default: tfidf)
  --output <path>            # Output JSON path (default: output.json)

constellate ingest <file>    # Import ideas from JSON
constellate scrape [source]  # Scrape ideas (all sources if none specified)
constellate stats            # Show database statistics
constellate clear-cache      # Clear all cached results
```

## Input Format

Ideas JSON — array of objects:

```json
[
  {
    "title": "Project Name",
    "description": "What it does and why it matters",
    "source": "github-trending",
    "url": "https://github.com/...",
    "category": "devtools",
    "stack": "typescript,react"
  }
]
```

## Web Visualizer

Open `web/index.html` in a browser and load the pipeline output JSON. Displays constellations as filterable cards with scores, types, and linked ideas. A `web/sample-output.json` is included for testing.

## Architecture

```
src/
  types/          — Domain types, pricing tables
  db/             — SQLite schema + data layer with caching
  embeddings/     — Embedder interface + TF-IDF implementation
  pipeline/       — 4-stage orchestration
  prompts/        — Claude prompt templates (versioned)
  sources/        — Source scraper interface (bring your own)
  utils/          — Retry, concurrency, cost tracking, hashing
cli/              — Commander-based CLI
web/              — Static HTML visualizer
examples/         — Sample dataset + demo script
tests/            — Vitest test suite
```

## Custom Embedders

TF-IDF is the default (zero cost, good enough for <1000 ideas). For larger corpora, implement the `Embedder` interface:

```typescript
import type { Embedder, EmbeddingResult } from 'constellate-engine';

class MyEmbedder implements Embedder {
  readonly model = 'my-embedder-v1';

  async embed(documents: string[]): Promise<EmbeddingResult> {
    // Call OpenAI, Voyage, Cohere, etc.
    return { vectors, dimensions };
  }
}
```

## Cost Control

- Default budget: $5.00 per run
- TF-IDF embeddings: $0 (local)
- All Claude API calls are cached by neighborhood hash + prompt version
- Re-running the same dataset is free after first run
- Cost tracked per stage in pipeline output

## Sources

Constellate ships with 9 built-in scrapers:

GitHub Trending, Hacker News, arXiv (CS.AI), Product Hunt, Y Combinator, BetaList, Dev.to, Papers With Code, Hugging Face.

Reddit and Indie Hackers are **not included** in the open-source release due to ToS constraints. See [docs/custom-sources.md](docs/custom-sources.md) for guidance on adding your own sources, including Reddit with OAuth2.

```bash
# Scrape all sources
npx tsx cli/index.ts scrape

# Scrape a specific source
npx tsx cli/index.ts scrape github
```

## Weekly Pipeline

Run the full scrape → pipeline → export flow:

```bash
ANTHROPIC_API_KEY=sk-... npx tsx scripts/weekly-run.ts
```

To generate a DB compatible with [constellate-landing](https://github.com/Harthor/constellate-landing):

```bash
npx tsx scripts/export-landing-db.ts [output-path]
```

## Development

```bash
npm run typecheck    # Type checking
npm test             # Run tests
npm run test:watch   # Watch mode
```

## License

This project is source-available under the Business Source License 1.1 (BSL 1.1).

- **Change Date**: April 12, 2030
- **Change License**: Apache License 2.0
- **Additional Use Grant**: You may use the Licensed Work for any purpose other than operating a commercial hosted service that competes with constellate.fyi.

After the Change Date, the code becomes available under Apache 2.0. See the `LICENSE` file for the full text.

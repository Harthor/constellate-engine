# Constellate Engine

Local pipeline for [Constellate](https://constellate.fyi). It ingests technology ideas, deduplicates and normalizes them, computes TF-IDF embeddings, clusters them, forms neighborhoods, and optionally asks Claude to identify constellations and emergent patterns. Results are cached in SQLite and exported as `output.json` for [constellate-web](https://github.com/Harthor/constellate-web).

There is no permanent backend. The engine runs locally or as a manually invoked batch job; the web repository is a static site.

## Safety defaults

The default configuration cannot spend money:

```dotenv
ANTHROPIC_MODEL=claude-fable-5
ANTHROPIC_MAX_OUTPUT_TOKENS=1024
ANTHROPIC_EFFORT=low
ANTHROPIC_MAX_BUDGET_USD=0
ANTHROPIC_MAX_CALLS=0
ANTHROPIC_CONCURRENCY=1
ANTHROPIC_INPUT_USD_PER_MILLION=10
ANTHROPIC_OUTPUT_USD_PER_MILLION=50
```

`ANTHROPIC_API_KEY` is read only from the process environment and is never written, printed, cached, or included in output. Do not put a real key in a versioned file.

The Fable 5 model ID and [standard API price documented by Anthropic](https://platform.claude.com/docs/en/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5) are USD 10 per million input tokens and USD 50 per million output tokens. Adaptive thinking is always enabled for Fable 5, so the engine selects low effort and a 1,024-token hard output cap for these bounded JSON tasks. Fable 5 may return `stop_reason: "refusal"`; Constellate records that response and stops without automatically falling back to another paid model. Anthropic currently documents a 30-day API retention requirement for Fable 5, so do not send material that requires zero-data-retention treatment.

## Install and verify

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

## Ingest data

The CLI accepts either a JSON array of ideas or a pipeline-shaped object whose `ideas` field is an object keyed by ID. This imports the real dataset currently used by the frontend:

```bash
npm run pipeline -- ingest ../constellate-web/public/data.json
npm run pipeline -- stats
```

URLs, whitespace, and source names are normalized. Repeated URLs, and source/title duplicates without URLs, are skipped.

## Zero-cost dry run

Run the 30-idea, 50-idea, and full-dataset scenarios:

```bash
npm run dry-run
```

Run one scenario:

```bash
npm run pipeline -- dry-run --limit 40
```

Dry-run executes the local stages and validates source data, embeddings, clustering, neighborhoods, cache state, token estimates, cost estimates, and output shape. It creates no Anthropic client, makes zero provider calls, and does not overwrite `output.json`.

Each preflight reports:

- documents, distinct sources, clusters, and neighborhoods;
- constellation and pattern jobs;
- estimated calls and calls planned under the cap;
- reusable paid-call cache entries;
- expected and conservative-maximum input tokens;
- maximum output tokens;
- expected cost and maximum theoretical cost;
- configured budget and call limits.

## Minimal paid test — do not run without reviewing preflight

First place the key in the shell environment without writing it to the repository. Then run:

```bash
ANTHROPIC_MODEL=claude-fable-5 \
ANTHROPIC_MAX_OUTPUT_TOKENS=1024 \
ANTHROPIC_EFFORT=low \
ANTHROPIC_MAX_BUDGET_USD=0.25 \
ANTHROPIC_MAX_CALLS=2 \
ANTHROPIC_CONCURRENCY=1 \
npm run pipeline -- run \
  --limit 40 \
  --output output-fable-test.json
```

The command displays the full preflight and asks you to type `YES`. For non-interactive automation, `--yes` is required explicitly. The budget controller reserves the conservative maximum cost before every individual attempt, counts retries against `max-calls`, and refuses any request that could cross the budget.

Use a separate output file for tests. Do not replace production data until the result has been reviewed.

## Cache and safe resume

SQLite stores:

- normalized ideas;
- TF-IDF embeddings;
- materialized constellations and patterns;
- one `api_call_cache` ledger row after every successful paid response, including empty, invalid, and refused responses.

The append-only attempt ledger contains the input hash, stage, scope hash, model, prompt version, response, input/output token counts, calculated cost, status, and timestamp. A separate latest-response cache supports resume. Re-running the same input/model/prompt reuses valid results. Invalid or refused cached responses block automatic retries; use `--retry-failed` only after deliberate review, or `--skip-failed` to omit a reviewed failure without paying again. `--force` ignores every valid cache too and can spend substantially more.

## Manual data publication

After reviewing a real `output.json`:

```bash
npm run publish-data -- --web-dir ../constellate-web
```

Or select a candidate explicitly:

```bash
npm run publish-data -- \
  --input output-fable-test.json \
  --web-dir ../constellate-web
```

The command validates the output schema, creates a timestamped backup under `.backups/`, copies the candidate to `constellate-web/public/data.json`, runs the frontend build, rolls back on failure, and prints a count/size diff. It never commits or pushes.

Use `--preview-only` to keep the generated frontend `out/` build while automatically restoring the current `public/data.json` after a successful build.

## Batch source ingestion

Nine scrapers are included: GitHub Trending, Hacker News, arXiv, Product Hunt, Y Combinator, BetaList, Dev.to, Papers With Code, and Hugging Face.

```bash
npm run pipeline -- scrape
npm run pipeline -- scrape hn
```

`PRODUCTHUNT_TOKEN` is optional. `scripts/weekly-run.ts` is only a batch script; this repository does not configure a weekly scheduler. With the default zero budget it performs a dry run and leaves all output files untouched. A non-interactive paid batch additionally requires explicit `--yes`.

## Manual weekly refresh

The static website is updated from a versioned data snapshot; it does not need a permanent backend. The manual refresh flow is:

```bash
# 1. Refresh sources and estimate the current corpus for USD 0.
npm run weekly-run

# 2. After reviewing the preflight, run with a process-only API key,
#    explicit non-zero limits, and --yes.
ANTHROPIC_MAX_BUDGET_USD=4.75 \
ANTHROPIC_MAX_CALLS=50 \
npm run weekly-run -- --yes

# 3. Review and publish the exact dated candidate printed by step 2.
npm run publish-data -- --input runs/constellate-<timestamp>.json --web-dir ../constellate-web
```

Every paid batch saves both `output.json` and an immutable local file under `runs/`. The snapshot embeds `metadata.generated_at`, so the frontend can show when the analysis actually ran instead of relying on a filesystem copy date. Use `--skip-scrape` when resuming the same already-refreshed corpus. Do not normally use `--force`: valid cached calls make a resume free and safe. After reviewing a failed response, `--retry-failed` retries only failed entries while preserving valid work.

To materialize a dated snapshot from already-paid valid cache entries without making any provider call, keep the default zero budget and run:

```bash
npm run weekly-run -- --skip-scrape --skip-failed --save-cache-snapshot
```

The snapshot metadata records how many reviewed failures were skipped.

## Architecture

```text
src/config.ts             centralized model, pricing, and hard limits
src/sources/              source ingestion
src/embeddings/           local TF-IDF vectors
src/pipeline/             clustering, neighborhoods, preflight, API stages
src/prompts/              versioned prompts
src/db/                   SQLite schema, cache, and resume ledger
src/utils/                concurrency, retries, hashing, and budget control
src/output-schema.ts      output validation
src/publish-data.ts       guarded frontend publication
cli/                      interactive command line
```

## License

Business Source License 1.1. See `LICENSE`.

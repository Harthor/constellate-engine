import type { RawIdea } from '../types/index.js';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ─── GitHub Trending ───────────────────────────────────────────────

/**
 * GitHub has no official trending API, so we scrape the trending pages per
 * language with since=weekly. Iterates 5 languages and dedupes by repo slug.
 */
export async function scrapeGithub(): Promise<RawIdea[]> {
  const langs = ['python', 'typescript', 'javascript', 'rust', 'go'];
  const seen = new Set<string>();
  const items: RawIdea[] = [];

  for (const lang of langs) {
    const url = `https://github.com/trending/${lang}?since=weekly`;
    let html: string;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      html = await res.text();
    } catch {
      continue;
    }

    const repoRegex = /href="\/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)"[^>]*class="Link"/g;
    const descRegex = /<p class="col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/g;

    const repos: string[] = [];
    let m;
    while ((m = repoRegex.exec(html)) !== null) {
      if (!repos.includes(m[1])) repos.push(m[1]);
    }

    const descs: string[] = [];
    while ((m = descRegex.exec(html)) !== null) {
      descs.push(m[1].replace(/<[^>]+>/g, '').trim());
    }

    for (let i = 0; i < repos.length; i++) {
      const slug = repos[i];
      if (seen.has(slug)) continue;
      seen.add(slug);
      items.push({
        title: slug,
        url: `https://github.com/${slug}`,
        description:
          (descs[i] || '') +
          (descs[i] ? ` | lang: ${lang}` : `lang: ${lang}`),
        source: 'github',
      });
    }
  }
  return items;
}

// ─── Hacker News ───────────────────────────────────────────────────

/**
 * Pull the top 500 stories from HN and keep stories from the last 7 days
 * with score > 50. Batched fetches with early-stop at TARGET so we don't
 * hammer the firebase API when the top is well above the threshold.
 */
export async function scrapeHackerNews(): Promise<RawIdea[]> {
  const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
  const ids = (await res.json()) as number[];

  const nowSec = Math.floor(Date.now() / 1000);
  const oneWeekAgo = nowSec - 7 * 24 * 60 * 60;
  const MIN_SCORE = 50;
  const TARGET = 250;
  const MAX_POLL = 500;

  type HnItem = {
    id?: number;
    url?: string;
    title?: string;
    score?: number;
    descendants?: number;
    time?: number;
    deleted?: boolean;
    dead?: boolean;
    type?: string;
  };

  const idsToPoll = ids.slice(0, MAX_POLL);
  const out: RawIdea[] = [];
  const BATCH = 40;
  for (let i = 0; i < idsToPoll.length && out.length < TARGET; i += BATCH) {
    const batch = idsToPoll.slice(i, i + BATCH);
    const items = await Promise.all(
      batch.map(async (id) => {
        try {
          const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
          return (await r.json()) as HnItem;
        } catch {
          return null;
        }
      }),
    );
    for (const s of items) {
      if (!s || s.deleted || s.dead) continue;
      if (s.type !== 'story') continue;
      if (!s.url || !s.title) continue;
      if ((s.score ?? 0) < MIN_SCORE) continue;
      if ((s.time ?? 0) < oneWeekAgo) continue;
      out.push({
        title: s.title,
        url: s.url,
        description: `HN score: ${s.score ?? 0} | comments: ${s.descendants ?? 0}`,
        source: 'hn',
      });
      if (out.length >= TARGET) break;
    }
  }
  return out;
}

// ─── arXiv (CS) ────────────────────────────────────────────────────

/**
 * Pull papers from the last 7 days across the main CS sub-categories,
 * sorted by submission date. Uses the official Atom API (not the RSS
 * feed, which only returns ~20 items). Parsing is done with regex to
 * avoid pulling in an XML lib for this single consumer.
 */
export async function scrapeArxiv(): Promise<RawIdea[]> {
  const query = [
    'cat:cs.AI',
    'cat:cs.CL',
    'cat:cs.LG',
    'cat:cs.CV',
    'cat:cs.SE',
    'cat:cs.DC',
  ].join('+OR+');
  const url =
    `https://export.arxiv.org/api/query?search_query=${query}` +
    `&sortBy=submittedDate&sortOrder=descending&max_results=300`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'constellate-engine/1.0' },
  });
  const xml = await res.text();

  // Atom <entry>…</entry>. We strip namespaces off tag names by matching
  // the unqualified forms (arxiv namespaces them but the regex doesn't care).
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  const titleRe = /<title>([\s\S]*?)<\/title>/;
  const summaryRe = /<summary>([\s\S]*?)<\/summary>/;
  const publishedRe = /<published>([\s\S]*?)<\/published>/;
  // The <link rel="alternate" href="…"> link is the human-readable URL.
  // arxiv puts href BEFORE rel, so match either order.
  const altLinkReA = /<link[^>]+href="([^"]+)"[^>]+rel="alternate"/;
  const altLinkReB = /<link[^>]+rel="alternate"[^>]+href="([^"]+)"/;

  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const out: RawIdea[] = [];

  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const block = m[1];
    const title = titleRe
      .exec(block)?.[1]
      ?.replace(/\s+/g, ' ')
      .replace(/<[^>]+>/g, '')
      .trim();
    const url =
      altLinkReA.exec(block)?.[1]?.trim() ??
      altLinkReB.exec(block)?.[1]?.trim();
    const summary = summaryRe
      .exec(block)?.[1]
      ?.replace(/\s+/g, ' ')
      .replace(/<[^>]+>/g, '')
      .trim()
      .slice(0, 400);
    const publishedStr = publishedRe.exec(block)?.[1]?.trim();
    if (!title || !url) continue;
    if (publishedStr) {
      const t = Date.parse(publishedStr);
      if (Number.isFinite(t) && t < oneWeekAgo) continue;
    }
    out.push({
      title,
      url,
      description: summary || '',
      source: 'arxiv',
    });
  }
  return out;
}

// ─── Product Hunt ──────────────────────────────────────────────────

/**
 * Uses the GraphQL v2 API with a Developer Token (PRODUCTHUNT_TOKEN).
 * Pulls the top 100 launches from the last 7 days, ordered by votes.
 *
 * Falls back to the old HTML-scrape path if no token is configured so
 * the scraper still returns something in local-dev without secrets.
 */
export async function scrapeProductHunt(): Promise<RawIdea[]> {
  const token = process.env.PRODUCTHUNT_TOKEN;

  if (token) {
    // GraphQL supports `postedAfter: DateTime!` to scope to recent launches.
    const postedAfter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const out: RawIdea[] = [];
    let cursor: string | null = null;
    // PH caps `first` at 20. Paginate up to 5 pages = 100 posts.
    for (let page = 0; page < 5; page++) {
      const query = `
        query ($after: String, $postedAfter: DateTime) {
          posts(first: 20, order: VOTES, after: $after, postedAfter: $postedAfter) {
            edges {
              cursor
              node { name tagline url website votesCount }
            }
            pageInfo { endCursor hasNextPage }
          }
        }
      `;
      const r = await fetch('https://api.producthunt.com/v2/api/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'constellate-engine/1.0',
        },
        body: JSON.stringify({
          query,
          variables: { after: cursor, postedAfter },
        }),
      });
      if (!r.ok) break;
      const d = (await r.json()) as any;
      const edges = d?.data?.posts?.edges ?? [];
      for (const { node } of edges) {
        out.push({
          title: node.name,
          url: node.website || node.url,
          description: `${node.tagline}${node.votesCount ? ` | votes: ${node.votesCount}` : ''}`,
          source: 'producthunt',
        });
      }
      if (!d?.data?.posts?.pageInfo?.hasNextPage) break;
      cursor = d.data.posts.pageInfo.endCursor;
      if (!cursor) break;
    }
    return out;
  }

  // ── Fallback: HTML scrape of the homepage (no token) ─────────────
  const res = await fetch('https://www.producthunt.com/', {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
  });
  const html = await res.text();
  const jsonMatch = html.match(/window\.__NEXT_DATA__\s*=\s*(\{[\s\S]*?)\s*<\/script>/);
  if (!jsonMatch) return [];
  try {
    const str = jsonMatch[1];
    const postMatches = str.match(/"name":"([^"]+)","tagline":"([^"]+)","url":"([^"]+)"/g) ?? [];
    return postMatches
      .slice(0, 20)
      .map((m) => {
        const [, name, tagline, url] =
          m.match(/"name":"([^"]+)","tagline":"([^"]+)","url":"([^"]+)"/) ?? [];
        return {
          title: name,
          url: `https://www.producthunt.com${url}`,
          description: tagline,
          source: 'producthunt',
        };
      })
      .filter((i) => i.title);
  } catch {
    return [];
  }
}

// ─── Y Combinator ──────────────────────────────────────────────────

export async function scrapeYCombinator(): Promise<RawIdea[]> {
  const batches = ['W25', 'S24', 'W24'];
  const items: RawIdea[] = [];
  for (const batch of batches) {
    try {
      const res = await fetch(
        `https://api.ycombinator.com/v0.1/companies?batch=${batch}&count=10`,
        { headers: { 'User-Agent': UA } },
      );
      if (!res.ok) continue;
      const data = (await res.json()) as any;
      for (const c of data?.companies ?? []) {
        items.push({
          title: c.name,
          url: c.website || c.url,
          description: c.oneLiner || '',
          source: 'yc',
        });
      }
    } catch { continue; }
  }
  return items.slice(0, 25);
}

// ─── Indie Hackers ─────────────────────────────────────────────────
// Not included in the open-source release — Indie Hackers has no public API.
// See docs/custom-sources.md for implementation guidance.

// ─── BetaList ──────────────────────────────────────────────────────

export async function scrapeBetaList(): Promise<RawIdea[]> {
  const res = await fetch('https://betalist.com/startups', {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
  });
  const html = await res.text();
  const items: RawIdea[] = [];
  const blockRe = /<article[^>]*>([\s\S]*?)<\/article>/g;
  const titleRe = /<h2[^>]*>([\s\S]*?)<\/h2>/;
  const descRe = /<p[^>]*class="[^"]*tagline[^"]*"[^>]*>([\s\S]*?)<\/p>/;
  const linkRe = /href="(\/startups\/[^"]+)"/;
  let m;
  while ((m = blockRe.exec(html)) !== null && items.length < 20) {
    const block = m[1];
    const title = titleRe.exec(block)?.[1]?.replace(/<[^>]+>/g, '').trim();
    const desc = descRe.exec(block)?.[1]?.replace(/<[^>]+>/g, '').trim();
    const slug = linkRe.exec(block)?.[1];
    if (title) {
      items.push({
        title,
        url: slug ? `https://betalist.com${slug}` : 'https://betalist.com',
        description: desc || '',
        source: 'betalist',
      });
    }
  }
  return items;
}

// ─── Dev.to ────────────────────────────────────────────────────────

export async function scrapeDevTo(): Promise<RawIdea[]> {
  const res = await fetch('https://dev.to/api/articles?top=7&per_page=20', {
    headers: { 'User-Agent': 'ConstellateEngine/1.0' },
  });
  const articles = (await res.json()) as any;
  return (Array.isArray(articles) ? articles : []).slice(0, 20).map((a: any) => ({
    title: a.title,
    url: a.url,
    description: `${a.description || ''} | tags: ${(a.tag_list || []).join(', ')} | reactions: ${a.public_reactions_count}`,
    source: 'devto',
  }));
}

// ─── Reddit ────────────────────────────────────────────────────────
// Not included in the open-source release due to Reddit ToS constraints.
// Reddit requires OAuth2 via their official API since June 2023.
// See docs/custom-sources.md for implementation guidance.

// ─── Papers With Code ──────────────────────────────────────────────

export async function scrapePapersWithCode(): Promise<RawIdea[]> {
  const res = await fetch('https://paperswithcode.com/latest', {
    headers: { 'User-Agent': UA },
  });
  const html = await res.text();
  const items: RawIdea[] = [];

  const blockRe = /<div class="paper-card[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
  const titleRe = /<h1[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/;
  const descRe = /<p class="item-strip-abstract"[^>]*>([\s\S]*?)<\/p>/;

  let m;
  while ((m = blockRe.exec(html)) !== null && items.length < 20) {
    const block = m[1];
    const titleMatch = titleRe.exec(block);
    const desc = descRe.exec(block)?.[1]?.replace(/<[^>]+>/g, '').trim();
    if (titleMatch) {
      items.push({
        title: titleMatch[2].replace(/<[^>]+>/g, '').trim(),
        url: `https://paperswithcode.com${titleMatch[1]}`,
        description: desc || '',
        source: 'paperswithcode',
      });
    }
  }

  // Fallback
  if (items.length === 0) {
    const linkRe = /href="(\/paper\/[^"]+)"[^>]*>\s*<h1[^>]*>([\s\S]*?)<\/h1>/g;
    while ((m = linkRe.exec(html)) !== null && items.length < 20) {
      items.push({
        title: m[2].replace(/<[^>]+>/g, '').trim(),
        url: `https://paperswithcode.com${m[1]}`,
        description: '',
        source: 'paperswithcode',
      });
    }
  }
  return items;
}

// ─── Hugging Face ──────────────────────────────────────────────────

export async function scrapeHuggingFace(): Promise<RawIdea[]> {
  const [modelsRes, spacesRes] = await Promise.all([
    fetch('https://huggingface.co/api/models?sort=likes&limit=15&direction=-1', {
      headers: { 'User-Agent': 'ConstellateEngine/1.0' },
    }),
    fetch('https://huggingface.co/api/spaces?sort=likes&limit=10&direction=-1', {
      headers: { 'User-Agent': 'ConstellateEngine/1.0' },
    }),
  ]);
  const models = (await modelsRes.json()) as any;
  const spaces = (await spacesRes.json()) as any;
  const items: RawIdea[] = [];

  for (const m of (Array.isArray(models) ? models : []).slice(0, 15)) {
    items.push({
      title: m.id,
      url: `https://huggingface.co/${m.id}`,
      description: `Model | likes: ${m.likes} | downloads: ${m.downloads ?? '?'}`,
      source: 'huggingface',
    });
  }
  for (const s of (Array.isArray(spaces) ? spaces : []).slice(0, 10)) {
    items.push({
      title: s.id,
      url: `https://huggingface.co/spaces/${s.id}`,
      description: `Space | likes: ${s.likes}`,
      source: 'huggingface',
    });
  }
  return items;
}

// ─── Registry ──────────────────────────────────────────────────────

export const SCRAPERS: Record<string, () => Promise<RawIdea[]>> = {
  github: scrapeGithub,
  hn: scrapeHackerNews,
  arxiv: scrapeArxiv,
  producthunt: scrapeProductHunt,
  yc: scrapeYCombinator,
  betalist: scrapeBetaList,
  devto: scrapeDevTo,
  paperswithcode: scrapePapersWithCode,
  huggingface: scrapeHuggingFace,
};

export const SOURCE_NAMES = Object.keys(SCRAPERS);

export async function scrapeAll(): Promise<{ source: string; ideas: RawIdea[]; error?: string }[]> {
  const results = await Promise.allSettled(
    Object.entries(SCRAPERS).map(async ([source, fn]) => {
      const ideas = await fn();
      return { source, ideas };
    }),
  );

  return results.map((r, i) => {
    const source = SOURCE_NAMES[i];
    if (r.status === 'fulfilled') return r.value;
    return { source, ideas: [], error: String((r as PromiseRejectedResult).reason) };
  });
}

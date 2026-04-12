import type { RawIdea } from '../types/index.js';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ─── GitHub Trending ───────────────────────────────────────────────

export async function scrapeGithub(): Promise<RawIdea[]> {
  const res = await fetch('https://github.com/trending?since=monthly', {
    headers: { 'User-Agent': UA },
  });
  const html = await res.text();
  const items: RawIdea[] = [];

  const repoRegex = /href="\/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)"[^>]*class="Link"/g;
  const descRegex = /<p class="col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/g;

  const repos: string[] = [];
  let m;
  while ((m = repoRegex.exec(html)) !== null) {
    if (!repos.includes(m[1])) repos.push(m[1]);
  }

  const descs: string[] = [];
  while ((m = descRegex.exec(html)) !== null)
    descs.push(m[1].replace(/<[^>]+>/g, '').trim());

  for (let i = 0; i < repos.length; i++) {
    items.push({
      title: repos[i],
      url: `https://github.com/${repos[i]}`,
      description: descs[i] || '',
      source: 'github',
    });
  }
  return items.slice(0, 25);
}

// ─── Hacker News ───────────────────────────────────────────────────

export async function scrapeHackerNews(): Promise<RawIdea[]> {
  const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
  const ids = (await res.json()) as number[];

  const stories = await Promise.all(
    ids.slice(0, 20).map(async (id) => {
      const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      return (await r.json()) as any;
    }),
  );

  return stories
    .filter((s: any) => s?.url && s?.title)
    .map((s: any) => ({
      title: s.title,
      url: s.url,
      description: `HN score: ${s.score} | comments: ${s.descendants ?? 0}`,
      source: 'hn',
    }));
}

// ─── arXiv (CS.AI) ─────────────────────────────────────────────────

export async function scrapeArxiv(): Promise<RawIdea[]> {
  const res = await fetch('https://rss.arxiv.org/rss/cs.AI');
  const xml = await res.text();
  const items: RawIdea[] = [];

  const entryRe = /<item>([\s\S]*?)<\/item>/g;
  const titleRe = /<title>([\s\S]*?)<\/title>/;
  const linkRe = /<link>([\s\S]*?)<\/link>/;
  const descRe = /<description>([\s\S]*?)<\/description>/;

  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const block = m[1];
    const title = titleRe.exec(block)?.[1]?.replace(/<[^>]+>/g, '').trim();
    const link = linkRe.exec(block)?.[1]?.trim();
    const desc = descRe.exec(block)?.[1]?.replace(/<[^>]+>/g, '').trim().slice(0, 300);
    if (title && link) {
      items.push({ title, url: link, description: desc || '', source: 'arxiv' });
    }
  }
  return items.slice(0, 20);
}

// ─── Product Hunt ──────────────────────────────────────────────────

export async function scrapeProductHunt(): Promise<RawIdea[]> {
  const res = await fetch('https://www.producthunt.com/', {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
  });
  const html = await res.text();

  const jsonMatch = html.match(/window\.__NEXT_DATA__\s*=\s*(\{[\s\S]*?)\s*<\/script>/);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1]) as any;
      const str = JSON.stringify(data);
      const postMatches = str.match(/"name":"([^"]+)","tagline":"([^"]+)","url":"([^"]+)"/g) ?? [];
      if (postMatches.length > 0) {
        return postMatches.slice(0, 20).map((m) => {
          const [, name, tagline, url] = m.match(/"name":"([^"]+)","tagline":"([^"]+)","url":"([^"]+)"/) ?? [];
          return {
            title: name,
            url: `https://www.producthunt.com${url}`,
            description: tagline,
            source: 'producthunt',
          };
        }).filter((i) => i.title);
      }
    } catch { /* fall through */ }
  }

  // Fallback: GraphQL API with token
  const token = process.env.PRODUCTHUNT_TOKEN;
  if (!token) return [];
  const query = `{ posts(first: 20, order: VOTES) { edges { node { name tagline url website } } } }`;
  const r = await fetch('https://api.producthunt.com/v2/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query }),
  });
  const d = (await r.json()) as any;
  return (d?.data?.posts?.edges ?? []).map(({ node }: any) => ({
    title: node.name,
    url: node.website || node.url,
    description: node.tagline,
    source: 'producthunt',
  }));
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

export async function scrapeIndieHackers(): Promise<RawIdea[]> {
  try {
    const res = await fetch('https://www.indiehackers.com/api/products?sort=revenue&limit=20', {
      headers: { 'User-Agent': UA },
    });
    if (res.ok) {
      const data = (await res.json()) as any;
      const products = data?.products ?? data ?? [];
      if (Array.isArray(products) && products.length > 0) {
        return products.slice(0, 20).map((p: any) => ({
          title: p.name || p.id,
          url: `https://www.indiehackers.com/product/${p.id || p.slug}`,
          description: p.description || p.tagline || '',
          source: 'indiehackers',
        }));
      }
    }
  } catch { /* fall through to HTML scraping */ }

  const html = await (
    await fetch('https://www.indiehackers.com/products', { headers: { 'User-Agent': UA } })
  ).text();
  const items: RawIdea[] = [];
  const nameRe = /"name":"([^"]+)"/g;
  const slugRe = /"slug":"([^"]+)"/g;
  const descRe = /"tagline":"([^"]+)"/g;
  const names: string[] = [], slugs: string[] = [], descs: string[] = [];
  let m;
  while ((m = nameRe.exec(html)) !== null) names.push(m[1]);
  while ((m = slugRe.exec(html)) !== null) slugs.push(m[1]);
  while ((m = descRe.exec(html)) !== null) descs.push(m[1]);
  for (let i = 0; i < Math.min(names.length, 20); i++) {
    items.push({
      title: names[i],
      url: `https://www.indiehackers.com/product/${slugs[i] || ''}`,
      description: descs[i] || '',
      source: 'indiehackers',
    });
  }
  return items;
}

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

export async function scrapeReddit(): Promise<RawIdea[]> {
  const items: RawIdea[] = [];
  for (const sub of ['SaaS', 'startups']) {
    try {
      const res = await fetch(`https://www.reddit.com/r/${sub}/top.json?t=week&limit=15`, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      });
      const data = (await res.json()) as any;
      for (const post of data?.data?.children ?? []) {
        const p = post.data;
        if (!p.title) continue;
        const url = p.is_self
          ? `https://www.reddit.com${p.permalink}`
          : p.url || `https://www.reddit.com${p.permalink}`;
        const desc = p.is_self
          ? `${p.selftext?.slice(0, 200) || ''} | r/${sub} | score: ${p.score} | comments: ${p.num_comments}`
          : `r/${sub} | score: ${p.score} | comments: ${p.num_comments}`;
        items.push({ title: p.title, url, description: desc, source: 'reddit' });
      }
    } catch { continue; }
  }
  return items.slice(0, 25);
}

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
  indiehackers: scrapeIndieHackers,
  betalist: scrapeBetaList,
  devto: scrapeDevTo,
  reddit: scrapeReddit,
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

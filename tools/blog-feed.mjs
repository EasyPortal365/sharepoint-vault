// "From the blog" (/blog) for sharepointvault.online, called from tools/build-site.mjs.
//
// The longer articles live on the blog of the team behind the vault. They are NOT
// copied here: the same text on two domains competes with itself in search, and a
// copy would have to be maintained twice. Instead every build reads the blog's own
// RSS feed (_data/blog.json) and lists title, date and the blog's own excerpt,
// each card linking to the original article.
//
// Only the categories listed in _data/blog.json are shown, so product articles
// stay on the blog. When the feed cannot be read, the build goes on: /blog then
// points straight to the blog and CI gets a warning annotation.
//
//   BLOG_FEED_FILE=<path>   read the feed from a local file instead (testing)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const decode = (s) => String(s)
  .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&')
  .trim();
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]) : ''; };

/** Read and filter the feed. Returns { items, cfg } or { items: null, cfg, reason }. */
export async function loadBlog(ROOT) {
  const cfgPath = join(ROOT, '_data/blog.json');
  if (!existsSync(cfgPath)) return { items: null, cfg: null, reason: 'no _data/blog.json' };
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  let xml;
  try {
    if (process.env.BLOG_FEED_FILE) xml = readFileSync(process.env.BLOG_FEED_FILE, 'utf8');
    else {
      const r = await fetch(cfg.feed, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'sharepointvault.online build' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      xml = await r.text();
    }
  } catch (e) {
    return { items: null, cfg, reason: `feed not read (${e.message})` };
  }
  const origin = new URL(cfg.blog).origin + '/';
  const exclude = new Set(cfg.exclude || []);
  const items = [];
  let skipped = 0;
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const url = tag(it, 'link');
    const category = tag(it, 'category').toUpperCase();
    // Only links back to the blog itself, and only the chosen categories.
    if (!url.startsWith(origin) || !cfg.categories[category] || exclude.has(url) || exclude.has(url.replace(/\/$/, '').split('/').pop())) { skipped++; continue; }
    const date = new Date(tag(it, 'pubDate'));
    items.push({ title: tag(it, 'title'), url, excerpt: tag(it, 'description'), category, date: isNaN(date) ? null : date.toISOString().slice(0, 10) });
  }
  if (!items.length) return { items: null, cfg, reason: `feed has no articles in the chosen categories (${skipped} skipped)` };
  items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return { items, cfg, skipped };
}

/** Write /blog and /blog.json (the three newest, for the home page). */
export function buildBlog(c, blog) {
  const vault = [{ name: 'Vault', url: '/' }];
  const self = { name: 'From the blog', url: '/blog' };
  const { items, cfg } = blog;
  const blogHome = cfg ? cfg.blog : null;
  const fmt = (iso) => (iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
  const card = (it) => `<li><a href="${c.esc(it.url)}" target="_blank" rel="noopener">${c.esc(it.title)}</a><span class="sv-sec">${c.esc(fmt(it.date))}</span>${it.excerpt ? `<span class="sv-sum">${c.esc(c.clip(it.excerpt, 260))}</span>` : ''}</li>`;

  let body;
  if (items) {
    const groups = Object.keys(cfg.categories).map((k) => ({ k, label: cfg.categories[k], list: items.filter((it) => it.category === k) })).filter((g) => g.list.length);
    body = `<p class="sv-lead">Longer reads from the team behind the vault: governance, the Microsoft 365 changes that matter for SharePoint, and SharePoint Online in practice. The vault keeps the short <i>symptom → cause → fix</i> notes; these articles connect them into the bigger picture.</p>
<p>${items.length} articles. Each one opens on the blog, where it lives${blogHome ? ` (<a href="${c.esc(blogHome)}" target="_blank" rel="noopener">all posts</a>)` : ''}.</p>
${groups.map((g) => `<h2 id="${g.k.toLowerCase()}">${c.esc(g.label)} <small style="color:var(--soft)">${g.list.length}</small></h2>\n<ul class="sv-cards">${g.list.map(card).join('')}</ul>`).join('\n')}`;
  } else {
    body = `<p class="sv-lead">Longer reads from the team behind the vault: governance, Microsoft 365 news and SharePoint Online in practice.</p>
<p>The list of articles could not be loaded right now.${blogHome ? ` Read them directly on the <a href="${c.esc(blogHome)}" target="_blank" rel="noopener">blog</a>.` : ''}</p>`;
  }
  c.writePage('/blog', {
    title: 'From the blog: SharePoint governance and Microsoft 365 in practice',
    description: items
      ? c.clip(`${items.length} longer articles on SharePoint Online governance and Microsoft 365 changes: ${items.slice(0, 3).map((it) => it.title).join('; ')}.`, 160)
      : 'Longer articles on SharePoint Online governance and Microsoft 365 changes, from the team behind the vault.',
    ld: [c.crumbsLd(vault, self), ...(items ? [{ '@context': 'https://schema.org', '@type': 'ItemList', name: 'From the blog', itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, url: it.url, name: it.title })) }] : [])],
    pagefind: !!items,
    content: `${c.crumbsHtml(vault)}
<h1 id="from-the-blog">From the blog</h1>
${body}`,
  });
  c.extraUrls.push('/blog');
  writeFileSync(join(c.OUT, 'blog.json'), JSON.stringify((items || []).slice(0, 3).map((it) => ({ t: it.title, u: it.url, d: it.date }))));
  return items ? `blog: ${items.length} articles (${blog.skipped} other posts left on the blog)` : `blog: NOT loaded – ${blog.reason}`;
}

// Static site build for sharepointvault.online.
//
//   node tools/build-site.mjs <outDir>        (CI: _site, see .github/workflows/pages.yml)
//
// Every gotcha, guide, snippet, course chapter and script gets its own
// pre-rendered HTML page at a clean URL (`/gotchas/spfx/foo`, `/scripts/cleanup/Get-X`),
// with its own <title>, description, canonical and links to its neighbours, and the
// home page is rendered the same way from README.md. All pages share one "IDE" layout:
// explorer tree of the repo, tabs, outline, status bar, Ctrl K search (tools/theme.css).
//
// Old docsify links (`/#/gotchas/…`) land on the home page, which forwards them to
// the static page of the same article.
//
// Output = every tracked file of the repo + the generated pages + sitemap.xml +
// robots.txt + 404.html. Nothing generated is ever committed: the build runs in
// GitHub Actions.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve, posix } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import Prism from 'prismjs';
import loadLanguages from 'prismjs/components/index.js';
import { buildExtras } from './site-extras.mjs';
import { loadBlog, buildBlog } from './blog-feed.mjs';

const SITE = 'https://sharepointvault.online';
const GH = 'https://github.com/EasyPortal365/sharepoint-vault';
/**
 * Own measuring endpoint: no cookies, no third party. Comes from the repository variable
 * VAULT_API (set in the Pages workflow), never from a file. Without it the site builds
 * fine, just without page views, votes and the "most read" list.
 */
const API = (process.env.VAULT_API || '').replace(/\/+$/, '');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] || '_site');
if (OUT === ROOT) { console.error('outDir must not be the repo root'); process.exit(2); }

const PRISM_LANGS = ['powershell', 'typescript', 'tsx', 'jsx', 'json', 'bash', 'http', 'markup', 'yaml', 'csharp', 'sql', 'css', 'javascript'];
loadLanguages(PRISM_LANGS);
const LANG_ALIAS = { ps1: 'powershell', psm1: 'powershell', pwsh: 'powershell', ps: 'powershell', ts: 'typescript', js: 'javascript', sh: 'bash', shell: 'bash', console: 'bash', xml: 'markup', html: 'markup', svg: 'markup', yml: 'yaml', cs: 'csharp', jsonc: 'json', kql: 'sql', caml: 'markup' };
const CODE_EXT = /\.(ps1|psm1)$/i;
const SKIP = new Set(['README.md', '_sidebar.md']);
const SKIP_DIRS = /^(\.github|tools|node_modules|_site|_data)\//;

// ── helpers ────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plain = (s) => String(s || '').replace(/`([^`]*)`/g, '$1').replace(/\*\*?([^*]+)\*\*?/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => { if (s.length <= n) return s; const cut = s.slice(0, n - 1); return cut.slice(0, Math.max(cut.lastIndexOf(' '), n - 20)).replace(/[,;:\s]+$/, '') + '…'; };
const NO_EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;
// Titles as plain text (lists, <title>, feed, share images): no emoji and no markdown code backticks.
const deEmoji = (s) => String(s).replace(NO_EMOJI, '').replace(/`([^`]*)`/g, '$1').replace(/\s{2,}/g, ' ').trim();
const jsonLd = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
const readJson = (rel, fallback) => (existsSync(join(ROOT, rel)) ? JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) : fallback);

function frontmatter(text) {
  const t = text.replace(/^﻿/, '');
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: t };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else if (/^".*"$/.test(v)) v = v.slice(1, -1).replace(/\\"/g, '"');
    else if (/^'.*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'");
    data[kv[1]] = v;
  }
  return { data, body: t.slice(m[0].length) };
}

/** Repo path → public URL path of its generated page (or null when it gets none). */
function pageUrl(rel) {
  if (/\.md$/i.test(rel)) {
    if (rel === 'README.md') return '/';
    // NOT /INDEX: on a case-insensitive disk INDEX.html would overwrite index.html.
    if (rel === 'INDEX.md') return '/full-index';
    if (/(^|\/)README\.md$/i.test(rel)) return '/' + rel.replace(/README\.md$/i, '');
    return '/' + rel.replace(/\.md$/i, '');
  }
  if (CODE_EXT.test(rel)) return '/' + rel.replace(CODE_EXT, '');
  return null;
}
/** URL path → output file (GitHub Pages serves /a/b from a/b.html and /a/ from a/index.html). */
const outFile = (url) => (url.endsWith('/') ? url + 'index.html' : url + '.html').replace(/^\//, '');
/** Share image of a page (rendered by tools/build-og.mjs). */
const ogPath = (url) => '/og' + (url.endsWith('/') ? url + 'index' : url) + '.png';

function slugger() {
  const seen = {};
  return (text) => {
    let s = String(text).toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;|&#\d+;/g, '')
      .replace(/[ -⁯⸀-⹿\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g, '').trim().replace(/\s+/g, '-');
    if (!s) s = 'section';
    if (seen[s] !== undefined) { seen[s]++; s = `${s}-${seen[s]}`; } else seen[s] = 0;
    return s;
  };
}

function highlight(code, lang) {
  const l = LANG_ALIAS[(lang || '').toLowerCase()] || (lang || '').toLowerCase();
  if (l && Prism.languages[l]) return { html: Prism.highlight(code, Prism.languages[l], l), lang: l };
  return { html: esc(code), lang: l || 'text' };
}

// ── inventory ──────────────────────────────────────────────────────────────
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
const trackedSet = new Set(tracked);
const git = (args) => { try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { return ''; } };

/** Most recent commit date per file — one git call, not one per file. */
const gitDate = {};
{
  let cur = null;
  for (const line of git(['log', '--format=%x01%cI', '--name-only']).split('\n')) {
    if (line.startsWith('\x01')) { cur = line.slice(1).trim(); continue; }
    const f = line.trim();
    if (f && cur && !gitDate[f]) gitDate[f] = cur;
  }
}
/** Date each file was first added (newest-first log, so the last hit is the oldest add). Renamed files keep no add date. */
const gitAdded = {};
{
  let cur = null;
  for (const line of git(['log', '--diff-filter=A', '--format=%x01%cI', '--name-only']).split('\n')) {
    if (line.startsWith('\x01')) { cur = line.slice(1).trim(); continue; }
    const f = line.trim();
    if (f && cur) gitAdded[f] = cur;
  }
}
/** The commit this build is made from (status bar) and the last few (home). */
const recentCommits = git(['log', '-5', '--format=%h%x09%H%x09%cI%x09%s']).trim().split('\n').filter(Boolean)
  .map((l) => { const [h, full, d, ...s] = l.split('\t'); return { h, full, d, s: s.join('\t') }; });
const HEAD = recentCommits[0] || { h: '', full: '', d: '' };
/** Commits per week, last 26 weeks (home sparkline). */
const weekly = (() => {
  const w = new Array(26).fill(0);
  const now = Date.now();
  for (const d of git(['log', '--format=%cI']).split('\n').filter(Boolean)) {
    const i = Math.floor((now - Date.parse(d)) / 604800000);
    if (i >= 0 && i < 26) w[25 - i]++;
  }
  return w;
})();

const THEME = readFileSync(join(ROOT, 'tools/theme.css'), 'utf8');
const HEAD_FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">';
const SV_INTRO = readJson('_data/script-intros.json', { scripts: {} }).scripts || {};

const pages = [];
for (const rel of tracked) {
  if (SKIP_DIRS.test(rel)) continue;
  const base = rel.split('/').pop();
  if (/\.md$/i.test(rel)) {
    if (SKIP.has(rel)) continue; // README.md = home, built separately
    if (base.startsWith('_')) continue;
    if (rel.startsWith('templates/')) continue; // section is planned and hidden until it has content
  } else if (!CODE_EXT.test(rel)) continue;
  pages.push({ rel, url: pageUrl(rel) });
}
const byRel = new Map(pages.map((p) => [p.rel, p]));
{
  const seen = new Map();
  for (const p of pages) {
    if (seen.has(p.url)) throw new Error(`URL collision ${p.url}: ${seen.get(p.url)} vs ${p.rel}`);
    seen.set(p.url, p.rel);
  }
}

// ── link rewriting ─────────────────────────────────────────────────────────
const warnings = [];
function rewrite(href, fromRel) {
  if (!href) return { href };
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return { href };
  const hashAt = href.search(/[?#]/);
  let path = hashAt === -1 ? href : href.slice(0, hashAt);
  let rest = hashAt === -1 ? '' : href.slice(hashAt);
  rest = rest.replace(/^\?id=([^&]+)/, '#$1'); // old docsify heading anchors
  if (!path) return { href: rest };
  let decoded = path;
  try { decoded = decodeURIComponent(path); } catch { /* keep */ }
  const target = decoded.startsWith('/')
    ? posix.normalize(decoded.slice(1))
    : posix.normalize(posix.join(posix.dirname(fromRel), decoded));
  const isDir = decoded.endsWith('/') || target === '.' || (!/\.[a-z0-9]+$/i.test(target) && trackedSet.has(posix.join(target, 'README.md')));
  if (isDir) {
    const t = target === '.' ? '' : target.replace(/\/$/, '');
    if (!t || trackedSet.has(`${t}/README.md`)) return { href: (t ? `/${t}/` : '/') + rest };
    // A category folder without its own README (gotchas/rest-api/) lives as a heading
    // in the nearest parent README.
    const up = t.split('/');
    const last = up.pop();
    while (up.length && !trackedSet.has(`${up.join('/')}/README.md`)) up.pop();
    return { href: (up.length ? `/${up.join('/')}/` : '/') + (rest || `#${last}`) };
  }
  const page = byRel.get(target);
  if (page) return { href: page.url + rest };
  if (target === 'README.md') return { href: '/' + rest };
  if (/\.md$/i.test(target) && !trackedSet.has(target)) warnings.push(`${fromRel}: link to missing ${target}`);
  return { href: '/' + target.split('/').map(encodeURIComponent).join('/') + rest };
}
/** docsify-era link config in the title slot: [x](url ':ignore :target=_blank'). */
function linkTitle(title) {
  if (!title || title[0] !== ':') return { title, blank: false };
  return { title: null, blank: /:target=_blank/.test(title) };
}
const rewriteHtmlAttrs = (html, fromRel) =>
  html.replace(/\b(href|src)="([^"]*)"/g, (all, attr, v) => `${attr}="${esc(rewrite(v, fromRel).href).replace(/&amp;/g, '&')}"`);

/** A gotcha's sections get a coloured label: symptom / why / fix. */
const h2Kind = (t) => (/^symptoms?\b/i.test(t) ? 'k-symptom' : /^(why|cause|root cause|what happens)\b/i.test(t) ? 'k-why' : /^(fix|the fix|workaround|solution|how to fix)\b/i.test(t) ? 'k-fix' : '');

/** The bilingual "Bottom line / Ve zkratce" quote under the H1 becomes a box with EN / CZ tabs (CSS only). */
function tldr(html) {
  return html.replace(/<blockquote>\s*<p><strong>Bottom line\.<\/strong>\s*([\s\S]*?)<\/p>\s*<p><strong>Ve zkratce\.<\/strong>\s*([\s\S]*?)<\/p>\s*([\s\S]*?)<\/blockquote>/,
    (all, en, cz, more) => `<div class="tldr"><input type="radio" name="sv-tldr" id="tl-en" checked aria-label="English"><input type="radio" name="sv-tldr" id="tl-cz" aria-label="Česky"><div class="th"><label for="tl-en">Bottom line · EN</label><label for="tl-cz">Ve zkratce · CZ</label></div><div class="pn pn-en"><p>${en}</p></div><div class="pn pn-cz" lang="cs"><p>${cz}</p>${more}</div></div>`);
}

function render(md, fromRel) {
  const slug = slugger();
  const toc = [];
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading(text, level, raw) {
        const id = slug(plain(raw));
        if (level === 2) toc.push({ id, text: plain(raw) });
        const k = level === 2 ? h2Kind(plain(raw)) : '';
        return `<h${level} id="${id}"${k ? ` class="${k}"` : ''}><a href="#${id}" class="anchor"><span>${text}</span></a></h${level}>\n`;
      },
      link(href, title, text) {
        const t = linkTitle(title);
        const h = rewrite(href, fromRel).href;
        const ext = /^https?:/i.test(h);
        return `<a href="${esc(h)}"${t.title ? ` title="${esc(t.title)}"` : ''}${t.blank || ext ? ' target="_blank" rel="noopener"' : ''}>${text}</a>`;
      },
      image(href, title, text) {
        const t = linkTitle(title);
        return `<img src="${esc(rewrite(href, fromRel).href)}" alt="${esc(text)}"${t.title ? ` title="${esc(t.title)}"` : ''} loading="lazy">`;
      },
      code(code, info) {
        const h = highlight(code, (info || '').split(/\s+/)[0]);
        return `<pre data-lang="${esc(h.lang)}"><code class="lang-${esc(h.lang)}">${h.html}</code></pre>\n`;
      },
      html(html) { return rewriteHtmlAttrs(typeof html === 'string' ? html : html.text, fromRel); },
    },
  });
  return { html: tldr(marked.parse(md)), toc };
}

// Pass 1: metadata (titles are needed for the tree, related lists and breadcrumbs).
for (const p of pages) {
  const raw = readFileSync(join(ROOT, p.rel), 'utf8');
  if (CODE_EXT.test(p.rel)) {
    const name = p.rel.split('/').pop();
    const syn = (raw.match(/\.SYNOPSIS\s*\r?\n([\s\S]*?)(?:\r?\n\s*\r?\n|\r?\n\s*\.[A-Z])/) || [, ''])[1];
    p.kind = 'script'; p.raw = raw; p.title = name;
    p.summary = plain(syn) || `PowerShell script ${name} from the SharePoint Vault.`;
    p.lang = 'en';
  } else {
    const { data, body } = frontmatter(raw);
    const h1 = (body.match(/^#\s+(.+)$/m) || [, ''])[1];
    p.kind = /README\.md$/i.test(p.rel) ? 'index' : 'article';
    p.data = data; p.body = body;
    p.title = data.title || plain(h1) || p.rel;
    p.h1 = plain(h1);
    p.summary = plain(data.summary || '');
    if (!p.summary) {
      const firstPara = body.replace(/^#.*$/m, '').split(/\r?\n\s*\r?\n/).map((x) => x.trim()).find((x) => x && !/^[#|<!-]/.test(x) && !/^---/.test(x));
      p.summary = plain((firstPara || '').replace(/^>\s?/gm, ''));
    }
    p.lang = data.lang === 'cs' ? 'cs' : 'en';
  }
}
const sectionTitles = {};
for (const p of pages) if (p.kind === 'index' && p.rel.split('/').length === 2) sectionTitles[p.rel.split('/')[0]] = deEmoji(p.h1 || p.title);
const shortTitle = (q) => deEmoji(q.data && q.data['short-title'] ? q.data['short-title'] : q.title);

// ── tags (needed by the tree before the pages are written) ─────────────────
const tagSlug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const tagMap = new Map();
for (const p of pages) {
  if (p.kind !== 'article' || !Array.isArray(p.data.tags)) continue;
  for (const t of p.data.tags) {
    const s = tagSlug(t);
    if (!s) continue;
    if (!tagMap.has(s)) tagMap.set(s, { name: t, items: [] });
    tagMap.get(s).items.push(p);
  }
}
const tagsSorted = [...tagMap.entries()].sort((a, b) => b[1].items.length - a[1].items.length || a[0].localeCompare(b[0]));
// Only tags with 3+ articles get a page: a page with one or two links is thin content.
const tagPages = tagsSorted.filter(([, v]) => v.items.length >= 3);
const errorCount = (readJson('_data/errors.json', []) || []).length;

// The blog list is read before the pages: every page shows the newest posts in its side panel.
const blog = await loadBlog(ROOT);

// ── explorer tree ──────────────────────────────────────────────────────────
const fileIcon = (name) => (/\.ps1$/i.test(name) ? '<span class="ic ic-ps">PS</span>' : '<span class="ic ic-md">M↓</span>');
const FOLDER = '<span class="ic ic-fd">▰</span>';
const TW = '<span class="tw">▶</span>';
const TREE_SECTIONS = ['gotchas', 'guides', 'scripts', 'snippets', 'course', 'talks', 'resources'];
const treeModel = TREE_SECTIONS.filter((s) => pages.some((p) => p.rel.startsWith(s + '/'))).map((s) => {
  const inSec = pages.filter((p) => p.rel.startsWith(s + '/'));
  const index = inSec.find((p) => p.rel === `${s}/README.md`);
  const leaves = inSec.filter((p) => p !== index && p.kind !== 'index');
  const subs = new Map();
  const direct = [];
  for (const p of leaves) {
    const parts = p.rel.split('/');
    if (parts.length > 2) { const k = parts[1]; if (!subs.has(k)) subs.set(k, []); subs.get(k).push(p); } else direct.push(p);
  }
  const byName = (a, b) => a.rel.localeCompare(b.rel);
  return { s, index, direct: direct.sort(byName), subs: [...subs.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([k, v]) => [k, v.sort(byName)]), count: leaves.length };
});
// ~380 leaves on every page: kept lean (icon and indent come from the class, the
// readable title only on the selected one).
function leaf(p, d, url) {
  const name = p.rel.split('/').pop();
  const sel = p.url === url;
  return `<a class="tr lf l${d === 2.4 ? 2 : 1}${/\.ps1$/i.test(name) ? ' ps' : ''}${sel ? ' sel' : ''}" href="${p.url}"${sel ? ` title="${esc(shortTitle(p))}"` : ''}>${esc(name)}</a>`;
}
function treeHtml(url, rel) {
  const sec = rel ? rel.split('/')[0] : '';
  const sub = rel && rel.split('/').length > 2 ? rel.split('/')[1] : '';
  const rows = [];
  rows.push('<div class="ide-h"><span>Explorer</span><span>sharepoint-vault</span></div>');
  for (const t of treeModel) {
    const open = t.s === sec;
    rows.push(`<details${open ? ' open' : ''}><summary class="tr" style="--d:0">${TW}${FOLDER}<span class="nm">${t.s}/</span><span class="c">${t.s === 'course' ? 'CZ · ' : ''}${t.count || ''}</span></summary>`);
    if (t.index) rows.push(leaf(t.index, 1.4, url));
    for (const [k, list] of t.subs) {
      rows.push(`<details${open && k === sub ? ' open' : ''}><summary class="tr" style="--d:1">${TW}${FOLDER}<span class="nm">${esc(k)}</span><span class="c">${list.length}</span></summary>${list.map((p) => leaf(p, 2.4, url)).join('')}</details>`);
    }
    rows.push(t.direct.map((p) => leaf(p, 1.4, url)).join(''));
    rows.push('</details>');
  }
  const root = [['README.md', '/'], ['INDEX.md', '/full-index'], ['CONTRIBUTING.md', '/CONTRIBUTING']];
  for (const [n, u] of root) rows.push(`<a class="tr${u === url ? ' sel' : ''}" style="--d:0.85" href="${u}">${fileIcon(n)}<span class="nm">${n}</span></a>`);
  rows.push('<div class="ide-h"><span>Tools</span></div>');
  const tools = [
    ['/start/', '⇢', 'start-here', 'reading paths'],
    ['/errors', '⚠', 'errors.log', errorCount],
    ['/tags/', '#', 'tags', tagPages.length],
    ['/whats-new', '◷', 'whats-new', ''],
    ['/blog', '✎', 'blog', blog.items ? blog.items.length : ''],
    ['/search', '⌕', 'search', 'Ctrl K'],
  ];
  for (const [u, i, n, c] of tools) rows.push(`<a class="tr${u === url ? ' sel' : ''}" style="--d:0" href="${u}"><span class="ic ic-ex">${i}</span><span class="nm">${n}</span><span class="c">${c}</span></a>`);
  return rows.join('\n');
}

// ── page template ──────────────────────────────────────────────────────────
const ICONS = {
  files: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.4-4.4"/>',
  errors: '<path d="M12 3.5l9 16H3z"/><path d="M12 10v4.2"/><path d="M12 17.2h.01"/>',
  tags: '<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>',
  start: '<path d="M5 21V4h11.5l-2 4 2 4H5"/>',
  news: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  blog: '<path d="M4 20h4.5L19.5 9 15 4.5 4 15.5z"/><path d="M13 6.5 17.5 11"/>',
  theme: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`;
function actBar(url) {
  const a = (href, k, tip, extra = '') => `<a href="${href}" data-tip="${tip}" aria-label="${tip}"${extra}${href !== '#' && (url === href) ? ' class="on"' : ''}>${svg(k)}</a>`;
  return `<nav class="ide-act" aria-label="Tools">
${a('#', 'files', 'Explorer', ' data-tree class="on"').replace(' class="on" class="on"', ' class="on"')}
${a('/search', 'search', 'Search · Ctrl K', ' data-pal')}
${a('/errors', 'errors', 'Error lookup')}
${a('/tags/', 'tags', 'Tags')}
${a('/start/', 'start', 'Start here')}
${a('/whats-new', 'news', "What's new")}
${a('/blog', 'blog', 'From the blog')}
<a href="#" data-theme-toggle data-tip="Light / dark" aria-label="Switch light / dark" style="margin-top:auto;margin-bottom:10px">${svg('theme')}</a>
</nav>`;
}

/** „Was this helpful?" + a way to ask. Votes go to our own endpoint (no cookies, no third party). */
const discussUrl = (title, url) => `${GH}/discussions/new?category=q-a&title=${encodeURIComponent('Re: ' + deEmoji(title))}&body=${encodeURIComponent(`About ${SITE}${url}\n\n`)}`;
const helpful = (title, url) => `<div class="sv-helpful" data-pagefind-ignore data-svurl="${esc(url)}"><b>Was this helpful?</b><button type="button" class="sv-btn" data-svvote="up">👍 Yes</button><button type="button" class="sv-btn" data-svvote="down">👎 No</button><a class="sv-discuss" href="${esc(discussUrl(title, url))}" target="_blank" rel="noopener">ask or add your experience on GitHub →</a><span class="sv-helpful-msg" hidden></span></div>`;

const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');
function blogSide(n) {
  if (!blog.items) return '';
  return `<div class="grp"><div class="ide-h"><span>From the blog</span><a href="/blog" style="color:var(--violet);text-decoration:none">all ${blog.items.length} →</a></div>${blog.items.slice(0, n).map((b) => `<a class="it" href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.title)}<small>${esc(fmtDay(b.date))} · ${esc(b.category.toLowerCase())} ↗</small></a>`).join('')}</div>`;
}

/** Client side: page view beacon, votes, palette (Ctrl K), explorer, theme, outline, stars. */
const UI_JS = `<script>
(function () {
  var API = '${API ? API + '/visit' : ''}', d = document, b = d.body;
  function send(o) { if (!API) { return; } try { var s = JSON.stringify(o); if (navigator.sendBeacon && navigator.sendBeacon(API, s)) { return; } fetch(API, { method: 'POST', body: s, keepalive: true, mode: 'no-cors' }); } catch (e) {} }
  function ls(k, v) { try { if (v === undefined) { return localStorage.getItem(k); } localStorage.setItem(k, v); } catch (e) { return null; } }
  if (!(location.pathname === '/' && /^#\\//.test(location.hash))) { send({ p: location.pathname, r: d.referrer, w: window.innerWidth }); }
  /* votes */
  var box = d.querySelector('.sv-helpful');
  if (box) {
    var key = 'sv-vote:' + location.pathname, prev = ls(key), msg = box.querySelector('.sv-helpful-msg');
    var thank = function (v) {
      msg.hidden = false;
      msg.innerHTML = v === 'up'
        ? 'Thanks! If it saved you time, a <a href="${GH}" target="_blank" rel="noopener">star on GitHub</a> helps other SharePoint people find the vault.'
        : 'Sorry about that. What was missing or wrong? <a href="' + box.querySelector('.sv-discuss').href + '" target="_blank" rel="noopener">Tell us on GitHub</a> and we will fix the article.';
      box.querySelectorAll('[data-svvote]').forEach(function (x) { x.disabled = true; x.style.opacity = x.getAttribute('data-svvote') === v ? 1 : .45; });
    };
    if (prev === 'up' || prev === 'down') { thank(prev); }
    box.addEventListener('click', function (e) {
      var x = e.target.closest ? e.target.closest('[data-svvote]') : null;
      if (!x || x.disabled) { return; }
      var v = x.getAttribute('data-svvote');
      send({ p: location.pathname, w: window.innerWidth, f: v }); ls(key, v); thank(v);
    });
  }
  /* copy button on every code block */
  d.querySelectorAll('.markdown-section pre > code').forEach(function (code) {
    var pre = code.parentNode;
    if (pre.querySelector('.sv-copy')) { return; }
    var bt = d.createElement('button');
    bt.type = 'button'; bt.className = 'sv-copy'; bt.textContent = '⧉ copy';
    bt.addEventListener('click', function () {
      if (!navigator.clipboard) { return; }
      navigator.clipboard.writeText(code.innerText).then(function () { bt.textContent = '✓ copied'; setTimeout(function () { bt.textContent = '⧉ copy'; }, 1600); });
    });
    pre.appendChild(bt);
  });
  /* theme */
  d.querySelectorAll('[data-theme-toggle]').forEach(function (t) {
    t.addEventListener('click', function (e) {
      e.preventDefault();
      var n = d.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      d.documentElement.setAttribute('data-theme', n); ls('sv-theme', n);
    });
  });
  /* explorer: hide on desktop, slide in on a phone */
  var narrow = function () { return window.matchMedia('(max-width:860px)').matches; };
  if (ls('sv-tree') === 'hidden') { b.classList.add('tree-hidden'); var ta = d.querySelector('[data-tree]'); if (ta) { ta.classList.remove('on'); } }
  var toggleTree = function (e) {
    e.preventDefault();
    if (narrow()) { b.classList.toggle('tree-open'); return; }
    var h = b.classList.toggle('tree-hidden'); ls('sv-tree', h ? 'hidden' : 'shown');
    var ta2 = d.querySelector('[data-tree]'); if (ta2) { ta2.classList.toggle('on', !h); }
  };
  d.querySelectorAll('[data-tree], .ide-burger').forEach(function (t) { t.addEventListener('click', toggleTree); });
  d.addEventListener('click', function (e) { if (b.classList.contains('tree-open') && !e.target.closest('.ide-tree, .ide-burger')) { b.classList.remove('tree-open'); } });
  var tree = d.querySelector('.ide-tree'), sel = tree && tree.querySelector('.sel');
  if (tree && sel) { tree.scrollTop = Math.max(0, sel.offsetTop - tree.clientHeight / 2); }
  /* outline follows the reading position */
  var ol = d.querySelectorAll('.ol a');
  if (ol.length && 'IntersectionObserver' in window) {
    var map = {}; ol.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) { if (en.isIntersecting && map[en.target.id]) { ol.forEach(function (a) { a.classList.remove('on'); }); map[en.target.id].classList.add('on'); } });
    }, { rootMargin: '-80px 0px -70% 0px' });
    Object.keys(map).forEach(function (id) { var h = d.getElementById(id); if (h) { io.observe(h); } });
  }
  /* line numbers: one per block (paragraph, heading, list item, code, table), drawn in the
     left padding. A click copies a link to that block (#L12, or the heading's own id).
     The number sits in data-n and CSS draws it, so it is never part of the page text:
     search engines, AI agents and the search index read the article without it. */
  var art = d.getElementById('main');
  if (art && art.classList.contains('markdown-section')) {
    var blocks = [];
    Array.prototype.forEach.call(art.children, function (el) {
      if (/^(SCRIPT|STYLE|LINK)$/.test(el.tagName) || el.hidden) { return; }
      if (/^(UL|OL)$/.test(el.tagName)) { Array.prototype.forEach.call(el.children, function (li) { if (li.tagName === 'LI') { blocks.push(li); } }); }
      else { blocks.push(el); }
    });
    blocks = blocks.filter(function (el) { return el.getClientRects().length > 0; });
    if (blocks.length) {
      var gut = d.createElement('div'); gut.className = 'ln-gut'; gut.setAttribute('aria-hidden', 'true');
      blocks.forEach(function (el, i) {
        if (!el.id) { el.id = 'L' + (i + 1); }
        var a = d.createElement('a'); a.className = 'ln'; a.href = '#' + el.id; a.tabIndex = -1;
        a.setAttribute('data-n', i + 1); a.title = 'Copy link to line ' + (i + 1);
        gut.appendChild(a);
      });
      art.appendChild(gut);
      var lns = gut.children;
      var place = function () { var t0 = art.getBoundingClientRect().top; blocks.forEach(function (el, i) { lns[i].style.top = Math.round(el.getBoundingClientRect().top - t0) + 'px'; }); };
      place();
      window.addEventListener('load', place);
      if (window.ResizeObserver) { new ResizeObserver(place).observe(art); }
      var flash = function (el, i) {
        el.classList.add('ln-hit'); if (lns[i]) { lns[i].classList.add('on'); }
        setTimeout(function () { el.classList.remove('ln-hit'); if (lns[i]) { lns[i].classList.remove('on'); } }, 1800);
      };
      gut.addEventListener('click', function (e) {
        var a = e.target.closest('.ln'); if (!a) { return; }
        e.preventDefault();
        var i = Array.prototype.indexOf.call(lns, a), h = a.getAttribute('href');
        try { history.replaceState(null, '', h); } catch (x) {}
        if (navigator.clipboard) { navigator.clipboard.writeText(location.origin + location.pathname + h).catch(function () {}); }
        a.classList.add('copied'); setTimeout(function () { a.classList.remove('copied'); }, 1400);
        flash(blocks[i], i);
      });
      // #L12 means "the 12th block", also when that block is a heading with its own id
      var toLine = function () {
        if (!/^#L[0-9]+$/.test(location.hash)) { return; }
        var hi = parseInt(location.hash.slice(2), 10) - 1;
        if (blocks[hi]) { setTimeout(function () { blocks[hi].scrollIntoView({ block: 'center' }); flash(blocks[hi], hi); }, 60); }
      };
      toLine();
      window.addEventListener('hashchange', toLine);
    }
  }
  /* bottom line language: remember CZ */
  var cz = d.getElementById('tl-cz'), en = d.getElementById('tl-en');
  if (cz && en) {
    if (ls('sv-lang') === 'cz') { cz.checked = true; }
    cz.addEventListener('change', function () { ls('sv-lang', 'cz'); });
    en.addEventListener('change', function () { ls('sv-lang', 'en'); });
  }
  /* search: one compact row per hit, over the Pagefind API (loaded on first use).
     The palette (Ctrl K, /, the search box) and the /search page share it. */
  var pf = null;
  function loadPf() {
    // filters() first: only then does every search return the per-kind counts for the chips
    if (!pf) { pf = import('/pagefind/pagefind.js').then(function (m) { return Promise.resolve(m.options({ excerptLength: 26 })).then(function () { return m.filters(); }).then(function () { return m; }); }); }
    return pf;
  }
  var KC = { Gotchas: 'g', Guides: 'gd', Scripts: 'sc', Snippets: 'sn', Course: 'co', Errors: 'er' };
  var ORDER = ['Gotchas', 'Guides', 'Scripts', 'Snippets', 'Errors', 'Course', 'Talks', 'Resources', 'Pages'];
  function hx(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function clean(u) {
    var i = u.indexOf('#'), a = i < 0 ? u : u.slice(0, i), f = i < 0 ? '' : u.slice(i);
    if (a.slice(-5) === '.html') { a = a.slice(0, -5); }
    if (a.slice(-6) === '/index') { a = a.slice(0, -5); }
    return a + f;
  }
  function mountSearch(root, inPal, onQuery) {
    root.innerHTML = '<div class="sx-in"><span aria-hidden="true">⌕</span><input type="search" placeholder="Search gotchas, error messages, scripts…" aria-label="Search the vault" autocomplete="off" spellcheck="false">' + (inPal ? '<kbd>Esc</kbd>' : '') + '</div><div class="sx-f"></div><div class="sx-n" aria-live="polite"></div><div class="sx-body"><ol class="sx-r"></ol><button type="button" class="sx-more" hidden></button></div>';
    var inp = root.querySelector('input'), fl = root.querySelector('.sx-f'), cnt = root.querySelector('.sx-n'), list = root.querySelector('.sx-r'), more = root.querySelector('.sx-more');
    var seq = 0, kind = '', hits = [], shown = 0, act = -1, timer = null;
    function hint() { cnt.innerHTML = '<span>Try</span><button type="button" data-q="412">412</button><button type="button" data-q="list view threshold">list view threshold</button><button type="button" data-q="Sites.Selected">Sites.Selected</button><button type="button" data-q="PnP PowerShell">PnP PowerShell</button>'; }
    function hitsEls() { return list.querySelectorAll('.sx-hit'); }
    function setAct(i) {
      var as = hitsEls(); if (!as.length) { return; }
      act = Math.max(0, Math.min(i, as.length - 1));
      as.forEach(function (a, j) { a.classList.toggle('on', j === act); });
      if (i !== 0) { as[act].scrollIntoView({ block: 'nearest' }); }
    }
    function row(dt) {
      var k = (dt.filters && dt.filters.kind && dt.filters.kind[0]) || 'Pages', mt = dt.meta || {};
      var subs = (dt.sub_results || []).filter(function (s) { return s.url.indexOf('#') > -1 && s.title && String(mt.title || '').indexOf(s.title) !== 0; }).slice(0, 3);
      return '<li><a class="sx-hit" href="' + hx(clean(dt.url)) + '"><span class="sx-k ' + (KC[k] || '') + '">' + hx(k === 'Course' ? 'Course' : k.replace(/s$/, '')) + '</span><span class="sx-t">' + hx(mt.title || clean(dt.url)) + '</span><span class="sx-p">' + hx(mt.path || '') + '</span><span class="sx-x">' + (dt.excerpt || '') + '</span></a>'
        + (subs.length ? '<span class="sx-s">' + subs.map(function (s) { return '<a href="' + hx(clean(s.url)) + '">↳ ' + hx(s.title) + '</a>'; }).join('') + '</span>' : '') + '</li>';
    }
    function page() {
      var my = seq, batch = hits.slice(shown, shown + 12);
      shown += batch.length;
      more.hidden = shown >= hits.length;
      more.textContent = 'Show ' + Math.min(12, hits.length - shown) + ' more · ' + (hits.length - shown) + ' left';
      return Promise.all(batch.map(function (x) { return x.data(); })).then(function (ds) {
        if (my !== seq) { return; }
        list.insertAdjacentHTML('beforeend', ds.map(row).join(''));
        if (act < 0) { setAct(0); }
      });
    }
    function run() {
      var q = inp.value.trim(), my = ++seq;
      if (onQuery) { onQuery(q); }
      if (!q) { hits = []; list.innerHTML = ''; fl.innerHTML = ''; more.hidden = true; hint(); return; }
      loadPf().then(function (m) { return m.search(q, kind ? { filters: { kind: kind } } : {}); }).then(function (res) {
        if (my !== seq || !res) { return; }
        var tf = (res.totalFilters && res.totalFilters.kind) || {}, total = res.unfilteredResultCount || res.results.length;
        if (kind && !res.results.length && total) { kind = ''; run(); return; }
        hits = res.results; shown = 0; act = -1; list.innerHTML = '';
        fl.innerHTML = total ? '<button type="button" data-k=""' + (kind ? '' : ' class="on"') + '>All <small>' + total + '</small></button>' + ORDER.filter(function (k) { return tf[k]; }).map(function (k) { return '<button type="button" data-k="' + k + '"' + (kind === k ? ' class="on"' : '') + '>' + k + ' <small>' + tf[k] + '</small></button>'; }).join('') : '';
        var n = hits.length;
        cnt.innerHTML = n ? '<span><b>' + n + '</b> ' + (n === 1 ? 'result' : 'results') + (kind ? ' in ' + hx(kind.toLowerCase()) : '') + '</span><span class="sx-keys">↑↓ move · Enter open' + (inPal ? ' · Esc close' : '') + '</span>'
          : '<span>Nothing found for <b>' + hx(q) + '</b>. Try fewer words, or the <a href="/errors">error lookup</a>.</span>';
        more.hidden = true;
        if (n) { page(); }
      }).catch(function () {
        if (my !== seq) { return; }
        cnt.innerHTML = '<span>Search is not available right now. Try the <a href="/full-index">full index</a>.</span>';
      });
    }
    inp.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 120); });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (act >= hitsEls().length - 1 && !more.hidden) { page().then(function () { setAct(act + 1); }); } else { setAct(act + 1); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setAct(act - 1); }
      else if (e.key === 'Enter') { var a = hitsEls()[act]; if (a) { e.preventDefault(); location.href = a.href; } }
    });
    fl.addEventListener('click', function (e) { var t = e.target.closest('[data-k]'); if (!t) { return; } kind = t.getAttribute('data-k'); run(); inp.focus(); });
    cnt.addEventListener('click', function (e) { var t = e.target.closest('[data-q]'); if (!t) { return; } inp.value = t.getAttribute('data-q'); run(); inp.focus(); });
    list.addEventListener('mousemove', function (e) { var a = e.target.closest('.sx-hit'); if (!a) { return; } var as = Array.prototype.indexOf.call(hitsEls(), a); if (as !== act) { setAct(as); } });
    more.addEventListener('click', function () { page(); });
    hint();
    return { input: inp, set: function (q) { inp.value = q; run(); } };
  }
  var spg = d.getElementById('sv-pf');
  if (spg) {
    var sp = mountSearch(spg, false, function (q) { try { history.replaceState(null, '', q ? '/search?q=' + encodeURIComponent(q) : '/search'); } catch (e) {} });
    var q0 = new URLSearchParams(location.search).get('q');
    if (q0) { sp.set(q0); }
    sp.input.focus();
  }
  var pal = d.getElementById('pal'), sx = null;
  var openPal = function () {
    pal.classList.add('open');
    if (!sx) { sx = mountSearch(d.getElementById('pal-ui'), true, null); loadPf().catch(function () {}); }
    setTimeout(function () { sx.input.focus(); sx.input.select(); }, 30);
  };
  var closePal = function () { pal.classList.remove('open'); };
  if (pal) {
    d.querySelectorAll('[data-pal]').forEach(function (t) { t.addEventListener('click', function (e) { if (location.pathname === '/search') { return; } e.preventDefault(); openPal(); }); });
    pal.addEventListener('click', function (e) { if (e.target === pal) { closePal(); } });
    d.addEventListener('keydown', function (e) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((d.activeElement || {}).tagName || '');
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); pal.classList.contains('open') ? closePal() : openPal(); }
      else if (e.key === '/' && !typing && location.pathname !== '/search') { e.preventDefault(); openPal(); }
      else if (e.key === 'Escape') { closePal(); b.classList.remove('tree-open'); }
    });
  }
  /* stars (GitHub API, cached 30 min) */
  var sn = d.querySelector('.ide-star .n');
  if (sn) {
    var c = null; try { c = JSON.parse(ls('sv-stars') || 'null'); } catch (e) {}
    if (c && Date.now() - c.t < 1800000) { sn.textContent = c.n; }
    else { fetch('https://api.github.com/repos/EasyPortal365/sharepoint-vault').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j && typeof j.stargazers_count === 'number') { sn.textContent = j.stargazers_count; ls('sv-stars', JSON.stringify({ t: Date.now(), n: j.stargazers_count })); } }).catch(function () {}); }
  }
})();
</script>`;

const tabIcon = (name) => (/\.ps1$/i.test(name) ? '<span class="ic ic-ps" style="color:var(--blue)">PS</span>' : /\.(log|json)$|^tags$|^search$|^start-here$|^whats-new$|^blog$|^404$/.test(name) ? '<span style="color:var(--violet)">◆</span>' : '<span style="color:var(--accent)">M↓</span>');
/** Path shown in the crumb bar and the tab name, from the repo path or the URL. */
function crumbFor(url, rel) {
  const parts = rel ? rel.split('/') : url.replace(/^\/|\/$/g, '').split('/').filter(Boolean);
  const out = [`<a href="/">sharepoint-vault</a>`];
  let acc = '';
  parts.forEach((seg, i) => {
    acc += '/' + seg;
    const last = i === parts.length - 1;
    const link = !last && rel && trackedSet.has(acc.slice(1) + '/README.md') ? acc + '/' : (!last && !rel ? acc + '/' : null);
    out.push(link ? `<a href="${link}">${esc(seg)}</a>` : `<span${last ? ' style="color:var(--soft)"' : ''}>${esc(seg)}</span>`);
  });
  return out.join('<span class="sep">›</span>');
}

// Search results show what kind of page a hit is and where it lives (Pagefind filter + meta).
const SEARCH_KINDS = { gotchas: 'Gotchas', guides: 'Guides', scripts: 'Scripts', snippets: 'Snippets', course: 'Course', talks: 'Talks', resources: 'Resources' };
function searchKind(url, rel) {
  if (rel && SEARCH_KINDS[rel.split('/')[0]] && rel.includes('/')) return SEARCH_KINDS[rel.split('/')[0]];
  if (url.startsWith('/errors')) return 'Errors';
  return 'Pages';
}
function searchPath(url, rel) {
  if (rel) return rel.includes('/') ? rel.split('/').slice(0, -1).join('/') : 'vault';
  return url.replace(/^\/|\/$/g, '').split('/').slice(0, -1).join('/') || 'vault';
}

function layout({ url, rel = null, tab = null, title, description, lang, bodyClass, content, ld, ogType = 'article', image, pagefind = false, toc = [], side = '' }) {
  // The same content as plain Markdown (or the raw script) for AI agents and tools.
  const alt = rel && trackedSet.has(rel) ? `\n  <link rel="alternate" type="${CODE_EXT.test(rel) ? 'text/plain' : 'text/markdown'}" href="/${rel.split('/').map(encodeURIComponent).join('/')}" title="Source">` : '';
  const canonical = SITE + url;
  const fullTitle = url === '/' ? title : `${deEmoji(title)} | SharePoint Vault`;
  const tabName = tab || (rel ? rel.split('/').pop() : (url.replace(/^\/|\/$/g, '').split('/').pop() || 'README.md'));
  const showReadmeTab = url !== '/';
  const outline = toc.length >= 2 ? `<div class="grp"><div class="ide-h"><span>Outline</span></div><nav class="ol">${toc.map((t) => `<a href="#${t.id}">${esc(t.text)}</a>`).join('')}</nav></div>` : '';
  const acts = rel && trackedSet.has(rel) ? `<span class="act"><a href="${GH}/commits/main/${rel}" target="_blank" rel="noopener">history</a><a href="${GH}/edit/main/${rel}" target="_blank" rel="noopener">edit on GitHub</a></span>` : '';
  return `<!DOCTYPE html>
<html lang="${lang}" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <script>try{var t=localStorage.getItem('sv-theme');if(t){document.documentElement.setAttribute('data-theme',t)}}catch(e){}</script>
  <title>${esc(fullTitle)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(canonical)}">
  <meta name="theme-color" content="#070C17">
  <meta property="og:site_name" content="SharePoint Vault">
  <meta property="og:title" content="${esc(deEmoji(title))}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:type" content="${ogType}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:image" content="${SITE}${image || '/assets/og-vault.png'}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="robots" content="max-image-preview:large, max-snippet:-1">
  <link rel="alternate" type="application/atom+xml" title="SharePoint Vault — new articles" href="/feed.xml">${alt}
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🗝️</text></svg>">
  ${HEAD_FONTS}
  <style>${THEME}</style>
  ${ld.map((o) => `<script type="application/ld+json">${jsonLd(o)}</script>`).join('\n  ')}
</head>
<body class="${bodyClass || ''}">
<header class="ide-top">
  <button class="ide-burger" type="button" aria-label="Explorer">☰</button>
  <a class="ide-brand" href="/">SharePoint<b>Vault</b> <span>~/${esc(rel && rel.includes('/') ? rel.split('/').slice(0, -1).join('/') : '')}</span></a>
  <a class="ide-palette" href="/search" data-pal role="search" aria-label="Search the vault">⌕ <span class="t">Search ${pages.length} pages, error messages, scripts…</span><kbd>Ctrl K</kbd></a>
  <a class="ide-star" href="${GH}" target="_blank" rel="noopener"><span class="st">★</span> Star <span class="n"></span></a>
</header>
<div class="ide">
<main class="ide-main">
  <div class="ide-tabs">${showReadmeTab ? `<a class="ide-tab" href="/">${tabIcon('README.md')} README.md</a>` : ''}<span class="ide-tab on">${tabIcon(tabName)} ${esc(tabName)}</span></div>
  <div class="ide-crumb">${crumbFor(url, rel)}${acts}</div>
  <article class="markdown-section" id="main"${pagefind ? ` data-pagefind-body data-pagefind-filter="kind:${searchKind(url, rel)}"` : ''}>
${pagefind ? `<span data-pagefind-meta="title" hidden>${esc(deEmoji(title))}</span><span data-pagefind-meta="path:${esc(searchPath(url, rel))}" hidden></span>` : ''}
${content}
  </article>
</main>
<aside class="ide-side" aria-label="On this page">
${outline}${side}${url === '/blog' ? '' : blogSide(2)}
</aside>
<aside class="ide-tree" aria-label="Explorer">
${treeHtml(url, rel)}
</aside>
${actBar(url)}
</div>
<footer class="ide-status">
  <span>⎇ main</span>${HEAD.h ? `<a href="${GH}/commit/${HEAD.full}" target="_blank" rel="noopener">${HEAD.h}</a><span class="hm">built ${HEAD.d.slice(0, 10)}</span>` : ''}
  <span class="r"><a class="hm" href="/full-index">${pages.length} pages</a><a class="hm" href="/feed.xml">Atom feed</a><span class="hm">EN · CZ</span><a class="hm" href="${GH}/blob/main/LICENSE" target="_blank" rel="noopener">MIT</a><button type="button" data-theme-toggle>◐ theme</button></span>
</footer>
<div class="pal" id="pal" role="dialog" aria-label="Search the vault"><div class="pal-box"><div id="pal-ui"></div></div></div>
${UI_JS}
</body>
</html>
`;
}

const AUTHOR = { '@type': 'Person', name: 'Kamil Juřík', url: 'https://www.linkedin.com/in/kamiljurik/' };
const PUBLISHER = { '@type': 'Organization', name: 'EasyPortal 365', url: 'https://easyportal365.cz/en/' };

/** Breadcrumb trail: Vault › Section › category (JSON-LD; the visible path is the crumb bar). */
function crumbs(rel) {
  const parts = rel.split('/');
  const trail = [{ name: 'Vault', url: '/' }];
  if (parts.length > 1) trail.push({ name: sectionTitles[parts[0]] || parts[0], url: `/${parts[0]}/` });
  if (parts.length > 2 && !/README\.md$/i.test(rel)) {
    const dirUrl = `/${parts.slice(0, -1).join('/')}/`;
    trail.push({ name: parts[parts.length - 2], url: trackedSet.has(parts.slice(0, -1).join('/') + '/README.md') ? dirUrl : null });
  }
  return trail;
}
const crumbsHtml = (trail) => `<nav class="sv-crumbs" aria-label="Breadcrumb" data-pagefind-ignore>${trail.map((c) => (c.url ? `<a href="${c.url}">${esc(c.name)}</a>` : `<span>${esc(c.name)}</span>`)).join('<span aria-hidden="true">/</span>')}</nav>`;
const crumbsLd = (trail, self) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: [...trail, self].map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: deEmoji(c.name), ...(c.url ? { item: SITE + c.url } : {}) })),
});

function footer(rel, reviewed) {
  const upd = gitDate[rel] ? gitDate[rel].slice(0, 10) : null;
  return `<div class="sv-star" data-pagefind-ignore><span>Saved you an hour? A star on GitHub helps other SharePoint people find the vault.</span><a class="sv-starbtn" href="${GH}" target="_blank" rel="noopener"><span class="st">★</span> Star on GitHub</a></div>
<div class="sv-artfoot" data-pagefind-ignore>${reviewed ? `<span>last reviewed: ${esc(reviewed)}</span>` : ''}${upd ? `<span>last updated: ${upd}</span>` : ''}<a href="${GH}/commits/main/${rel}" target="_blank" rel="noopener">history</a><a href="${GH}/edit/main/${rel}" target="_blank" rel="noopener">edit on GitHub</a><a href="${GH}/blob/main/${rel}" target="_blank" rel="noopener">view source</a></div>`;
}

/** Neighbours by name in the same folder, not "the first N": every article links to a different set. */
function neighbours(p, n = 6) {
  const dir = posix.dirname(p.rel);
  const sib = pages.filter((q) => q !== p && q.kind !== 'index' && posix.dirname(q.rel) === dir);
  if (!sib.length) return { pick: [], dir, total: 0 };
  const all = [...sib, p].sort((a, b) => a.title.localeCompare(b.title));
  const at = all.indexOf(p);
  const pick = [];
  for (let d = 1; pick.length < Math.min(n, sib.length); d++) {
    if (all[at + d]) pick.push(all[at + d]);
    if (pick.length < n && all[at - d]) pick.push(all[at - d]);
    if (d > all.length) break;
  }
  return { pick, dir, total: sib.length + 1 };
}
function related(p) {
  const { pick, dir, total } = neighbours(p);
  if (!pick.length) return '';
  const label = p.kind === 'script' ? 'scripts' : 'articles';
  const dirUrl = trackedSet.has(`${dir}/README.md`) ? `/${dir}/` : (trackedSet.has(`${dir.split('/')[0]}/README.md`) ? `/${dir.split('/')[0]}/` : null);
  return `<div class="sv-related" data-pagefind-ignore><h2 id="related">More ${label} in ${esc(dir.split('/').slice(-1)[0])}</h2><ul>${pick.map((q) => `<li><a href="${q.url}">${esc(shortTitle(q))}</a></li>`).join('')}</ul>${dirUrl ? `<p><a href="${dirUrl}">All ${total} ${label} in this section →</a></p>` : ''}</div>`;
}
function sameArea(p) {
  const { pick, dir } = neighbours(p, 4);
  if (!pick.length) return '';
  return `<div class="grp"><div class="ide-h"><span>Same area · ${esc(dir.split('/').slice(-1)[0])}</span></div>${pick.map((q) => `<a class="it" href="${q.url}">${esc(shortTitle(q))}<small>${esc(posix.dirname(q.rel))}</small></a>`).join('')}</div>`;
}
const KINDS = { gotchas: ['g', '● GOTCHA'], guides: ['gd', '● GUIDE'], scripts: ['sc', '● SCRIPT'], snippets: ['sn', '● SNIPPET'], course: ['co', '● COURSE · CZ'] };
function kindLine(p, words) {
  const sec = p.rel.split('/')[0];
  const k = KINDS[sec];
  if (!k || p.kind === 'index') return '';
  const area = p.rel.split('/').length > 2 ? p.rel.split('/')[1] : '';
  const mins = words ? Math.max(1, Math.round(words / 220)) : 0;
  return `<div class="sv-kind" data-pagefind-ignore><b class="${k[0]}">${k[1]}</b>${area ? `<span>${esc(area)}</span>` : ''}${mins ? `<span>· ${mins} min read</span>` : ''}</div>`;
}

// ── build ──────────────────────────────────────────────────────────────────
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const rel of tracked) {
  if (SKIP_DIRS.test(rel) || /^package(-lock)?\.json$/.test(rel)) continue;
  const dst = join(OUT, rel);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(join(ROOT, rel), dst);
}

// Pass 2: pages.
for (const p of pages) {
  const trail = crumbs(p.rel);
  const description = clip(p.summary || p.title, 160);
  let content;
  let toc = [];
  let side = '';
  const ld = [];
  if (p.kind === 'script') {
    const name = p.rel.split('/').pop();
    const intro = SV_INTRO[name];
    const lines = p.raw.split('\n').length;
    const kb = Math.round(p.raw.length / 102.4) / 10;
    const h = highlight(p.raw, 'powershell');
    content = `${crumbsHtml(trail)}
${kindLine(p, 0)}
<h1 id="top">${esc(name)}</h1>
${intro ? `<div class="sv-intro">${intro.anim ? `<img class="sv-intro-anim" src="${esc(intro.anim)}" alt="${esc(name)} running in a PowerShell window">` : ''}<p><span class="sv-lang">EN</span> ${intro.en}</p><p><span class="sv-lang">CZ</span> ${intro.cz}</p></div>` : `<blockquote><p>${esc(p.summary)}</p></blockquote>`}
<div class="sv-fileact"><button type="button" class="sv-btn" onclick="navigator.clipboard.writeText(document.getElementById('sv-code').innerText);this.textContent='✓ copied'">⧉ copy to clipboard</button><a class="sv-btn" href="/${p.rel}" download="${esc(name)}">⬇ download</a><a class="sv-btn" href="${GH}/blob/main/${p.rel}" target="_blank" rel="noopener">view on GitHub ↗</a><span class="sv-filemeta">${lines} lines · ${kb} KB</span></div>
<pre data-lang="powershell"><code class="lang-powershell" id="sv-code">${h.html}</code></pre>
${helpful(p.title, p.url)}
${related(p)}
${footer(p.rel, null)}`;
    side = sameArea(p);
    ld.push({
      '@context': 'https://schema.org', '@type': 'SoftwareSourceCode', name, description, programmingLanguage: 'PowerShell',
      codeRepository: GH, url: SITE + p.url, author: AUTHOR, publisher: PUBLISHER, license: `${GH}/blob/main/LICENSE`,
      ...(gitDate[p.rel] ? { dateModified: gitDate[p.rel] } : {}),
    });
  } else {
    const r = render(p.body, p.rel);
    toc = r.toc;
    const d = p.data;
    const meta = [];
    if (d['applies-to']) meta.push(`<span><b>applies to:</b> ${esc(d['applies-to'])}</span>`);
    if (d['last-reviewed']) meta.push(`<span><b>reviewed:</b> ${esc(d['last-reviewed'])}</span>`);
    if (Array.isArray(d.tags) && d.tags.length) meta.push(`<span class="sv-tags">${d.tags.map((t) => `<a class="sv-tag" href="/tags/${tagSlug(t)}/">#${esc(t)}</a>`).join('')}</span>`);
    const words = plain(p.body).split(' ').length;
    // Kind line above the H1, meta line right under it.
    let html = r.html.replace(/<h1/, `${kindLine(p, words)}<h1`);
    if (meta.length) html = html.replace(/(<\/h1>\n?)/, `$1<div class="sv-meta" data-pagefind-ignore>${meta.join('')}</div>\n`);
    content = `${crumbsHtml(trail)}
${html}
${p.kind === 'article' ? helpful(p.title, p.url) + related(p) : ''}
${footer(p.rel, d['last-reviewed'])}`;
    if (p.kind === 'article') side = sameArea(p);
    if (p.kind === 'article') {
      ld.push({
        '@context': 'https://schema.org', '@type': 'TechArticle', headline: clip(deEmoji(p.title), 110), description,
        inLanguage: p.lang, url: SITE + p.url, mainEntityOfPage: SITE + p.url, author: AUTHOR, publisher: PUBLISHER,
        ...(Array.isArray(d.tags) ? { keywords: d.tags.join(', ') } : {}),
        ...(d['last-reviewed'] ? { dateModified: d['last-reviewed'] } : {}),
        ...(d['applies-to'] ? { proficiencyLevel: 'Expert', dependencies: d['applies-to'] } : {}),
      });
    }
  }
  ld.push(crumbsLd(trail, { name: p.title, url: p.url }));
  const dst = join(OUT, outFile(p.url));
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, layout({
    url: p.url, rel: p.rel, title: p.title, description, lang: p.lang, content, ld, toc, side,
    bodyClass: p.rel.startsWith('course/') ? 'is-course' : '',
    ogType: p.kind === 'index' ? 'website' : 'article',
    image: p.kind === 'index' ? null : ogPath(p.url),
    pagefind: p.kind !== 'index',
  }));
}

// ── tags ───────────────────────────────────────────────────────────────────
const sectionOf = (p) => p.rel.split('/').slice(0, -1).join(' / ');
const cardList = (items) => `<ul class="sv-cards">${items.map((q) => `<li><a href="${q.url}">${esc(deEmoji(q.title))}</a><span class="sv-sec">${esc(sectionOf(q))}</span>${q.summary ? `<span class="sv-sum">${esc(clip(q.summary, 220))}</span>` : ''}</li>`).join('')}</ul>`;
const extraUrls = [];
const TAB_NAMES = { '/tags/': 'tags', '/errors': 'errors.log', '/start/': 'start-here', '/whats-new': 'whats-new', '/blog': 'blog', '/search': 'search' };
function writePage(url, opts) {
  const dst = join(OUT, outFile(url));
  mkdirSync(dirname(dst), { recursive: true });
  const tab = TAB_NAMES[url] || (url.startsWith('/errors/') ? 'errors.log' : url.startsWith('/tags/') ? 'tags' : url.startsWith('/start/') || url.startsWith('/top/') ? 'start-here' : null);
  writeFileSync(dst, layout({ url, lang: 'en', ogType: 'website', tab, ...opts }));
}
writePage('/tags/', {
  title: 'Tags', description: `Browse ${pages.filter((p) => p.kind === 'article').length} SharePoint gotchas and guides by topic: ${tagPages.slice(0, 8).map(([, v]) => v.name).join(', ')} and more.`,
  ld: [crumbsLd([{ name: 'Vault', url: '/' }], { name: 'Tags', url: '/tags/' })],
  content: `<h1 id="tags">Browse by tag</h1>
<p class="sv-lead">Every article in the vault carries tags. Pick a topic to see everything we have on it.</p>
<div class="sv-taglist">${tagPages.map(([s, v]) => `<a href="/tags/${s}/">#${esc(v.name)}<small>${v.items.length}</small></a>`).join('')}</div>`,
});
extraUrls.push('/tags/');
for (const [s, v] of tagPages) {
  const url = `/tags/${s}/`;
  const items = v.items.slice().sort((a, b) => a.title.localeCompare(b.title));
  const trail = [{ name: 'Vault', url: '/' }, { name: 'Tags', url: '/tags/' }];
  writePage(url, {
    title: `${v.name}: ${items.length} SharePoint gotchas and guides`,
    description: clip(`${items.length} field-tested notes tagged “${v.name}”: ${items.slice(0, 4).map((q) => shortTitle(q)).join('; ')}.`, 160),
    ld: [crumbsLd(trail, { name: v.name, url })],
    content: `<h1 id="tag">#${esc(v.name)} <small style="font-size:.5em;color:var(--soft)">${items.length} articles</small></h1>
${cardList(items)}`,
  });
  extraUrls.push(url);
}

// ── error lookup, reading paths, what's new, feed (tools/site-extras.mjs) ──
const extras = buildExtras({ ROOT, OUT, SITE, pages, writePage, extraUrls, esc, clip, deEmoji, crumbsHtml, crumbsLd, cardList, gitDate, gitAdded });

// ── from the blog (tools/blog-feed.mjs: read from the blog's RSS, nothing copied) ──
const blogStat = buildBlog({ OUT, writePage, extraUrls, esc, clip, crumbsHtml, crumbsLd }, blog);
// The site still deploys without it, but nobody should have to find that out from a reader.
if (!blog.items) console.log(`::warning title=From the blog::${blogStat}`);

// ── search (Pagefind, index built after this script: npx pagefind --site <out>) ──
writePage('/search', {
  title: 'Search', description: 'Full-text search across every gotcha, guide, snippet and script in the SharePoint Vault.',
  ld: [],
  content: `<h1 id="search">Search the vault</h1>
<p class="sv-lead">Tip: <kbd class="ide-kbd" style="margin:0">Ctrl K</kbd> opens this search on every page.</p>
<div id="sv-pf" class="sx-page"><noscript><p>Search needs JavaScript. Without it, use the <a href="/full-index">full index</a> or the <a href="/errors">error lookup</a>.</p></noscript></div>`,
});

// ── home (README.md + live panels) ─────────────────────────────────────────
{
  const readme = frontmatter(readFileSync(join(ROOT, 'README.md'), 'utf8')).body
    .replace(/^\s*<div align="center">[\s\S]*?<\/div>\s*(?:---\s*)?/, '');
  const r = render(readme, 'README.md');
  const n = (sec) => pages.filter((p) => p.kind !== 'index' && p.rel.startsWith(sec + '/')).length;
  const gotchaCats = new Set(pages.filter((p) => p.rel.startsWith('gotchas/') && p.rel.split('/').length > 2).map((p) => p.rel.split('/')[1])).size;
  const col = readJson('_data/collections.json', null);
  const weekAgo = Date.now() - 7 * 86400000;
  const fresh = pages.filter((p) => p.kind !== 'index' && gitAdded[p.rel] && Date.parse(gitAdded[p.rel]) >= weekAgo)
    .sort((a, b) => gitAdded[b.rel].localeCompare(gitAdded[a.rel]));
  const maxW = Math.max(1, ...weekly);
  const totalW = weekly.reduce((a, b) => a + b, 0);
  const content = `<div class="home-hero">
<div class="cmt">&lt;!-- „Zápisky z bojového pole“ — notes from the battlefield --&gt;</div>
<h1 id="sharepoint-vault">SharePoint<b>Vault</b><span class="cur" aria-hidden="true"></span></h1>
<p class="tag">Field-tested scripts, hard-won gotchas and guides for SharePoint professionals. No marketing, no doc rewrites — only things that <em>survived contact with production</em>.</p>
<div class="chips"><span><b>${n('gotchas')}</b> gotchas in ${gotchaCats} areas</span><span><b>${extras.nMsgs}</b> exact error messages</span><span><b>${pages.filter((p) => p.kind === 'script').length}</b> scripts</span><span><b>${n('guides')}</b> guides</span><span><b>${n('snippets')}</b> snippets</span><span>MIT</span></div>
<div class="ctas"><a class="pri" href="/start/">⇢ Start here</a><a href="/errors">⚠ Paste an error</a><a href="#" id="sv-random">⚄ Random gotcha</a><a href="${GH}" target="_blank" rel="noopener">★ Star on GitHub</a></div>
</div>
<div class="home-grid">
  <div class="panel"><div class="ph"><span class="prompt">❯</span><b>Find-Error</b><span class="r">${extras.nMsgs} messages · ${extras.nStatus} status codes</span></div>
    <div class="pb"><input class="fe-in" id="fe" type="search" autocomplete="off" placeholder="412, list view threshold, access denied…" aria-label="Type an error message or a status code"><div class="fe-res" id="fe-res"><span class="none">Type a status code or a few words of the error you got.</span></div></div></div>
  <div class="panel"><div class="ph"><span class="prompt">❯</span><b>git log --oneline</b><span class="r"><a href="${GH}/commits/main" target="_blank" rel="noopener" style="color:var(--soft);border:none;font-weight:400">history ↗</a></span></div>
    <div class="pb"><div class="glog">${recentCommits.map((c) => `<a href="${GH}/commit/${c.full}" target="_blank" rel="noopener"><span class="sha">${c.h}</span><span class="m">${esc(c.s)}</span><span class="w" data-iso="${c.d}">${c.d.slice(0, 10)}</span></a>`).join('')}</div>
    <div class="spark" title="commits per week">${weekly.map((w) => `<i style="height:${Math.round((w / maxW) * 100)}%"></i>`).join('')}</div><div class="spark-l">${totalW} commits in the last 26 weeks</div></div></div>
</div>
${col ? `<div class="paths">${col.paths.map((x, i) => `<a class="path" href="/start/${x.slug}"><span class="n">PATH 0${i + 1} · ${x.items.length} READS</span><span class="t">${esc(x.title)}</span><span class="s">${esc(clip(x.intro, 110))}</span></a>`).join('')}</div>` : ''}
<div class="home-readme">
${r.html}
</div>
<script>
document.addEventListener('DOMContentLoaded', function () {
  var d = document;
  /* old docsify links: /#/gotchas/spfx/foo.md → /gotchas/spfx/foo */
  var m = /^#\\/([^?]*)(?:\\?(.*))?$/.exec(location.hash || '');
  if (m) {
    var p = decodeURIComponent(m[1]), id = m[2] ? /(?:^|&)id=([^&]+)/.exec(m[2]) : null, url = null;
    if (p && !/^README(\\.md)?$/i.test(p)) {
      if (/^INDEX(\\.md)?$/i.test(p)) { url = '/full-index'; }
      else if (/(^|\\/)README(\\.md)?$/i.test(p)) { url = '/' + p.replace(/README(\\.md)?$/i, ''); }
      else if (/\\/$/.test(p)) { url = '/' + p; }
      else { url = '/' + p.replace(/\\.(md|ps1|psm1)$/i, ''); }
      fetch('/pages.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (list) {
        if (list && list.some(function (x) { return x.u === url; })) { location.replace(url + (id ? '#' + id[1] : '')); }
      }).catch(function () {});
    }
  }
  /* relative times in git log */
  function rel(iso) { var s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 3600) { return Math.max(1, Math.floor(s / 60)) + ' min'; } var h = Math.floor(s / 3600); if (h < 36) { return h + ' h'; } return Math.floor(h / 24) + ' d'; }
  d.querySelectorAll('.glog .w[data-iso]').forEach(function (e) { e.textContent = rel(e.getAttribute('data-iso')); });
  function esc(t) { var x = d.createElement('div'); x.textContent = t; return x.innerHTML.replace(/"/g, '&quot;'); }
  /* Find-Error over /errors.json */
  var fe = d.getElementById('fe'), out = d.getElementById('fe-res'), errs = null;
  function load() { if (errs) { return Promise.resolve(errs); } return fetch('/errors.json').then(function (r) { return r.ok ? r.json() : []; }).then(function (j) { errs = j; return j; }).catch(function () { return []; }); }
  function show() {
    var q = fe.value.trim().toLowerCase();
    if (!q) { out.innerHTML = '<span class="none">Type a status code or a few words of the error you got.</span>'; return; }
    load().then(function (list) {
      var words = q.split(/\\s+/), hits = list.filter(function (e) { var h = (e.m + ' ' + (e.s || '')).toLowerCase(); return words.every(function (w) { return h.indexOf(w) > -1; }); });
      if (/^\\d{3}$/.test(q)) { hits = hits.filter(function (e) { return String(e.s) === q; }).concat(hits.filter(function (e) { return String(e.s) !== q; })); }
      out.innerHTML = hits.length
        ? hits.slice(0, 5).map(function (e) { return '<a href="' + esc(e.u) + '"><span class="code">' + (e.s || '·') + '</span><span class="msg">' + esc(e.m) + '</span></a>'; }).join('') + (hits.length > 5 ? '<a href="/errors" style="color:var(--soft)"><span class="code"></span><span class="msg">… ' + (hits.length - 5) + ' more in the error lookup</span></a>' : '')
        : (/^\\d{3}$/.test(q) ? '<a href="/errors/http-' + q + '"><span class="code">' + q + '</span><span class="msg">all known causes of HTTP ' + q + ' →</span></a>' : '<span class="none">Nothing yet for that. Try fewer words, or the <a href="/search?q=' + encodeURIComponent(q) + '">full-text search</a>.</span>');
    });
  }
  if (fe) { fe.addEventListener('input', show); fe.addEventListener('focus', load); }
  /* random gotcha */
  var rnd = d.getElementById('sv-random');
  if (rnd) { rnd.addEventListener('click', function (e) { e.preventDefault(); fetch('/pages.json').then(function (r) { return r.json(); }).then(function (list) { var g = list.filter(function (x) { return x.k === 'gotchas' && !/\\/$/.test(x.u); }); if (g.length) { location.href = g[Math.floor(Math.random() * g.length)].u; } }); }); }
  /* most read this week: own endpoint + titles from /pages.json */
  var API = '${API}', mr = d.getElementById('sv-popular');
  if (mr) {
    if (!API) { mr.parentNode.parentNode.removeChild(mr.parentNode); return; }
    Promise.all([
      fetch(API + '/stats?days=7').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('/pages.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var st = res[0], idx = {}, html = '', k = 0;
      (res[1] || []).forEach(function (x) { idx[x.u] = x; });
      if (st && st.pages) { for (var i = 0; i < st.pages.length && k < 5; i++) { var pg = idx[st.pages[i].path]; if (!pg || /\\/$/.test(pg.u) || pg.u === '/full-index') { continue; } k++; html += '<a class="it" href="' + pg.u + '">' + esc(pg.t) + '<small>' + esc(pg.u.split('/').slice(1, -1).join('/')) + ' · <span class="hl">' + st.pages[i].views + '×</span></small></a>'; } }
      mr.innerHTML = k >= 3 ? html : '<span class="it" style="color:var(--dim)">still counting — check back in a few days</span>';
    });
  }
});
</script>`;
  const side = `<div class="grp"><div class="ide-h"><span>Most read · 7 days</span></div><div id="sv-popular"><span class="it" style="color:var(--dim)">…</span></div></div>
<div class="grp"><div class="ide-h"><span>New this week</span><span style="color:var(--accent)">+${fresh.length}</span></div>${fresh.slice(0, 5).map((p) => `<a class="it" href="${p.url}">${esc(shortTitle(p))}<small>${esc(posix.dirname(p.rel))} · added ${esc(fmtDay(gitAdded[p.rel]))}</small></a>`).join('') || '<span class="it" style="color:var(--dim)">quiet week on the battlefield</span>'}${fresh.length > 5 ? `<a class="it" href="/whats-new" style="color:var(--accent)">all new articles →</a>` : ''}</div>
<div class="grp"><div class="ide-h"><span>Start here</span></div><a class="it" href="/start/">Reading paths by role<small>admin · spfx · graph</small></a><a class="it" href="/errors">Error lookup<small>${extras.nMsgs} messages · ${extras.nStatus} status codes</small></a><a class="it" href="/tags/">Browse by tag<small>${tagPages.length} topics</small></a></div>`;
  writeFileSync(join(OUT, 'index.html'), layout({
    url: '/', rel: 'README.md', tab: 'README.md',
    title: 'SharePoint Vault — field-tested scripts, gotchas and guides for SharePoint professionals',
    description: 'Zápisky z bojového pole — notes from the battlefield. Field-tested PowerShell scripts, hard-won gotchas and guides for SharePoint professionals. Maintained by the EasyPortal 365 team.',
    lang: 'en', ogType: 'website', content, side,
    ld: [{ '@context': 'https://schema.org', '@type': 'WebSite', name: 'SharePoint Vault', url: SITE + '/', publisher: PUBLISHER, potentialAction: { '@type': 'SearchAction', target: `${SITE}/search?q={query}`, 'query-input': 'required name=query' } }],
  }));
}

// Data for the home („most read this week", random gotcha, old-link redirects) and for the share images.
writeFileSync(join(OUT, 'pages.json'), JSON.stringify(pages.map((p) => ({ u: p.url, t: shortTitle(p), k: p.rel.split('/')[0] }))));
writeFileSync(join(OUT, 'og-manifest.json'), JSON.stringify(pages.filter((p) => p.kind !== 'index').map((p) => ({
  url: p.url, out: ogPath(p.url),
  // A card holds about 100 characters at a readable size; longer titles use the short title.
  title: deEmoji(p.title.length > 100 && p.data && p.data['short-title'] ? p.data['short-title'] : p.title),
  kicker: p.kind === 'script' ? `PowerShell script · ${p.rel.split('/')[1]}` : `${(sectionTitles[p.rel.split('/')[0]] || p.rel.split('/')[0]).replace(/s$/, '')} · ${p.rel.split('/').length > 2 ? p.rel.split('/')[1] : ''}`.replace(/ · $/, ''),
}))));

// llms.txt: a map of the vault for AI agents (llmstxt.org). Every page also exists as
// plain Markdown (or the raw script) at its repo path, linked from <link rel="alternate">.
{
  const md = (p) => `/${p.rel.split('/').map(encodeURIComponent).join('/')}`;
  const groups = [['gotchas', 'Gotchas — symptom → cause → fix'], ['guides', 'Guides'], ['scripts', 'PowerShell scripts'], ['snippets', 'Snippets'], ['course', 'Course (Czech)'], ['talks', 'Talks'], ['resources', 'Resources']];
  const body = groups.map(([s, label]) => {
    const list = pages.filter((p) => p.kind !== 'index' && p.rel.startsWith(s + '/')).sort((a, b) => a.rel.localeCompare(b.rel));
    if (!list.length) return '';
    return `## ${label}\n\n${list.map((p) => `- [${deEmoji(p.title).replace(/[[\]]/g, '')}](${SITE}${p.url}) (source: ${SITE}${md(p)}): ${clip(p.summary || '', 200)}`).join('\n')}\n`;
  }).filter(Boolean).join('\n');
  writeFileSync(join(OUT, 'llms.txt'), `# SharePoint Vault

> Field-tested PowerShell scripts, hard-won gotchas (symptom → cause → fix) and guides for SharePoint Online, SPFx, Microsoft Graph and the Azure services around them. Written from real projects, MIT licensed. Each entry below links the page and its plain Markdown source.

- Error messages with their causes: ${SITE}/errors
- Reading paths by role: ${SITE}/start/
- New articles (Atom): ${SITE}/feed.xml
- Source repository: ${GH}

${body}`);
}

// sitemap, robots, 404
const lastmod = (p) => (gitDate[p.rel] || (p.data && p.data['last-reviewed']) || '').slice(0, 10);
const newest = Object.values(gitDate).sort().pop() || '';
const urls = [{ loc: SITE + '/', lastmod: (gitDate['README.md'] || '').slice(0, 10) }, ...pages.map((p) => ({ loc: SITE + p.url, lastmod: lastmod(p) })),
  ...extraUrls.map((u) => ({ loc: SITE + u, lastmod: newest.slice(0, 10) }))];
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(encodeURI(u.loc))}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`);
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
writeFileSync(join(OUT, '404.html'), layout({
  url: '/404', tab: '404', title: 'Not found', description: 'This page is not in the vault.', lang: 'en', ld: [], ogType: 'website',
  content: `<h1 id="not-found">404 — not in the vault</h1><p>This page may have moved. Press <kbd class="ide-kbd" style="margin:0">Ctrl K</kbd> to search, or try the <a href="/">vault home</a>, the <a href="/full-index">full index</a> or the <a href="/gotchas/">gotchas</a>.</p>
<script>
  // Old links ending in .md open the page of the same article.
  (function () { var p = location.pathname; if (/\\.md$/i.test(p)) location.replace(p.replace(/(?:\\/README)?\\.md$/i, function (m) { return /README/i.test(m) ? '/' : ''; })); })();
</script>`,
}).replace('<link rel="canonical" href="https://sharepointvault.online/404">\n', '').replace('<meta name="description"', '<meta name="robots" content="noindex">\n  <meta name="description"'));

console.log(`[build-site] tags: ${tagPages.length} pages · error lookup: ${extras.errors} · ${extras.collections || 'no collections'} · ${extras.feed} · ${blogStat}`);
console.log(`[build-site] ${pages.length} pages (${pages.filter((p) => p.kind === 'article').length} articles, ${pages.filter((p) => p.kind === 'script').length} scripts, ${pages.filter((p) => p.kind === 'index').length} indexes) + home + sitemap (${urls.length} URLs) → ${OUT}`);
if (warnings.length) { console.warn(`[build-site] ${warnings.length} warning(s):`); warnings.slice(0, 40).forEach((w) => console.warn('  ' + w)); }

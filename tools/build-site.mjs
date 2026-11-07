// Static page build for sharepointvault.online.
//
//   node tools/build-site.mjs <outDir>        (CI: _site, see .github/workflows/pages.yml)
//
// Why: the docsify app routes everything through `/#/…`, and a search engine
// treats the whole vault as ONE page. Every gotcha, guide, snippet, course
// chapter and script therefore also gets its own pre-rendered HTML page at a
// clean URL (`/gotchas/spfx/foo`, `/scripts/cleanup/Get-X`), with its own
// <title>, description, canonical, breadcrumbs and links to its neighbours.
// The docsify app at `/` stays exactly as it is.
//
// Output = every tracked file of the repo (the docsify app keeps working)
// + the generated pages + sitemap.xml + robots.txt + 404.html.
// Nothing generated is ever committed: the build runs in GitHub Actions.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve, posix } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import Prism from 'prismjs';
import loadLanguages from 'prismjs/components/index.js';

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
/** Sections whose README is a listing page; root-level docs that also get a page. */
const SKIP = new Set(['README.md', '_sidebar.md', '_file.md']);
const SKIP_DIRS = /^(\.github|tools|node_modules|_site)\//;

// ── helpers ────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plain = (s) => String(s || '').replace(/`([^`]*)`/g, '$1').replace(/\*\*?([^*]+)\*\*?/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => { if (s.length <= n) return s; const cut = s.slice(0, n - 1); return cut.slice(0, Math.max(cut.lastIndexOf(' '), n - 20)).replace(/[,;:\s]+$/, '') + '…'; };
const NO_EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;
const deEmoji = (s) => String(s).replace(NO_EMOJI, '').replace(/\s{2,}/g, ' ').trim();
const jsonLd = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

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
    // NOT /INDEX: on a case-insensitive disk INDEX.html would overwrite the docsify index.html.
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
      .replace(/[ -⁯⸀-⹿\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g, '').trim().replace(/\s+/g, '-');
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

/** Most recent commit date per file — one git call, not one per file. */
const gitDate = {};
try {
  const log = execFileSync('git', ['log', '--format=%x01%cI', '--name-only'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let cur = null;
  for (const line of log.split('\n')) {
    if (line.startsWith('\x01')) { cur = line.slice(1).trim(); continue; }
    const f = line.trim();
    if (f && cur && !gitDate[f]) gitDate[f] = cur;
  }
} catch { /* shallow clone or no git: lastmod falls back to last-reviewed */ }

const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');
const STYLE = (indexHtml.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
const HEAD_FONTS = (indexHtml.match(/<link rel="preconnect"[\s\S]*?vue\.css">/) || [''])[0];
let SV_INTRO = {};
{
  const m = indexHtml.match(/var SV_INTRO = (\{[\s\S]*?\n\s*\});/);
  // Our own file, read at build time: the intro texts live once, in the docsify app.
  if (m) { try { SV_INTRO = new Function(`return ${m[1]}`)(); } catch (e) { console.warn('SV_INTRO not parsed:', e.message); } }
}

const pages = [];
for (const rel of tracked) {
  if (SKIP_DIRS.test(rel)) continue;
  const base = rel.split('/').pop();
  if (/\.md$/i.test(rel)) {
    if (rel === 'README.md' || SKIP.has(rel)) continue; // home = the docsify app
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
  rest = rest.replace(/^\?id=([^&]+)/, '#$1'); // docsify heading anchors
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
/** docsify link config in the title slot: [x](url ':ignore :target=_blank'). */
function linkTitle(title) {
  if (!title || title[0] !== ':') return { title, blank: false };
  return { title: null, blank: /:target=_blank/.test(title) };
}
const rewriteHtmlAttrs = (html, fromRel) =>
  html.replace(/\b(href|src)="([^"]*)"/g, (all, attr, v) => `${attr}="${esc(rewrite(v, fromRel).href).replace(/&amp;/g, '&')}"`);

function render(md, fromRel) {
  const slug = slugger();
  const toc = [];
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading(text, level, raw) {
        const id = slug(plain(raw));
        if (level === 2) toc.push({ id, text: plain(raw) });
        return `<h${level} id="${id}"><a href="#${id}" class="anchor"><span>${text}</span></a></h${level}>\n`;
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
  return { html: marked.parse(md), toc };
}

// ── sidebar (from _sidebar.md, with static URLs) ───────────────────────────
const SIDEBAR_MD = readFileSync(join(ROOT, '_sidebar.md'), 'utf8');
const sidebarBase = render(SIDEBAR_MD, '_sidebar.md').html;
function sidebar(url) {
  return sidebarBase.replace(/<li><a href="([^"]*)"/g, (all, h) => (h === url ? `<li class="active"><a href="${h}"` : all));
}

// ── page template ──────────────────────────────────────────────────────────
const EXTRA_CSS = `
.sv-crumbs { font-family:var(--mono); font-size:11px; color:var(--soft); margin:0 0 18px; display:flex; flex-wrap:wrap; gap:6px; }
.sv-crumbs a { color:var(--teal7); border-bottom:none; font-weight:600; }
.sv-crumbs span[aria-hidden] { color:var(--line2); }
.sv-meta { font-family:var(--mono); font-size:11px; color:var(--soft); margin:-6px 0 18px; display:flex; flex-wrap:wrap; gap:8px 14px; }
.sv-meta b { color:var(--muted); font-weight:600; }
.sv-tag { display:inline-block; background:var(--mint); color:var(--teal7); border-radius:999px; padding:1px 9px; margin-right:4px; }
.sv-related { margin-top:40px; padding:18px 20px; border:1px solid var(--line); border-radius:14px; background:var(--bg); }
.sv-related h2 { margin-top:0 !important; font-size:15px !important; }
.sv-related ul { margin:0; padding-left:18px; }
.sv-related li { margin:4px 0; }
a.sv-tag { border-bottom:none !important; text-decoration:none; }
a.sv-tag:hover { background:var(--teal7); color:#fff; }
.sv-sidelinks { display:flex; gap:12px; margin:0 16px 12px; font-family:var(--mono); font-size:11px; }
.sv-sidelinks a { color:var(--teal7); text-decoration:none; font-weight:600; }
.sv-sidelinks a:hover { text-decoration:underline; text-underline-offset:3px; }
.sv-helpful { margin-top:40px; padding:14px 18px; border:1px dashed var(--line2); border-radius:14px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; font-size:14px; }
.sv-helpful b { font-weight:600; }
.sv-helpful .sv-btn { padding:6px 14px; }
.sv-helpful .sv-discuss { margin-left:auto; font-family:var(--mono); font-size:11px; }
.sv-helpful-msg { flex-basis:100%; color:var(--muted); font-size:13px; }
.sv-taglist { display:flex; flex-wrap:wrap; gap:8px; margin:16px 0 28px; }
.sv-taglist a { font-family:var(--mono); font-size:12px; background:var(--bg); border:1px solid var(--line); border-radius:999px; padding:5px 12px; color:var(--navy); border-bottom:1px solid var(--line) !important; }
.sv-taglist a:hover { border-color:var(--teal6) !important; color:var(--teal7); }
.sv-taglist small { color:var(--soft); margin-left:4px; }
.sv-cards { list-style:none; padding:0 !important; }
.sv-cards li { padding:12px 0; border-bottom:1px solid var(--line); }
.sv-cards li::before { display:none; }
.sv-cards .sv-sum { display:block; color:var(--muted); font-size:13.5px; margin-top:3px; }
.sv-cards .sv-sec { font-family:var(--mono); font-size:10.5px; color:var(--soft); margin-left:8px; text-transform:uppercase; letter-spacing:.06em; }
.sv-filter { width:100%; max-width:520px; box-sizing:border-box; font-family:var(--mono); font-size:13px; border:1px solid var(--line2); border-radius:999px; padding:10px 16px; margin:8px 0 18px; }
.sv-errs td:first-child { white-space:nowrap; font-family:var(--mono); font-weight:700; }
.sv-msgs li { margin:6px 0; }
.sv-msgs code { white-space:normal; }
#sv-pf { --pagefind-ui-primary:#002163; --pagefind-ui-text:#002163; --pagefind-ui-border:#E0E6EF; --pagefind-ui-tag:#E4F7F6; --pagefind-ui-border-radius:14px; --pagefind-ui-font:'Plus Jakarta Sans',system-ui,sans-serif; }
#sv-pf mark { background:var(--mint); color:var(--navy); }
.markdown-section pre::after { display:none; } /* vue.css repeats the language top right; ours is in the bar on the left */
.markdown-section pre .sv-copy { position:absolute; top:5px; right:10px; font-family:var(--mono); font-size:10px; font-weight:700; color:#fff; background:var(--navy); border:none; border-radius:6px; padding:4px 10px; cursor:pointer; opacity:.85; }
.markdown-section pre .sv-copy:hover { opacity:1; background:var(--teal7); }
`;

const tagSlug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const discussUrl = (title, url) => `${GH}/discussions/new?category=q-a&title=${encodeURIComponent('Re: ' + deEmoji(title))}&body=${encodeURIComponent(`About ${SITE}${url}\n\n`)}`;

/** „Was this helpful?" + a way to ask. Votes go to our own endpoint (no cookies, no third party). */
const helpful = (title, url) => `<div class="sv-helpful" data-svurl="${esc(url)}"><b>Was this helpful?</b><button type="button" class="sv-btn" data-svvote="up">👍 Yes</button><button type="button" class="sv-btn" data-svvote="down">👎 No</button><a class="sv-discuss" href="${esc(discussUrl(title, url))}" target="_blank" rel="noopener">ask or add your experience on GitHub →</a><span class="sv-helpful-msg" hidden></span></div>`;

/** Page view beacon + vote handler. sendBeacon with a string = text/plain, a simple CORS request without preflight. */
const TRACK_JS = `<script>
(function () {
  var API = '${API ? API + '/visit' : ''}';
  function send(o) { if (!API) { return; } try { var d = JSON.stringify(o); if (navigator.sendBeacon && navigator.sendBeacon(API, d)) { return; } fetch(API, { method: 'POST', body: d, keepalive: true, mode: 'no-cors' }); } catch (e) {} }
  send({ p: location.pathname, r: document.referrer, w: window.innerWidth });
  var box = document.querySelector('.sv-helpful');
  if (!box) { return; }
  var key = 'sv-vote:' + location.pathname, prev = null;
  try { prev = localStorage.getItem(key); } catch (e) {}
  var msg = box.querySelector('.sv-helpful-msg');
  function thank(v) {
    msg.hidden = false;
    msg.innerHTML = v === 'up'
      ? 'Thanks! If it saved you time, a <a href="${GH}" target="_blank" rel="noopener">star on GitHub</a> helps other SharePoint people find the vault.'
      : 'Sorry about that. What was missing or wrong? <a href="' + box.querySelector('.sv-discuss').href + '" target="_blank" rel="noopener">Tell us on GitHub</a> and we will fix the article.';
    box.querySelectorAll('[data-svvote]').forEach(function (b) { b.disabled = true; b.style.opacity = b.getAttribute('data-svvote') === v ? 1 : .45; });
  }
  if (prev === 'up' || prev === 'down') { thank(prev); }
  box.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-svvote]') : null;
    if (!b || b.disabled) { return; }
    var v = b.getAttribute('data-svvote');
    send({ p: location.pathname, w: window.innerWidth, f: v });
    try { localStorage.setItem(key, v); } catch (e2) {}
    thank(v);
  });
})();
</script>`;

function layout({ url, title, description, lang, bodyClass, content, ld, ogType = 'article', image, pagefind = false }) {
  const canonical = SITE + url;
  const fullTitle = `${deEmoji(title)} | SharePoint Vault`;
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <title>${esc(fullTitle)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(canonical)}">
  <meta property="og:site_name" content="SharePoint Vault">
  <meta property="og:title" content="${esc(deEmoji(title))}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:type" content="${ogType}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:image" content="${SITE}${image || '/assets/og-vault.png'}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🗝️</text></svg>">
  ${HEAD_FONTS}
  <style>${STYLE}${EXTRA_CSS}</style>
  ${ld.map((o) => `<script type="application/ld+json">${jsonLd(o)}</script>`).join('\n  ')}
</head>
<body class="ready sticky${bodyClass ? ' ' + bodyClass : ''}">
<main>
  <button class="sidebar-toggle" aria-label="Menu"><div class="sidebar-toggle-button"><span></span><span></span><span></span></div></button>
  <aside class="sidebar">
    <h1 class="app-name"><a class="app-name-link" href="/">SharePoint<b>Vault</b> <i>~$</i></a></h1>
    <a class="sv-starbtn sv-starside" href="${GH}" target="_blank" rel="noopener"><span class="st">★</span> Star on GitHub</a>
    <form class="sv-searchform" action="/search" method="get" role="search"><input type="search" name="q" placeholder="⌕ search the vault…" aria-label="Search the vault"></form>
    <nav class="sv-sidelinks" aria-label="Browse"><a href="/tags/">tags</a><a href="/errors">error lookup</a><a href="/full-index">full index</a></nav>
    <div class="sidebar-nav">${sidebar(url)}</div>
  </aside>
  <section class="content">
    <article class="markdown-section" id="main"${pagefind ? ' data-pagefind-body' : ''}>
${pagefind ? `<span data-pagefind-meta="title" hidden>${esc(deEmoji(title))}</span>` : ''}
${content}
    </article>
  </section>
</main>
<script>
  document.querySelector('.sidebar-toggle').addEventListener('click', function () { document.body.classList.toggle('close'); });
  /* copy button on every code block (the docsify app had docsify-copy-code) */
  document.querySelectorAll('.markdown-section pre > code').forEach(function (code) {
    var pre = code.parentNode;
    if (pre.querySelector('.sv-copy')) { return; }
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'sv-copy'; b.textContent = '⧉ copy';
    b.addEventListener('click', function () {
      if (!navigator.clipboard) { return; }
      navigator.clipboard.writeText(code.innerText).then(function () {
        b.textContent = '✓ copied'; setTimeout(function () { b.textContent = '⧉ copy'; }, 1600);
      });
    });
    pre.appendChild(b);
  });
</script>
${TRACK_JS}
</body>
</html>
`;
}

const AUTHOR = { '@type': 'Person', name: 'Kamil Juřík', url: 'https://www.linkedin.com/in/kamiljurik/' };
const PUBLISHER = { '@type': 'Organization', name: 'EasyPortal 365', url: 'https://easyportal365.cz/en/' };

/** Breadcrumb trail: Vault › Section › category. */
function crumbs(rel, sectionTitles) {
  const parts = rel.split('/');
  const trail = [{ name: 'Vault', url: '/' }];
  if (parts.length > 1) trail.push({ name: sectionTitles[parts[0]] || parts[0], url: `/${parts[0]}/` });
  if (parts.length > 2 && !/README\.md$/i.test(rel)) {
    const dirUrl = `/${parts.slice(0, -1).join('/')}/`;
    trail.push({ name: parts[parts.length - 2], url: trackedSet.has(parts.slice(0, -1).join('/') + '/README.md') ? dirUrl : null });
  }
  return trail;
}
const crumbsHtml = (trail) => `<nav class="sv-crumbs" aria-label="Breadcrumb">${trail.map((c) => (c.url ? `<a href="${c.url}">${esc(c.name)}</a>` : `<span>${esc(c.name)}</span>`)).join('<span aria-hidden="true">/</span>')}</nav>`;
const crumbsLd = (trail, self) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: [...trail, self].map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: deEmoji(c.name), ...(c.url ? { item: SITE + c.url } : {}) })),
});

function footer(rel, reviewed) {
  const upd = gitDate[rel] ? gitDate[rel].slice(0, 10) : null;
  return `<div class="sv-star"><span>Saved you an hour? A star on GitHub helps other SharePoint people find the vault.</span><a class="sv-starbtn" href="${GH}" target="_blank" rel="noopener"><span class="st">★</span> Star on GitHub</a></div>
<div class="sv-artfoot">${reviewed ? `<span>last reviewed: ${esc(reviewed)}</span>` : ''}${upd ? `<span>last updated: ${upd}</span>` : ''}<a href="${GH}/commits/main/${rel}" target="_blank" rel="noopener">history</a><a href="${GH}/edit/main/${rel}" target="_blank" rel="noopener">edit on GitHub</a><a href="${GH}/blob/main/${rel}" target="_blank" rel="noopener">view source</a></div>`;
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
// The docsify home gets the same endpoint as the static pages (placeholder in index.html).
writeFileSync(join(OUT, 'index.html'), indexHtml.replace("'__VAULT_API__'", JSON.stringify(API)));

// Pass 1: metadata (titles are needed for related lists and breadcrumbs).
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

function related(p) {
  const dir = posix.dirname(p.rel);
  const sib = pages.filter((q) => q !== p && q.kind !== 'index' && posix.dirname(q.rel) === dir)
    .sort((a, b) => a.title.localeCompare(b.title));
  if (!sib.length) return '';
  // Neighbours by name, not "the first N": every article links to a different set.
  const all = [...sib, p].sort((a, b) => a.title.localeCompare(b.title));
  const at = all.indexOf(p);
  const pick = [];
  for (let d = 1; pick.length < Math.min(6, sib.length); d++) {
    if (all[at + d]) pick.push(all[at + d]);
    if (pick.length < 6 && all[at - d]) pick.push(all[at - d]);
    if (d > all.length) break;
  }
  const label = p.kind === 'script' ? 'scripts' : 'articles';
  const dirUrl = trackedSet.has(`${dir}/README.md`) ? `/${dir}/` : (trackedSet.has(`${dir.split('/')[0]}/README.md`) ? `/${dir.split('/')[0]}/` : null);
  return `<div class="sv-related"><h2 id="related">More ${label} in ${esc(dir.split('/').slice(-1)[0])}</h2><ul>${pick.map((q) => `<li><a href="${q.url}">${esc(deEmoji(q.data && q.data['short-title'] ? q.data['short-title'] : q.title))}</a></li>`).join('')}</ul>${dirUrl ? `<p><a href="${dirUrl}">All ${sib.length + 1} ${label} in this section →</a></p>` : ''}</div>`;
}

// Pass 2: pages.
for (const p of pages) {
  const trail = crumbs(p.rel, sectionTitles);
  const description = clip(p.summary || p.title, 160);
  let content;
  const ld = [];
  if (p.kind === 'script') {
    const name = p.rel.split('/').pop();
    const intro = SV_INTRO[name];
    const lines = p.raw.split('\n').length;
    const kb = Math.round(p.raw.length / 102.4) / 10;
    const h = highlight(p.raw, 'powershell');
    content = `${crumbsHtml(trail)}
<h1 id="top">${esc(name)}</h1>
${intro ? `<div class="sv-intro">${intro.anim ? `<img class="sv-intro-anim" src="${esc(intro.anim)}" alt="${esc(name)} running in a PowerShell window">` : ''}<p><span class="sv-lang">EN</span> ${intro.en}</p><p><span class="sv-lang">CZ</span> ${intro.cz}</p></div>` : `<blockquote><p>${esc(p.summary)}</p></blockquote>`}
<div class="sv-fileact"><button type="button" class="sv-btn" onclick="navigator.clipboard.writeText(document.getElementById('sv-code').innerText);this.textContent='✓ copied'">⧉ copy to clipboard</button><a class="sv-btn" href="/${p.rel}" download="${esc(name)}">⬇ download</a><a class="sv-btn" href="${GH}/blob/main/${p.rel}" target="_blank" rel="noopener">view on GitHub ↗</a><span class="sv-filemeta">${lines} lines · ${kb} KB</span></div>
<pre data-lang="powershell"><code class="lang-powershell" id="sv-code">${h.html}</code></pre>
${helpful(p.title, p.url)}
${related(p)}
${footer(p.rel, null)}`;
    ld.push({
      '@context': 'https://schema.org', '@type': 'SoftwareSourceCode', name, description, programmingLanguage: 'PowerShell',
      codeRepository: GH, url: SITE + p.url, author: AUTHOR, publisher: PUBLISHER, license: `${GH}/blob/main/LICENSE`,
      ...(gitDate[p.rel] ? { dateModified: gitDate[p.rel] } : {}),
    });
  } else {
    const r = render(p.body, p.rel);
    const d = p.data;
    const meta = [];
    if (d['applies-to']) meta.push(`<span><b>applies to:</b> ${esc(d['applies-to'])}</span>`);
    if (Array.isArray(d.tags) && d.tags.length) meta.push(`<span>${d.tags.map((t) => `<a class="sv-tag" href="/tags/${tagSlug(t)}/">${esc(t)}</a>`).join('')}</span>`);
    // Meta line goes right under the H1.
    const html = meta.length ? r.html.replace(/(<\/h1>\n?)/, `$1<div class="sv-meta">${meta.join('')}</div>\n`) : r.html;
    content = `${crumbsHtml(trail)}
${html}
${p.kind === 'article' ? helpful(p.title, p.url) + related(p) : ''}
${footer(p.rel, d['last-reviewed'])}`;
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
    url: p.url, title: p.title, description, lang: p.lang, content, ld,
    bodyClass: p.rel.startsWith('course/') ? 'is-course' : '',
    ogType: p.kind === 'index' ? 'website' : 'article',
    image: p.kind === 'index' ? null : ogPath(p.url),
    pagefind: p.kind !== 'index',
  }));
}

// ── tags ───────────────────────────────────────────────────────────────────
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
const sectionOf = (p) => p.rel.split('/').slice(0, -1).join(' / ');
const cardList = (items) => `<ul class="sv-cards">${items.map((q) => `<li><a href="${q.url}">${esc(deEmoji(q.title))}</a><span class="sv-sec">${esc(sectionOf(q))}</span>${q.summary ? `<span class="sv-sum">${esc(clip(q.summary, 220))}</span>` : ''}</li>`).join('')}</ul>`;
const extraUrls = [];
function writePage(url, opts) {
  const dst = join(OUT, outFile(url));
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, layout({ url, lang: 'en', ogType: 'website', ...opts }));
}
// Only tags with 3+ articles get a page: a page with one or two links is thin content.
const tagPages = tagsSorted.filter(([, v]) => v.items.length >= 3);
writePage('/tags/', {
  title: 'Tags', description: `Browse ${pages.filter((p) => p.kind === 'article').length} SharePoint gotchas and guides by topic: ${tagPages.slice(0, 8).map(([, v]) => v.name).join(', ')} and more.`,
  ld: [crumbsLd([{ name: 'Vault', url: '/' }], { name: 'Tags', url: '/tags/' })],
  content: `${crumbsHtml([{ name: 'Vault', url: '/' }])}
<h1 id="tags">Browse by tag</h1>
<p>Every article in the vault carries tags. Pick a topic to see everything we have on it.</p>
<div class="sv-taglist">${tagPages.map(([s, v]) => `<a href="/tags/${s}/">${esc(v.name)}<small>${v.items.length}</small></a>`).join('')}</div>`,
});
extraUrls.push('/tags/');
for (const [s, v] of tagPages) {
  const url = `/tags/${s}/`;
  const items = v.items.slice().sort((a, b) => a.title.localeCompare(b.title));
  const trail = [{ name: 'Vault', url: '/' }, { name: 'Tags', url: '/tags/' }];
  writePage(url, {
    title: `${v.name}: ${items.length} SharePoint gotchas and guides`,
    description: clip(`${items.length} field-tested notes tagged “${v.name}”: ${items.slice(0, 4).map((q) => deEmoji(q.data['short-title'] || q.title)).join('; ')}.`, 160),
    ld: [crumbsLd(trail, { name: v.name, url })],
    content: `${crumbsHtml(trail)}
<h1 id="tag">${esc(v.name)} <small style="font-size:.5em;color:var(--soft)">${items.length} articles</small></h1>
${cardList(items)}`,
  });
  extraUrls.push(url);
}

// ── error lookup ───────────────────────────────────────────────────────────
// Built from the Symptom section and the bottom line of every gotcha: the exact
// status codes and error texts people paste into a search engine.
const STATUS_NAMES = { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 406: 'Not Acceptable', 409: 'Conflict', 412: 'Precondition Failed', 413: 'Payload Too Large', 414: 'URI Too Long', 423: 'Locked', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' };
// A bare status code in a Symptom section is a status code — unless a unit follows (500 items, 404 ms).
const STATUS_RE = new RegExp(`(?<![\\d.,/-])\\b(${Object.keys(STATUS_NAMES).join('|')})\\b(?![\\d.,]\\d|\\s*(?:ms|s|sec|seconds?|items?|rows?|KB|MB|GB|px|%|days?|char|characters?|users?|sites?|files?|times|×|x\\b|lines?|words?|tokens?|entries|lists?|columns?|fields?))`, 'gi');
const ERRWORD = /(exception|error|denied|not found|cannot|can't|could not|couldn't|does not exist|doesn't exist|prohibited|exceed|invalid|unauthori[sz]ed|forbidden|timed? ?out|throttl|failed|not allowed|unable|blocked|refused|not supported|unexpected|is locked|no permission|access is|not authorized)/i;
function symptomScope(body) {
  const sym = (body.match(/^##\s+Symptom[^\n]*\n([\s\S]*?)(?=^##\s)/m) || [, ''])[1];
  const bottom = (body.match(/\*\*Bottom line\.\*\*([^\n]*)/) || [, ''])[1];
  return `${sym}\n${bottom}`;
}
const byStatus = new Map();
const byMsg = new Map();
for (const p of pages) {
  if (p.kind !== 'article' || !p.rel.startsWith('gotchas/')) continue;
  const scope = symptomScope(p.body);
  const text = `${scope}\n${p.title}`;
  // Code blocks out of the prose first, so a status code inside a request line still counts
  // but backtick spans are not cut across block boundaries.
  const blocks = [...scope.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map((m) => m[1]);
  const prose = scope.replace(/^```[^\n]*\n[\s\S]*?^```/gm, ' ');
  for (const m of text.matchAll(STATUS_RE)) {
    const code = Number(m[1]);
    if (!byStatus.has(code)) byStatus.set(code, new Set());
    byStatus.get(code).add(p);
  }
  const cands = [];
  for (const m of prose.matchAll(/`([^`\n]{8,180})`/g)) cands.push(m[1]);
  for (const b of blocks) {
    // JSON / XML error bodies: take the values, not the braces.
    for (const m of b.matchAll(/"(?:message|code|value|Body)"\s*:\s*"((?:[^"\\]|\\.){6,220})"/g)) cands.push(m[1].replace(/\\"/g, '"'));
    for (const m of b.matchAll(/<m:(?:message|code)[^>]*>([^<]{6,220})</g)) cands.push(m[1]);
    for (const line of b.split('\n')) {
      const t = line.trim();
      if (t.length >= 10 && t.length <= 180 && /^[A-Za-z0-9(]/.test(t) && !/["{}<>]/.test(t)) cands.push(t);
    }
  }
  for (const c of cands) {
    const s = c.trim().replace(/[.:,;]+$/, '');
    if (!ERRWORD.test(s)) continue;
    // Code, not a message: calls, assignments, paths and URLs are not what people paste from an error dialog.
    if (/^(GET|POST|PUT|PATCH|DELETE|MERGE|const|let|var|await|return|if|import|\$|Get-|Set-|New-|Invoke-|Connect-|Remove-|Add-|npm|node|gulp|heft|\/_api|https?:|\.\.?\/)/i.test(s)) continue;
    if (/[{}|*]|=>|===|console\.|\(\)\s*[.;]|^\s*[#/]|\s—\s|\s–\s|:\s*'[^']*'$/.test(s)) continue;
    // Prose fragments: a lower-case start followed by more words is a sentence, not an error text.
    if (/^[a-z][a-z',"]*\s+\S/.test(s) && !/^(cannot|could not|access|invalid|unable|unexpected|the |error|button )/.test(s)) continue;
    // One token = an identifier; only error-shaped ones (FooException, AccessDenied, InvalidValue) are messages.
    if (!/\s/.test(s) && (/[()]/.test(s) || !/(Exception|Error|Forbidden|Denied|^Invalid\w*|AccessDenied\S*)$/.test(s))) continue;
    if (/^[^A-Za-z0-9'(-]/.test(s)) continue;
    const key = s.toLowerCase().replace(/\s+/g, ' ');
    if (!byMsg.has(key)) byMsg.set(key, { text: s, items: new Set() });
    byMsg.get(key).items.add(p);
  }
}
// The same message once complete and once cut short: keep one entry, the longer text.
for (const k of [...byMsg.keys()].sort((a, b) => a.length - b.length)) {
  const longer = [...byMsg.keys()].find((o) => o !== k && o.length > k.length && o.startsWith(k));
  if (longer && byMsg.has(k)) { byMsg.get(k).items.forEach((i) => byMsg.get(longer).items.add(i)); byMsg.delete(k); }
}
const short = (q) => deEmoji(q.data['short-title'] || q.title);
const statusRows = [...byStatus.entries()].sort((a, b) => a[0] - b[0]).map(([code, set]) => {
  const items = [...set].sort((a, b) => short(a).localeCompare(short(b)));
  return `<tr data-svf="${code} ${esc(STATUS_NAMES[code])} ${esc(items.map(short).join(' ').toLowerCase())}"><td>${code}</td><td>${esc(STATUS_NAMES[code])}</td><td>${items.map((q) => `<a href="${q.url}">${esc(short(q))}</a>`).join('<br>')}</td></tr>`;
}).join('');
const msgs = [...byMsg.values()].sort((a, b) => a.text.localeCompare(b.text, 'en', { sensitivity: 'base' }));
writePage('/errors', {
  title: 'SharePoint error lookup: status codes and error messages',
  description: `Paste the error you got. ${byStatus.size} HTTP status codes and ${msgs.length} SharePoint, SPFx and Graph error messages, each linked to the gotcha that explains the cause and the fix.`,
  ld: [crumbsLd([{ name: 'Vault', url: '/' }], { name: 'Error lookup', url: '/errors' })],
  pagefind: true,
  content: `${crumbsHtml([{ name: 'Vault', url: '/' }])}
<h1 id="error-lookup">Error lookup</h1>
<blockquote><p>Got an error from SharePoint, SPFx or Microsoft Graph? Type a status code or a few words of the message. Every entry links to the gotcha that explains <b>why</b> it happens and how to fix it. Built automatically from the <i>Symptom</i> section of each gotcha.</p></blockquote>
<input class="sv-filter" type="search" placeholder="filter: 404, threshold, access denied…" aria-label="Filter errors" oninput="var q=this.value.toLowerCase();document.querySelectorAll('[data-svf]').forEach(function(r){r.style.display=!q||r.getAttribute('data-svf').indexOf(q)>-1?'':'none'})">
<h2 id="by-status">By HTTP status</h2>
<table class="sv-errs"><thead><tr><th>Status</th><th>Meaning</th><th>Gotchas where it shows up</th></tr></thead><tbody>${statusRows}</tbody></table>
<h2 id="by-message">By error message</h2>
<ul class="sv-msgs">${msgs.map((m) => { const items = [...m.items]; return `<li data-svf="${esc((m.text + ' ' + items.map(short).join(' ')).toLowerCase())}"><code>${esc(m.text)}</code> → ${items.map((q) => `<a href="${q.url}">${esc(short(q))}</a>`).join(', ')}</li>`; }).join('')}</ul>`,
});
extraUrls.push('/errors');

// ── search (Pagefind, index built after this script: npx pagefind --site <out>) ──
writePage('/search', {
  title: 'Search', description: 'Full-text search across every gotcha, guide, snippet and script in the SharePoint Vault.',
  ld: [],
  content: `<h1 id="search">Search the vault</h1>
<link href="/pagefind/pagefind-ui.css" rel="stylesheet">
<div id="sv-pf"></div>
<script src="/pagefind/pagefind-ui.js"></script>
<script>
  (function () {
    if (!window.PagefindUI) { document.getElementById('sv-pf').innerHTML = '<p>Search index is not available right now — try the <a href="/full-index">full index</a>.</p>'; return; }
    var ui = new PagefindUI({ element: '#sv-pf', showSubResults: true, showImages: false, resetStyles: false, autofocus: true });
    var q = new URLSearchParams(location.search).get('q');
    if (q) { ui.triggerSearch(q); }
  })();
</script>`,
});

// Data for the docsify home („most read this week") and for the share images.
// All pages incl. section indexes: the docsify home redirects old #/ links only to URLs listed here.
writeFileSync(join(OUT, 'pages.json'), JSON.stringify(pages.map((p) => ({ u: p.url, t: deEmoji(p.data && p.data['short-title'] ? p.data['short-title'] : p.title), k: p.rel.split('/')[0] }))));
writeFileSync(join(OUT, 'og-manifest.json'), JSON.stringify(pages.filter((p) => p.kind !== 'index').map((p) => ({
  url: p.url, out: ogPath(p.url),
  // A card holds about 100 characters at a readable size; longer titles use the short title.
  title: deEmoji(p.title.length > 100 && p.data && p.data['short-title'] ? p.data['short-title'] : p.title),
  kicker: p.kind === 'script' ? `PowerShell script · ${p.rel.split('/')[1]}` : `${(sectionTitles[p.rel.split('/')[0]] || p.rel.split('/')[0]).replace(/s$/, '')} · ${p.rel.split('/').length > 2 ? p.rel.split('/')[1] : ''}`.replace(/ · $/, ''),
}))));

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
  url: '/404', title: 'Not found', description: 'This page is not in the vault.', lang: 'en', ld: [], ogType: 'website',
  content: `<h1 id="not-found">Not found</h1><p>This page is not in the vault — it may have moved. Try the <a href="/">vault home and search</a>, the <a href="/full-index">full index</a> or the <a href="/gotchas/">gotchas</a>.</p>
<script>
  // Old links ending in .md open the page of the same article.
  (function () { var p = location.pathname; if (/\\.md$/i.test(p)) location.replace(p.replace(/(?:\\/README)?\\.md$/i, function (m) { return /README/i.test(m) ? '/' : ''; })); })();
</script>`,
}).replace('<link rel="canonical" href="https://sharepointvault.online/404">\n', '').replace('<meta name="description"', '<meta name="robots" content="noindex">\n  <meta name="description"'));

console.log(`[build-site] tags: ${tagPages.length} pages · error lookup: ${byStatus.size} status codes, ${msgs.length} messages`);
console.log(`[build-site] ${pages.length} pages (${pages.filter((p) => p.kind === 'article').length} articles, ${pages.filter((p) => p.kind === 'script').length} scripts, ${pages.filter((p) => p.kind === 'index').length} indexes) + sitemap (${urls.length} URLs) → ${OUT}`);
if (warnings.length) { console.warn(`[build-site] ${warnings.length} warning(s):`); warnings.slice(0, 40).forEach((w) => console.warn('  ' + w)); }

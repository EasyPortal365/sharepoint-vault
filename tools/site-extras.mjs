// Extra pages of sharepointvault.online, called from tools/build-site.mjs:
//   error lookup (/errors, one page per exact error message and per HTTP status),
//   reading paths and Top 10 collections (/start/…, /top/…),
//   what's new (/whats-new) and the Atom feed of new articles (/feed.xml).
// Curated data lives in _data/errors.json and _data/collections.json; the build
// fails when they point at an article that does not exist.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const STATUS_NAMES = { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 406: 'Not Acceptable', 409: 'Conflict', 412: 'Precondition Failed', 413: 'Payload Too Large', 414: 'URI Too Long', 423: 'Locked', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' };
// A bare status code in a Symptom section is a status code — unless a unit follows (500 items, 404 ms).
const STATUS_RE = new RegExp(`(?<![\\d.,/-])\\b(${Object.keys(STATUS_NAMES).join('|')})\\b(?![\\d.,]\\d|\\s*(?:ms|s|sec|seconds?|items?|rows?|KB|MB|GB|px|%|days?|char|characters?|users?|sites?|files?|times|×|x\\b|lines?|words?|tokens?|entries|lists?|columns?|fields?))`, 'gi');

function symptomScope(body) {
  const sym = (body.match(/^##\s+Symptom[^\n]*\n([\s\S]*?)(?=^##\s)/m) || [, ''])[1];
  const bottom = (body.match(/\*\*Bottom line\.\*\*([^\n]*)/) || [, ''])[1];
  return `${sym}\n${bottom}`;
}

const readJson = (root, rel) => (existsSync(join(root, rel)) ? JSON.parse(readFileSync(join(root, rel), 'utf8')) : null);
const urlSlug = (s, max = 80) => {
  const x = String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (x.length > max ? x.slice(0, max).replace(/-[^-]*$/, '') : x) || 'error';
};

export function buildExtras(c) {
  const byRel = new Map(c.pages.map((p) => [p.rel, p]));
  const need = (rel, where) => {
    const p = byRel.get(rel);
    if (!p) throw new Error(`${where}: ${rel} is not in the vault`);
    return p;
  };
  const short = (q) => c.deEmoji((q.data && q.data['short-title']) || q.title);
  const vault = [{ name: 'Vault', url: '/' }];
  const stats = {};

  // ── error lookup ─────────────────────────────────────────────────────────
  const byStatus = new Map();
  const addStatus = (code, p) => { if (!byStatus.has(code)) byStatus.set(code, new Set()); byStatus.get(code).add(p); };
  for (const p of c.pages) {
    if (p.kind !== 'article' || !p.rel.startsWith('gotchas/')) continue;
    for (const m of `${symptomScope(p.body)}\n${p.title}`.matchAll(STATUS_RE)) addStatus(Number(m[1]), p);
  }
  // Exact messages, verbatim from the articles (curated, see _data/errors.json).
  const curated = readJson(c.ROOT, '_data/errors.json') || [];
  const seen = new Set();
  const msgs = curated.map((e) => {
    const items = e.articles.map((rel) => need(rel, '_data/errors.json'));
    if (e.status && STATUS_NAMES[e.status]) items.forEach((p) => addStatus(e.status, p));
    let slug = urlSlug(e.message);
    while (seen.has(slug)) slug += '-2';
    seen.add(slug);
    return { ...e, items, url: `/errors/${slug}` };
  }).sort((a, b) => a.message.localeCompare(b.message, 'en', { sensitivity: 'base' }));

  const errTrail = [...vault, { name: 'Error lookup', url: '/errors' }];
  const why = (items) => `<ul class="sv-cards">${items.map((q) => `<li><a href="${q.url}">${c.esc(c.deEmoji(q.title))}</a>${q.summary ? `<span class="sv-sum">${c.esc(q.summary)}</span>` : ''}<span class="sv-sum"><a href="${q.url}">Cause and fix →</a></span></li>`).join('')}</ul>`;
  for (const m of msgs) {
    const first = m.items[0];
    c.writePage(m.url, {
      title: c.clip(`${m.message} — cause and fix`, 110),
      description: c.clip(`${m.source ? m.source + ' error' : 'Error'}${m.status ? ' (' + m.status + ')' : ''}: “${m.message}”. ${first.summary || ''}`, 160),
      ld: [c.crumbsLd(errTrail, { name: c.clip(m.message, 80), url: m.url })],
      pagefind: true,
      content: `${c.crumbsHtml(errTrail)}
<h1 id="error"><code class="sv-errmsg">${c.esc(m.message)}</code></h1>
<div class="sv-meta">${m.source ? `<span><b>where:</b> ${c.esc(m.source)}</span>` : ''}${m.status ? `<span><b>HTTP:</b> <a href="/errors/http-${m.status}">${m.status} ${c.esc(STATUS_NAMES[m.status] || '')}</a></span>` : ''}</div>
<p>${m.items.length > 1 ? `This message shows up in ${m.items.length} different situations. Pick the one that matches yours:` : 'What causes it and how to fix it:'}</p>
${why(m.items)}
<p><a href="/errors">← all error messages and status codes</a></p>`,
    });
    c.extraUrls.push(m.url);
  }
  for (const [code, set] of byStatus) {
    const url = `/errors/http-${code}`;
    const items = [...set].sort((a, b) => short(a).localeCompare(short(b)));
    c.writePage(url, {
      title: `HTTP ${code} ${STATUS_NAMES[code]} in SharePoint, Graph and Azure: ${items.length} known causes`,
      description: c.clip(`HTTP ${code} ${STATUS_NAMES[code]} from SharePoint, SPFx, Microsoft Graph or the Azure services around them: ${items.slice(0, 3).map(short).join('; ')}.`, 160),
      ld: [c.crumbsLd(errTrail, { name: `${code} ${STATUS_NAMES[code]}`, url })],
      pagefind: true,
      content: `${c.crumbsHtml(errTrail)}
<h1 id="status">${code} ${c.esc(STATUS_NAMES[code])}</h1>
<p>Situations in the vault where SharePoint, SPFx, Microsoft Graph or the Azure services around them answer with HTTP ${code}. Each one explains why it happens and how to fix it.</p>
${c.cardList(items)}
<p><a href="/errors">← all error messages and status codes</a></p>`,
    });
    c.extraUrls.push(url);
  }
  const statusRows = [...byStatus.entries()].sort((a, b) => a[0] - b[0]).map(([code, set]) => {
    const items = [...set].sort((a, b) => short(a).localeCompare(short(b)));
    return `<tr data-svf="${code} ${c.esc(STATUS_NAMES[code])} ${c.esc(items.map(short).join(' ').toLowerCase())}"><td><a href="/errors/http-${code}">${code}</a></td><td>${c.esc(STATUS_NAMES[code])}</td><td>${items.length} ${items.length === 1 ? 'cause' : 'causes'}: ${items.slice(0, 4).map((q) => `<a href="${q.url}">${c.esc(short(q))}</a>`).join(' · ')}${items.length > 4 ? ` · <a href="/errors/http-${code}">all ${items.length} →</a>` : ''}</td></tr>`;
  }).join('');
  const groups = new Map();
  for (const m of msgs) { const k = m.source || 'Other'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
  const msgHtml = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([src, list]) => `<h3 id="${urlSlug(src)}">${c.esc(src)} <small style="color:var(--soft)">${list.length}</small></h3>
<ul class="sv-msgs">${list.map((m) => `<li data-svf="${c.esc((m.message + ' ' + (m.status || '') + ' ' + m.items.map(short).join(' ')).toLowerCase())}"><a href="${m.url}"><code>${c.esc(m.message)}</code></a>${m.status ? ` <span class="sv-sec">${m.status}</span>` : ''}</li>`).join('')}</ul>`).join('\n');
  c.writePage('/errors', {
    title: 'SharePoint error lookup: status codes and error messages',
    description: `Paste the error you got. ${byStatus.size} HTTP status codes and ${msgs.length} exact SharePoint, SPFx and Microsoft Graph error messages, each linked to the cause and the fix.`,
    ld: [c.crumbsLd(vault, { name: 'Error lookup', url: '/errors' })],
    pagefind: true,
    content: `${c.crumbsHtml(vault)}
<h1 id="error-lookup">Error lookup</h1>
<blockquote><p>Got an error from SharePoint, SPFx or Microsoft Graph? Type a status code or a few words of the message. Every entry leads to the article that explains <b>why</b> it happens and how to fix it. The messages are copied verbatim from the articles.</p></blockquote>
<input class="sv-filter" type="search" placeholder="filter: 404, threshold, access denied…" aria-label="Filter errors" oninput="var q=this.value.toLowerCase();document.querySelectorAll('[data-svf]').forEach(function(r){r.style.display=!q||r.getAttribute('data-svf').indexOf(q)>-1?'':'none'})">
<h2 id="by-status">By HTTP status</h2>
<table class="sv-errs"><thead><tr><th>Status</th><th>Meaning</th><th>Where it shows up</th></tr></thead><tbody>${statusRows}</tbody></table>
<h2 id="by-message">By error message</h2>
${msgHtml}`,
  });
  c.extraUrls.push('/errors');
  stats.errors = `${byStatus.size} status codes, ${msgs.length} messages`;

  // ── reading paths and Top 10 collections ───────────────────────────────────
  const col = readJson(c.ROOT, '_data/collections.json');
  if (col) {
    const startTrail = [...vault, { name: 'Start here', url: '/start/' }];
    const list = (items, where) => `<ol class="sv-path">${items.map((it) => {
      const q = need(it.path, where);
      return `<li><a href="${q.url}">${c.esc(c.deEmoji(q.title))}</a><span class="sv-why">${c.esc(it.why)}</span>${q.summary ? `<span class="sv-sum">${c.esc(c.clip(q.summary, 220))}</span>` : ''}</li>`;
    }).join('')}</ol>`;
    const all = [...col.paths.map((x) => ({ ...x, url: `/start/${x.slug}` })), ...col.top.map((x) => ({ ...x, url: `/top/${x.slug}` }))];
    for (const x of all) {
      c.writePage(x.url, {
        title: x.title, description: c.clip(x.intro, 160),
        ld: [c.crumbsLd(startTrail, { name: x.title, url: x.url }),
          { '@context': 'https://schema.org', '@type': 'ItemList', name: x.title, itemListElement: x.items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, url: c.SITE + need(it.path, x.url).url })) }],
        content: `${c.crumbsHtml(startTrail)}
<h1 id="list">${c.esc(x.title)}</h1>
<p class="sv-lead">${c.esc(x.intro)}</p>
${list(x.items, x.url)}
<p><a href="/start/">← all reading paths and Top 10 lists</a></p>`,
      });
      c.extraUrls.push(x.url);
    }
    const tile = (x) => `<li><a href="${x.url}">${c.esc(x.title)}</a><span class="sv-sum">${c.esc(x.intro)}</span></li>`;
    c.writePage('/start/', {
      title: 'Start here: reading paths and Top 10 lists',
      description: 'Where to begin in the SharePoint Vault: reading paths for admins, SPFx developers and Graph developers, and Top 10 lists of the traps that cost the most time.',
      ld: [c.crumbsLd(vault, { name: 'Start here', url: '/start/' })],
      content: `${c.crumbsHtml(vault)}
<h1 id="start-here">Start here</h1>
<p class="sv-lead">Hundreds of notes are a lot to browse. These short lists pick the ones worth reading first.</p>
<h2 id="paths">Reading paths by role</h2>
<ul class="sv-cards">${col.paths.map((x) => tile({ ...x, url: `/start/${x.slug}` })).join('')}</ul>
<h2 id="top">Top 10 lists</h2>
<ul class="sv-cards">${col.top.map((x) => tile({ ...x, url: `/top/${x.slug}` })).join('')}</ul>`,
    });
    c.extraUrls.push('/start/');
    stats.collections = `${col.paths.length} paths, ${col.top.length} top lists`;
  }

  // ── what's new + Atom feed ──────────────────────────────────────────────────
  const content = c.pages.filter((p) => p.kind !== 'index' && c.gitAdded[p.rel]);
  const newest = content.slice().sort((a, b) => c.gitAdded[b.rel].localeCompare(c.gitAdded[a.rel]));
  const now = Date.now();
  const days = (iso) => (now - Date.parse(iso)) / 86400000;
  const recentNew = newest.filter((p) => days(c.gitAdded[p.rel]) <= 60);
  const recentNewSet = new Set(recentNew);
  const updated = c.pages.filter((p) => p.kind === 'article' && !recentNewSet.has(p) && p.data['last-reviewed'] && days(p.data['last-reviewed']) <= 30)
    .sort((a, b) => b.data['last-reviewed'].localeCompare(a.data['last-reviewed']));
  const byMonth = new Map();
  for (const p of recentNew) {
    const k = new Date(c.gitAdded[p.rel]).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(p);
  }
  const dated = (items, when) => `<ul class="sv-cards">${items.map((q) => `<li><a href="${q.url}">${c.esc(c.deEmoji(q.title))}</a><span class="sv-sec">${when(q)}</span>${q.summary ? `<span class="sv-sum">${c.esc(c.clip(q.summary, 220))}</span>` : ''}</li>`).join('')}</ul>`;
  c.writePage('/whats-new', {
    title: "What's new in the SharePoint Vault",
    description: `New and recently reviewed SharePoint gotchas, guides and scripts: ${recentNew.length} added in the last 60 days. Subscribe via the Atom feed.`,
    ld: [c.crumbsLd(vault, { name: "What's new", url: '/whats-new' })],
    content: `${c.crumbsHtml(vault)}
<h1 id="whats-new">What's new</h1>
<p class="sv-lead">Added in the last 60 days, newest first. Follow along in your feed reader:<a href="/feed.xml">Atom feed</a>.</p>
${[...byMonth.entries()].map(([k, list]) => `<h2 id="${urlSlug(k)}">${c.esc(k)} <small style="color:var(--soft)">${list.length} new</small></h2>\n${dated(list, (q) => c.gitAdded[q.rel].slice(0, 10))}`).join('\n')}
${updated.length ? `<h2 id="reviewed">Recently reviewed</h2>\n<p>Existing articles checked and updated in the last 30 days.</p>\n${dated(updated, (q) => 'reviewed ' + q.data['last-reviewed'])}` : ''}`,
  });
  c.extraUrls.push('/whats-new');
  const xml = (s) => c.esc(s).replace(/'/g, '&apos;');
  const entries = newest.slice(0, 40);
  writeFileSync(join(c.OUT, 'feed.xml'), `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>SharePoint Vault — new articles</title>
  <subtitle>Field-tested scripts, gotchas and guides for SharePoint professionals.</subtitle>
  <link href="${c.SITE}/feed.xml" rel="self"/>
  <link href="${c.SITE}/whats-new"/>
  <id>${c.SITE}/</id>
  <updated>${entries.length ? c.gitAdded[entries[0].rel] : new Date().toISOString()}</updated>
  <author><name>Kamil Juřík</name></author>
${entries.map((p) => `  <entry>
    <title>${xml(c.deEmoji(p.title))}</title>
    <link href="${c.SITE}${p.url}"/>
    <id>${c.SITE}${p.url}</id>
    <published>${c.gitAdded[p.rel]}</published>
    <updated>${c.gitDate[p.rel] || c.gitAdded[p.rel]}</updated>
    <summary>${xml(p.summary || '')}</summary>
  </entry>`).join('\n')}
</feed>
`);
  stats.feed = `${entries.length} feed entries, ${recentNew.length} new in 60 days`;
  return stats;
}

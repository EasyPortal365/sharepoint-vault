---
title: "What each format costs the model: tokens for the same content as .md, .docx, .pdf and a SharePoint page"
tags: [rag, tokens, files, markdown, pdf, docx, search, architecture]
applies-to: SharePoint Online
last-reviewed: 2026-07-19
---

# What each format costs the model: tokens for the same content as `.md`, `.docx`, `.pdf` and a SharePoint page

You're feeding SharePoint content to an LLM — a RAG pipeline, a Copilot-adjacent tool, your own agent. Tokens are the meter: they cost money, they cost latency, and they cost context-window headroom you'd rather spend on *more sources* than on scaffolding around one. So a fair question before you design the pipeline: **does the source format change the bill?**

The companion guide, [choosing a knowledge format for RAG](choosing-a-knowledge-format-for-sharepoint-rag.md), answers this qualitatively. This one puts **measured numbers** on it. One representative intranet article — a ~500-word external-sharing policy with headings, two lists, and a table — rendered into Markdown, a Word document, a PDF, and a SharePoint page, then tokenized with the real tokenizers and extracted with the real tools a pipeline actually uses.

## TL;DR

**The format barely changes the token bill — how you *extract* it changes everything.** Feed clean text and every format lands within a few percent of Markdown. Feed the model whatever a naive connector hands you — raw Office XML, the page's JSON envelope, a rendered `.aspx` — and you pay a 2×–6× (or worse) tax in tokens, most of it pure scaffolding the model has to read past.

| Source | What reaches the model | Bytes | Tokens (o200k) | vs `.md` |
|---|---|---:|---:|---:|
| **Markdown `.md`** | the file *is* the text | 3,105 | **573** | 1.00× |
| **DOCX** — clean extract (`mammoth`) | flattened text | 3,015 | 541 | 0.94× |
| **DOCX** — raw `document.xml` (naive) | OOXML markup | 9,597 | **3,213** | **5.6×** |
| **PDF** — real extract (`pdf-parse`) | text + page furniture | 3,174 | 612 | 1.07× |
| **SP page** — stripped to text | clean text | 2,974 | 514 | 0.90× |
| **SP page** — `innerHTML` (RTE) | authored HTML | 4,587 | 1,074 | 1.87× |
| **SP page** — `CanvasContent1` field | web-part JSON + HTML | 5,006 | 1,236 | **2.2×** |

*o200k_base tokenizer (GPT-4o / 4.1 / 5, and Copilot). cl100k_base (GPT-4 classic) is within ~1 % on this English text; Claude's tokenizer is proprietary but lands in the same ballpark. Reproduce every number in this table with the [script below](#reproduce-it-yourself) — same script, same numbers, no randomness.*

## The one-sentence version

After clean extraction, DOCX (541), the SharePoint page (514), Markdown (573) and PDF (612) are **the same article in the same ballpark** — because they *are* the same words. Two things move the needle, and neither is "the format":

1. **How you extract.** The gap between DOCX-done-right (541 tokens) and DOCX-done-naively (3,213) is **6×**, on identical content. That gap is the whole game.
2. **What structure survives.** Markdown costs a few tokens more than stripped text (573 vs 514) — and that's a *feature*: those tokens are the `#` headings, the `|` table, the list markers. Stripped text is cheaper because it threw the outline away. The model reads word-soup for less, and answers worse.

## Method (so you can trust — or break — the numbers)

- **One source of truth:** a single structured article (H1/H2/H3, a bulleted list, a numbered list, a 4×5 table, ~500 words) rendered into every format from the *same* blocks, so content is constant and format is the only variable.
- **Real tokenizers:** [`gpt-tokenizer`](https://www.npmjs.com/package/gpt-tokenizer) — `o200k_base` (current OpenAI models + Microsoft 365 Copilot) and `cl100k_base` (GPT-4 classic).
- **Real extraction, not a strawman:** DOCX through [`mammoth`](https://www.npmjs.com/package/mammoth) (what browser and server pipelines use), PDF through [`pdf-parse`](https://www.npmjs.com/package/pdf-parse). The "naive" rows are things people genuinely do — dumping `document.xml`, feeding the page's stored field verbatim.
- **A realistic SharePoint page:** `CanvasContent1` is the actual field shape (a `controlType: 4` text web part carrying `innerHTML`, plus the settings slice — see [creating a modern page via REST](../gotchas/rest-api/create-modern-page-via-rest-sitepages.md)), and the HTML carries the `data-sp-rte-*` decoration the editor really writes.

## Reading the table, format by format

### Markdown — the baseline, and it earns it

The file is the payload: `fetch`, read, done. No parser, no server round-trip, no binary to download. Its ~11 % overhead over stripped text (573 vs 514) buys structure that stays *in-band* and that LLMs are natively trained to follow. Nothing on this table reads more cheaply while keeping its outline.

### DOCX — clean if you parse it, a bomb if you don't

Run it through a parser and it's the *cheapest* row (541) — because extraction flattens headings, lists, and the table into undifferentiated paragraphs. You keep the words and lose the skeleton; tables especially tend to melt into word-soup. The number to fear is the naive one: unzip the `.docx`, feed `word/document.xml` to the model, and the same 500 words become **3,213 tokens** — nearly all of it `<w:p><w:r><w:t>` OOXML wrapping. Some "just send it the document" integrations do exactly this.

Note the bytes, too: 10 KB on disk for 541 tokens of text — and that's a *minimal* generated file. Real Word documents carry embedded fonts, themes, and revision data and routinely run to **megabytes for a page of text**. That weight is transfer-and-parse cost, not token cost — but it's why "just download and send the docs" doesn't scale.

### PDF — the tax is invisible until you read the extract

`pdf-parse` does a good job, and it *still* comes out **~7 % heavier than Markdown** (612 vs 573) — on a two-page document. The extra isn't content — it's furniture: the running header and footer and "Page 1 of 2" that repeat on **every** page, re-tokenized each time, so the overhead grows with page count and with how much your org crams into headers and footers (logo alt text, classification banners, legal footers). And this is the *best* case: a born-digital PDF with a clean text layer. Scanned PDFs (no text layer — you're now paying for OCR, or getting nothing), multi-column layouts (extractors interleave columns into nonsense), and ligature/hyphenation artifacts all push it higher and dirtier. PDF's small byte size here is an artifact of the test — this PDF embeds no fonts; a real "Save as PDF" from Office adds 100–500 KB of font subsets that, again, never reach the model.

### SharePoint page — depends entirely on *how* you read it

Three very different numbers for one page:

- **Stripped to text (514):** cheapest of all — but you had to fetch the page, find the content, and strip HTML to get here.
- **`innerHTML` (1,074, ~1.9×):** the authored HTML with its `data-sp-rte-*` decoration, fed as-is.
- **`CanvasContent1` (1,236, ~2.2×):** the stored field verbatim — web-part JSON wrapping escaped HTML. Read the page over REST without stripping and *this* is what you're paying for.

And then there's the rendered `.aspx` — the cheap-looking option ("just fetch the page URL") that's the trap. A rendered modern page is suite chrome, script tags, and a large preloaded JSON state wrapped around a few KB of content. I put **no single number** on it here because it varies from ~150 KB to over 1 MB depending on the page and the SharePoint build — but that's **one to two orders of magnitude** above the authored content. Measure your own in the browser console on any modern page:

```js
new Blob([document.documentElement.outerHTML]).size  // bytes of rendered HTML; ÷ ~4 ≈ tokens
```

If a pipeline fetches the rendered page and truncates to a token budget, the real content can fall *behind* the cutoff entirely — you pay top dollar and answer from the chrome. Read `CanvasContent1` and strip it instead.

## Bytes are not tokens

The two columns tell different stories, and conflating them leads to wrong decisions:

- **Bytes** = storage, transfer, and parse cost. DOCX and PDF inflate here (ZIP containers, embedded fonts, binary structure).
- **Tokens** = the LLM bill. Only the *extracted* content counts; fonts and ZIP overhead never reach the model.

So "DOCX is 10 KB and Markdown is 3 KB" tells you nothing about the token cost — both are ~540–570 tokens once extracted. Optimize bytes for your I/O and storage; optimize tokens for your model budget. They are not the same axis.

## One more axis: language

Same article, English vs Czech, Markdown, so language is the only variable (same harness, with the blocks translated):

| | tokens/word (o200k) | tokens/word (cl100k) |
|---|---:|---:|
| English | 1.16 | 1.16 |
| Czech | 2.19 | 2.78 |
| **Czech ÷ English** | **1.89×** | **2.41×** |

The same knowledge in Czech costs **~1.9× the tokens** on current models — and **~2.4×** on GPT-4-classic. Two takeaways for non-English knowledge bases: budget context windows and cost accordingly, and prefer current-generation models — the newer `o200k` tokenizer is dramatically kinder to Czech (2.19 vs 2.78 tokens/word) because its vocabulary covers the language better. The gap is larger still for heavily inflected or non-Latin scripts. Measure your language before you size a budget.

## What to do

Everything here points one way: **spend your token budget on content, not on scaffolding.**

1. **Extract, don't dump.** Never feed raw `document.xml`, a `CanvasContent1` blob, or a rendered page to the model. That single discipline is the difference between 1× and 2–6×.
2. **Read pages from `CanvasContent1`, not the rendered URL** — then strip to text. (Or better, see #4.)
3. **Parse DOCX with a real library** (`mammoth` et al.), accept that structure flattens, and lean on metadata to carry the outline the extract loses.
4. **Publish a Markdown derivative** of approved knowledge into a dedicated library — the [author-here-publish-Markdown pattern](choosing-a-knowledge-format-for-sharepoint-rag.md#a-pragmatic-architecture). You get Markdown-grade extraction *and* keep the structure the other formats throw away, for a few percent over stripped text.
5. **Size budgets in the target language**, not in English-token intuition.

## Reproduce it yourself

Numbers you can't re-run are just vibes. This is the whole harness — drop it in a folder, install the five packages, run it:

```bash
npm init -y
npm i gpt-tokenizer docx mammoth pdfkit pdf-parse adm-zip
node bench.js
```

```js
// bench.js — same content, four formats, real tokenizers + real extractors.
const o200k = require('gpt-tokenizer/encoding/o200k_base');
const cl100k = require('gpt-tokenizer/encoding/cl100k_base');
const { Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell, WidthType } = require('docx');
const PDFDocument = require('pdfkit');
const mammoth = require('mammoth');
const { PDFParse } = require('pdf-parse');
const AdmZip = require('adm-zip');

const tok = (s) => ({ o200k: o200k.encode(s).length, cl100k: cl100k.encode(s).length });
const bytes = (s) => Buffer.byteLength(s, 'utf8');

// The exact ~500-word article behind the table above. Swap in your own to get your own budget.
const blocks = [
  { t: 'h1', text: 'External Sharing Policy' },
  { t: 'p', text: 'This policy explains how staff may share SharePoint and OneDrive content with people outside the organization. It applies to every site collection in the tenant and to all file and folder sharing links. The goal is to let teams collaborate with clients and partners without exposing information that should stay internal.' },
  { t: 'h2', text: 'Scope and definitions' },
  { t: 'p', text: 'An external user is anyone whose account does not belong to the corporate directory. That includes clients, contractors, and partners invited as guests, as well as anonymous recipients of "Anyone" links. Sharing means any mechanism that grants an external user read or edit access: a sharing link, a direct permission grant, or membership in a site or group.' },
  { t: 'ul', items: [
    'Guest: an external person invited into the directory, who signs in to access content.',
    'Anonymous link: a URL that grants access without any sign-in, to whoever holds it.',
    'Sensitivity label: a classification applied to a file or site that can enforce sharing limits automatically.',
  ] },
  { t: 'h2', text: 'What is allowed' },
  { t: 'p', text: 'Sharing with named external guests is permitted for business collaboration when the content is classified General or Public. Site owners are responsible for reviewing guest access on their sites at least quarterly and removing guests who no longer need it. When in doubt, prefer inviting a named guest over creating an anonymous link, because guest access is auditable and revocable per person.' },
  { t: 'h2', text: 'What is restricted' },
  { t: 'ol', items: [
    'Anonymous "Anyone" links are disabled tenant-wide for document libraries that hold Confidential content.',
    'Content labeled Confidential or Highly Confidential may never be shared externally without written approval from the data owner.',
    'External sharing of an entire site is limited to sites explicitly provisioned for extranet collaboration.',
    'Bulk download by an external user triggers an alert to the compliance team and may lead to access review.',
  ] },
  { t: 'h2', text: 'How to request an exception' },
  { t: 'p', text: 'If a project genuinely needs to share Confidential content with a partner, the site owner submits a request to the information security team describing the recipient, the business justification, and the duration. Approved exceptions are time-boxed and reviewed at expiry. Exceptions are never open-ended.' },
  { t: 'h3', text: 'Approval matrix' },
  { t: 'table', headers: ['Content class', 'Named guest', 'Anonymous link', 'Approval needed'],
    rows: [
      ['Public', 'Allowed', 'Allowed', 'None'],
      ['General', 'Allowed', 'Site owner only', 'None'],
      ['Confidential', 'With approval', 'Never', 'Data owner'],
      ['Highly Confidential', 'With approval', 'Never', 'Security team'],
    ] },
  { t: 'h2', text: 'Monitoring and enforcement' },
  { t: 'p', text: 'The compliance team reviews external sharing activity through the Microsoft Purview audit log and the sharing reports in the SharePoint admin center. Repeated policy violations are escalated to the manager. Automated policies remove anonymous links older than ninety days and flag guests who have not signed in for sixty days.' },
  { t: 'p', text: 'Questions about this policy go to the information security team. This document is reviewed twice a year and after any material change to the tenant sharing configuration.' },
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function toMarkdown(bs) {
  return bs.map(b =>
    b.t === 'h1' ? '# ' + b.text : b.t === 'h2' ? '## ' + b.text : b.t === 'h3' ? '### ' + b.text :
    b.t === 'p' ? b.text :
    b.t === 'ul' ? b.items.map(i => '- ' + i).join('\n') :
    b.t === 'ol' ? b.items.map((i, n) => (n + 1) + '. ' + i).join('\n') :
    b.t === 'table' ? ['| ' + b.headers.join(' | ') + ' |', '| ' + b.headers.map(() => '---').join(' | ') + ' |',
      ...b.rows.map(r => '| ' + r.join(' | ') + ' |')].join('\n') : ''
  ).join('\n\n') + '\n';
}
function toHtml(bs, rte = false) {
  const a = rte ? ' data-sp-rte-mode=""' : '';
  return bs.map(b =>
    b.t === 'h1' ? `<h1${a}>` + esc(b.text) + '</h1>' : b.t === 'h2' ? `<h2${a}>` + esc(b.text) + '</h2>' :
    b.t === 'h3' ? `<h3${a}>` + esc(b.text) + '</h3>' : b.t === 'p' ? `<p${a}>` + esc(b.text) + '</p>' :
    b.t === 'ul' ? `<ul${a}>` + b.items.map(i => `<li><span${a}>` + esc(i) + '</span></li>').join('') + '</ul>' :
    b.t === 'ol' ? `<ol${a}>` + b.items.map(i => `<li><span${a}>` + esc(i) + '</span></li>').join('') + '</ol>' :
    b.t === 'table' ? `<table${a}><tbody><tr>` + b.headers.map(h => `<td><span${a}>` + esc(h) + '</span></td>').join('') +
      '</tr>' + b.rows.map(r => '<tr>' + r.map(c => `<td><span${a}>` + esc(c) + '</span></td>').join('') + '</tr>').join('') +
      '</tbody></table>' : ''
  ).join('');
}
const stripHtml = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

async function toDocx(bs) {
  const kids = [];
  for (const b of bs) {
    if (b.t === 'h1') kids.push(new Paragraph({ text: b.text, heading: HeadingLevel.HEADING_1 }));
    else if (b.t === 'h2') kids.push(new Paragraph({ text: b.text, heading: HeadingLevel.HEADING_2 }));
    else if (b.t === 'h3') kids.push(new Paragraph({ text: b.text, heading: HeadingLevel.HEADING_3 }));
    else if (b.t === 'p') kids.push(new Paragraph({ children: [new TextRun(b.text)] }));
    else if (b.t === 'ul') b.items.forEach(i => kids.push(new Paragraph({ text: i, bullet: { level: 0 } })));
    else if (b.t === 'ol') b.items.forEach(i => kids.push(new Paragraph({ text: i, numbering: { reference: 'n', level: 0 } })));
    else if (b.t === 'table') kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [new TableRow({ children: b.headers.map(h => new TableCell({ children: [new Paragraph(h)] })) }),
        ...b.rows.map(r => new TableRow({ children: r.map(c => new TableCell({ children: [new Paragraph(c)] })) }))] }));
  }
  return Packer.toBuffer(new Document({
    numbering: { config: [{ reference: 'n', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: 'start' }] }] },
    sections: [{ children: kids }] }));
}
function toPdf(bs) {
  return new Promise((res) => {
    const doc = new PDFDocument({ margin: 54, bufferPages: true }); const cks = [];
    doc.on('data', c => cks.push(c)); doc.on('end', () => res(Buffer.concat(cks)));
    for (const b of bs) {
      if (b.t === 'h1') doc.moveDown(0.5).fontSize(20).font('Helvetica-Bold').text(b.text);
      else if (b.t === 'h2') doc.moveDown(0.4).fontSize(15).font('Helvetica-Bold').text(b.text);
      else if (b.t === 'h3') doc.moveDown(0.3).fontSize(13).font('Helvetica-Bold').text(b.text);
      else if (b.t === 'p') doc.fontSize(11).font('Helvetica').text(b.text).moveDown(0.3);
      else if (b.t === 'ul' || b.t === 'ol') { doc.fontSize(11).font('Helvetica'); b.items.forEach((i, n) => doc.text((b.t === 'ol' ? (n + 1) + '. ' : '• ') + i)); doc.moveDown(0.3); }
      else if (b.t === 'table') { doc.fontSize(10).font('Helvetica').text(b.headers.join('  |  ')); b.rows.forEach(r => doc.text(r.join('  |  '))); doc.moveDown(0.3); }
    }
    const rng = doc.bufferedPageRange();
    for (let i = 0; i < rng.count; i++) {
      doc.switchToPage(rng.start + i); // switchToPage doesn't return the doc, so don't chain off it
      doc.fontSize(8).font('Helvetica').fillColor('gray')
        .text('External Sharing Policy — Information Security — CONFIDENTIAL', 54, 24, { align: 'center', width: doc.page.width - 108 })
        .text('Page ' + (i + 1) + ' of ' + rng.count + '   |   Reviewed 2026   |   Internal use only', 54, doc.page.height - 40, { align: 'center', width: doc.page.width - 108 });
    }
    doc.end();
  });
}

(async () => {
  const md = toMarkdown(blocks);
  const docxBuf = await toDocx(blocks), pdfBuf = await toPdf(blocks);
  const canvas = JSON.stringify([{ controlType: 4, id: '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', position: { controlIndex: 1, sectionIndex: 1, zoneIndex: 1, sectionFactor: 12, layoutIndex: 1 }, emphasis: {}, displayMode: 2, innerHTML: toHtml(blocks, true), editorType: 'CKEditor' }, { controlType: 0, pageSettingsSlice: { isEnabledOnConsumerSites: true, isEnabledOnPublishing: true } }]);
  const docXml = new AdmZip(docxBuf).getEntry('word/document.xml').getData().toString('utf8');
  const docxText = (await mammoth.extractRawText({ buffer: docxBuf })).value;
  const pdfText = (await new PDFParse({ data: pdfBuf }).getText()).text;

  const row = (label, s) => console.log(label.padEnd(38), String(bytes(s)).padStart(7), String(tok(s).o200k).padStart(7), (tok(s).o200k / tok(md).o200k).toFixed(2) + 'x');
  console.log('VARIANT'.padEnd(38), 'BYTES'.padStart(7), 'o200k'.padStart(7), 'vs md');
  row('Markdown .md', md);
  row('DOCX raw document.xml (naive)', docXml);
  row('DOCX mammoth (clean)', docxText);
  row('PDF pdf-parse (real extract)', pdfText);
  row('SP CanvasContent1 (JSON+HTML)', canvas);
  row('SP innerHTML (RTE)', toHtml(blocks, true));
  row('SP stripped to text', stripHtml(toHtml(blocks, true)));
})();
```

Run it against *your* content — a longer article, your language, your typical page — before you commit an architecture to numbers. The ratios above are stable, but the absolute budget is yours to measure.

## Related

- [Choosing a knowledge format for RAG](choosing-a-knowledge-format-for-sharepoint-rag.md) — the qualitative decision this guide quantifies
- [Create a modern page via REST — `CanvasContent1` is JSON](../gotchas/rest-api/create-modern-page-via-rest-sitepages.md)
- [SPO indexes `.md` full-text despite the docs](../gotchas/search/md-is-fulltext-indexed-despite-the-docs.md)
- [Cap the decompressed size before extracting Office files](../gotchas/spfx/office-file-extraction-needs-a-decompressed-size-cap.md) — the flip side: a `.docx` is a zip, and zips can bomb

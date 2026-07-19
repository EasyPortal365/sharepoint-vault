---
title: "What each format costs the model: tokens for the same content as .md, .docx, .pdf and a SharePoint page"
tags: [rag, tokens, files, markdown, pdf, docx, search, architecture]
applies-to: SharePoint Online
last-reviewed: 2026-07-19
---

# What each format costs the model: tokens for the same content as `.md`, `.docx`, `.pdf` and a SharePoint page

> **Bottom line.** In SharePoint RAG the token count is practically the same across formats, so it doesn't decide anything. What decides is how much *structure* survives extraction — and there Markdown (or a published Markdown derivative) is measurably better for anything with tables, at the same token count. For plain paragraph text, parsed DOCX really is equivalent.
>
> **Ve zkratce.** Token count formátů je v RAG nad SharePointem prakticky jedno – nerozhoduje. Co rozhoduje, je kolik struktury přežije extrakci – a tam je Markdown (nebo publikovaný MD derivát) měřitelně lepší pro cokoli s tabulkami, při stejném počtu tokenů. Pro prostý odstavcový text je parsovaný DOCX opravdu ekvivalent.

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

> **Don't read this as a price list.** The cheapest-looking row — DOCX at 541, *below* Markdown — is cheapest **because extraction threw the structure away**, not because it's a better format. Token count is one line of the bill. The next two sections are why the lower number is the *lossier* one, and what the whole bill actually looks like.

## The "DOCX is cheaper" trap

After clean extraction, DOCX (541), the SharePoint page (514), Markdown (573) and PDF (612) are **the same article in the same ballpark** — because they *are* the same words. DOCX even lands *below* Markdown. **Don't conclude "so DOCX is cheaper — use DOCX." That number is a trap:**

- **The lower count is lossier, not cheaper.** DOCX comes out under Markdown *because `mammoth` flattened the structure to get there*: headings merge into paragraphs, the table dissolves into word-soup. Markdown's ~30 extra tokens aren't waste — they're the `#` headings, the `|` table, the list markers the model reads *as* structure. You didn't save tokens; you deleted the outline, and the model answers worse from the flatter input. It's like weighing a book after tearing out the table of contents and the index — lighter, sure, but you threw away the navigation.
- **Token count is only the text line of the bill.** Everything else in the DOCX chain — downloading the binary, running a parser, the lossy tables, and the **5.6×** you pay if anyone skips the parser — is cost the token column never shows. [The whole bill is below.](#the-whole-bill-total-cost-not-just-tokens)

Two things actually move the needle, and neither is "the format":

1. **How you extract.** DOCX-done-right (541) vs DOCX-done-naively (3,213) is **6×** on identical content. That gap is the whole game.
2. **What structure survives.** The reason to prefer Markdown isn't its token count — that's *higher* — it's that the structure is still in the text, for a few percent over stripped word-soup.

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

**Watch it happen on a single heading.** The line *"External Sharing Policy"* reaches the model as one of three things, and the token counts are measured:

```
raw document.xml  → 46 tokens
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">External Sharing Policy</w:t></w:r></w:p>

mammoth (parsed)  →  3 tokens    External Sharing Policy
markdown          →  4 tokens    # External Sharing Policy
```

That one line *is* the whole DOCX range:

- **Raw XML = 46 tokens**, because every heading and paragraph is wrapped in `<w:p><w:r><w:t>` scaffolding (headings get an extra `<w:pStyle>`). The blow-up is worst on short blocks like this heading (15× here) and milder on long paragraphs; averaged across the whole document — headings, lists, a table, prose — it lands at **3,213**, a 5.6× tax. That's the *top* of the range, where nobody parsed it.
- **mammoth = 3 tokens** — the *bottom* of the range (541): cheapest, but the heading is now indistinguishable from body text. The `Heading1` style that said "this is a title" was thrown away.
- **markdown = 4 tokens** — one token more than the flattened text, and that one token (`#`) *is* the heading. You keep the structure for the price of a single character — which is exactly why Markdown's 573 total beats a structure-blind 541.

So **the DOCX range 541–3,213 is entirely "did anyone run a parser?"** A `.docx` is a zip of XML; a heading is 46 tokens of tags or 3 tokens of text depending on whether the pipeline unzipped-and-*dumped* or unzipped-and-*parsed*. Markdown has no such fork — it's the same handful of tokens either way, structure included.

**To be fair to Word: 541 is the normal case, not 3,213.** Every mainstream extractor — `mammoth`, Apache Tika, `python-docx`, `textract` — parses by default and throws the tags away, so any competent pipeline lands at the *bottom* of the range. The `<w:p><w:r><w:t>` scaffolding lives *inside the file*, but it never reaches the model once you parse it. The **3,213 is the cost of a mistake** — a "just hand the model the file" integration that ships the raw XML — not what you pay day to day. It's a real ceiling worth knowing (that mistake does ship), but it isn't the default. So the honest cost of DOCX isn't a number, it's a **dependency**: you only reach 541 by adding a download-and-parse step Markdown never needs — and you inherit the risk that someone, someday, skips it. Markdown is 573 with no step and nothing to skip.

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

## The whole bill: total cost, not just tokens

Token count is one column. The real cost of getting a source in front of the model is the whole row — fetch it, parse it, what structure you lose, and what it costs if someone takes the naive path — and that's where the formats stop looking alike:

| | Fetch | Extract | Tokens (clean) | Structure after extract | Naive-path risk | Wins at |
|---|---|---|---:|---|---|---|
| **Markdown** | `fetch` + read | none | **573** | intact, in-band | none — nothing to get wrong | the machine |
| **DOCX** | download binary (KB–MB) | real parser (`mammoth`) | 541 | lossy — headings flatten, tables → soup | **5.6×** if raw `document.xml` is sent | human authoring |
| **PDF** | download binary (+ embedded fonts) | parser; **OCR** if scanned | 612 | lossy + repeated page furniture | must always parse; multi-column interleaves | print / hand-off |
| **SP page** | REST call | strip HTML from `CanvasContent1` | 514 | intact *if* you strip | **2.2×** verbatim; rendered `.aspx` far worse | in-browser editing |

Read it across, not down. **Markdown is the only row that's cheap on *every* axis** — no binary to move, no parser to run, no structure lost, nothing to get wrong. It "pays" for that with the one thing the token column frames as a loss: ~30 tokens of markup that are, in fact, the outline. Every other format buys a similar-or-lower token count with a real cost somewhere else in the row — a download, a parser, a flattened table, a 2–6× multiplier one wrong turn away.

### The only "total" that's actually in tokens

A fair question is "so what's the *total* token cost, fetch and extraction included?" The honest answer: **fetch and extraction don't cost tokens at all.** Downloading a `.docx` is I/O (bytes, latency); parsing it with `mammoth` is CPU (milliseconds). Neither spends a single LLM token — only the resulting text does. Summing "541 tokens + the download + the parse" is adding apples to oranges; those are a different currency (time, CPU, fragility), shown on the left of the scorecard.

So the one number you *can* legitimately call the token total is **what actually lands in the model's context** — and it depends on the path:

| Source | Clean extraction | Naive (as the connector hands it over) |
|---|--:|--:|
| **Markdown** | **573** | 573 — no naive path to get wrong |
| **DOCX** | **541** | **3,213** (raw `document.xml`) |
| **PDF** | **612** | 612 is the floor — you must always parse |
| **SP page** | **514** | **1,236** (`CanvasContent1`) → far more (rendered `.aspx`) |

Read the *shape*, not just the low number. **Markdown's total is a single, stable figure (573). DOCX's is a range — 541 to 3,213** — running from cheapest to worst-on-the-page depending entirely on whether whoever built the pipeline parses the file or dumps its raw XML (a heading alone is **3 tokens parsed vs 46 raw**, as the DOCX section shows). **That spread, not the 541, is the honest total cost of choosing DOCX**: you're not buying 541 tokens, you're buying "541 if we parse it, 3,213 if someone doesn't." Markdown has no such fork — it reads the same either way.

And don't conflate the two size columns while you're here:

- **Bytes** = storage, transfer, parse cost. DOCX and PDF inflate here (ZIP containers, embedded fonts, binary structure) — "DOCX is 10 KB, Markdown is 3 KB" says *nothing* about tokens; both are ~540–570 once extracted.
- **Tokens** = the LLM bill. Only the *extracted* content counts; fonts and ZIP overhead never reach the model.

So the decision was never "which format has the fewest tokens" — they're all in the same range. It's "which format costs the least to turn into *good* input." Once fetch, extraction, lost structure, and naive-path risk are on the bill, Markdown wins the machine channel outright — and the others win the **human** channel, where people actually write. Which is the whole reason the pattern is *author where the UX is, publish a Markdown derivative for the machine.*

## "But my pipeline always parses — isn't DOCX ≈ Markdown then?"

The sharpest objection, and half right: a production RAG pipeline over SharePoint *does* always parse — nobody ships raw `document.xml` on purpose — so the 3,213 is off the table, and 541 vs 573 is within noise. **On token count, DOCX and Markdown are a tie.** That isn't a loophole in this guide; it *is* the guide's point — token count was never the axis.

But that tie was bought by **throwing structure away**, and *that* cost doesn't show up in the token column — it shows up in retrieval quality. Here's the sample's "Approval matrix" table after the parser everyone runs:

```
DOCX → mammoth extractRawText → the model sees:
  Content class ⏎ Named guest ⏎ Anonymous link ⏎ Approval needed ⏎
  Public ⏎ Allowed ⏎ Allowed ⏎ None ⏎
  Confidential ⏎ With approval ⏎ Never ⏎ Data owner ⏎ …
  — every cell on its own line; rows and columns gone

Markdown → the model sees:
  | Content class | Named guest | Anonymous link | Approval needed |
  | Confidential  | With approval | Never          | Data owner      |
```

Ask both *"can Confidential be shared via an anonymous link?"* Markdown answers unambiguously — the *Anonymous link* column for the *Confidential* row is **Never**. The flattened version is a bag of words: which "Never" goes with which column? The model guesses from order. Same token count, worse answer — and worse *chunking* and *embedding* upstream too, because the structure that told the retriever where one idea ends and the next begins is gone.

So the honest scope of "negligible":

- **Plain prose** — paragraphs, few headings, no tables: you're right, parsed DOCX ≈ Markdown. Use whatever authors prefer.
- **Structured content** — tables, matrices, deep hierarchy (permission grids, price lists, specs — SharePoint's bread and butter): the gap is real, and it's *not* in the tokens, it's in how well the model can read what it got. Markdown keeps that structure for a few percent of markup; raw-text DOCX loses it for free.
- **The escape hatch** — `mammoth.convertToHtml` — keeps the table (`<table><tr><td>`), but now you're paying HTML tokens and `<td><p>` cruft, spending the very token parity that made DOCX look equal.

Bottom line: **you were right that the token cost is a wash — which is exactly why the decision isn't about tokens.** It's about whether extraction keeps the structure, and for anything table-heavy, that's where DOCX and Markdown stop being equal.

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

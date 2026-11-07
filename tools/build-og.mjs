// Share images (og:image, 1200×630) for every article and script page.
//
//   node tools/build-og.mjs <outDir>     (after tools/build-site.mjs, which writes og-manifest.json)
//
// A link pasted into LinkedIn, Teams or Slack shows the title of THAT article
// instead of the same generic card for all 370 pages. Rendered by the Chrome the
// GitHub runner already has (puppeteer-core, no browser download); the card
// is the same design as assets/og-vault.png.
//
// Chrome: CHROME_PATH, else the usual install paths. Without Chrome the script
// says so and exits 0 — pages fall back to the generic image only if the file
// is missing, so a broken share image never blocks a deploy.
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const OUT = resolve(process.argv[2] || '_site');
const manifest = JSON.parse(readFileSync(join(OUT, 'og-manifest.json'), 'utf8'));
const CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const chrome = CANDIDATES.find((p) => existsSync(p));
if (!chrome) { console.warn('[build-og] no Chrome found (set CHROME_PATH) — share images skipped'); process.exit(0); }


const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@800&family=JetBrains+Mono:wght@500;700&display=block" rel="stylesheet">
<style>
html,body{margin:0;width:1200px;height:630px;overflow:hidden}
body{font-family:Manrope,sans-serif;color:#002163;background:#F6FAFC;position:relative}
body::before{content:'';position:absolute;inset:0;background:radial-gradient(700px 420px at 8% -10%,rgba(0,206,215,.22),transparent 62%),radial-gradient(760px 480px at 100% 120%,rgba(0,168,176,.16),transparent 62%)}
body::after{content:'';position:absolute;inset:0;background-image:linear-gradient(rgba(0,33,99,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(0,33,99,.05) 1px,transparent 1px);background-size:44px 44px}
.w{position:absolute;z-index:1;left:84px;right:84px;top:72px;bottom:150px;display:flex;flex-direction:column}
.k{font-family:'JetBrains Mono',monospace;font-size:22px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#00A8B0}
h1{font-weight:800;line-height:1.08;margin:26px 0 0;letter-spacing:-.015em;overflow:hidden}
.f{position:absolute;z-index:1;left:84px;right:84px;bottom:64px;display:flex;align-items:center;font-family:'JetBrains Mono',monospace;font-size:24px;font-weight:700}
.f .b{font-family:Manrope,sans-serif;font-size:30px}
.f .b i{font-style:normal;font-family:'JetBrains Mono',monospace;color:#00A8B0;font-size:24px;margin-left:8px}
.f .u{margin-left:auto;background:#002163;color:#fff;border-radius:999px;padding:12px 26px}
</style></head><body><div class="w"><div class="k" id="k"></div><h1 id="t"></h1></div>
<div class="f"><span class="b">SharePoint Vault<i>~$</i></span><span class="u">sharepointvault.online</span></div></body></html>`;

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630 });
  await page.setContent(PAGE, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  let n = 0;
  for (const item of manifest) {
    // Long titles step the font size down until the heading fits in its box.
    await page.evaluate((kicker, title) => {
      document.getElementById('k').textContent = kicker;
      const h = document.getElementById('t');
      h.textContent = title;
      const box = h.parentElement;
      let size = 76;
      h.style.fontSize = size + 'px';
      while (size > 34 && (h.scrollHeight > box.clientHeight - h.offsetTop || h.scrollWidth > h.clientWidth)) {
        size -= 4;
        h.style.fontSize = size + 'px';
      }
    }, item.kicker, item.title);
    const file = join(OUT, item.out.replace(/^\//, ''));
    mkdirSync(dirname(file), { recursive: true });
    await page.screenshot({ path: file, type: 'png' });
    n++;
  }
  console.log(`[build-og] ${n} share images → ${join(OUT, 'og')}`);
} finally {
  await browser.close();
}

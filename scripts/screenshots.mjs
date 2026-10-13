// Captures the README screenshots in docs/screenshots from a running instance with demo data loaded.
// Playwright is not a project dependency: run `npm i --no-save playwright` first.
// Usage: BASE_URL=http://localhost:3000 SHOT_USER=admin SHOT_PASSWORD=... node scripts/screenshots.mjs [outDir]
// Optional: CHROMIUM_PATH=/path/to/chromium
import { chromium } from 'playwright';

const out = process.argv[2] || 'docs/screenshots';
const base = process.env.BASE_URL || 'http://localhost:3000';
const user = process.env.SHOT_USER || 'admin';
const password = process.env.SHOT_PASSWORD || '';
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function session(lang, viewport, mobile) {
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, colorScheme: 'light',
    locale: lang === 'nl' ? 'nl-NL' : 'en-GB', timezoneId: 'Europe/Amsterdam',
  });
  const page = await ctx.newPage();
  await page.goto(base + '/');
  await page.fill('input[autocomplete=username]', user);
  await page.fill('input[type=password]', password);
  await page.click('button.btn-primary');
  await page.waitForSelector('nav a');
  await page.evaluate(async (l) => {
    await fetch('/api/me', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-requested-with': '8star-prep' }, body: JSON.stringify({ language: l }) });
  }, lang);
  await page.reload();
  await page.waitForSelector('nav a');
  return { ctx, page };
}

async function shot(page, route, file) {
  await page.goto(`${base}/#/${route}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(700);
  if (route === 'plan') {
    // Skip the options form so the screenshot shows the generated plan.
    await page.evaluate(() => {
      const el = document.querySelector('section.plan-summary');
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 16);
    });
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: `${out}/${file}.png` });
}

for (const lang of ['nl', 'en']) {
  const d = await session(lang, { width: 1440, height: 900 }, false);
  for (const r of ['dashboard', 'inventory', 'plan', 'expiry', 'catalogue', 'settings']) await shot(d.page, r, `${lang}-desktop-${r}`);
  await d.ctx.close();
  const m = await session(lang, { width: 390, height: 844 }, true);
  for (const r of ['dashboard', 'inventory', 'plan']) await shot(m.page, r, `${lang}-mobile-${r}`);
  await m.ctx.close();
}

await browser.close();

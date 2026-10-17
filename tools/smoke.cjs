#!/usr/bin/env node
// Browser smoke test: serves the repo, opens it in headless Chromium at phone width
// (light and dark), and fails on any console error, page error or CSP violation, or if
// the service worker doesn't install, the reader doesn't load the bundled LEB, or the
// page scrolls sideways. Requests to other hosts are blocked so the result doesn't
// depend on outside services (and nothing touches the live Supabase project).
// Needs Playwright (not vendored; CI installs it):
//   NODE_PATH="$(npm root -g)" node tools/smoke.cjs
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const PORT = 8790;
const ORIGIN = `http://127.0.0.1:${PORT}`;

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(ORIGIN)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

async function run(browser, colorScheme) {
  const problems = [];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme });
  await context.route((url) => url.origin !== ORIGIN, (route) => route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  page.on('console', (msg) => {
    // Blocked outside requests are expected; anything else logged as an error isn't.
    if (msg.type() === 'error' && !/net::ERR_FAILED/.test(msg.text())) problems.push(`console error: ${msg.text()}`);
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
  });
  const step = async (name, fn) => {
    try { await fn(); } catch (err) { problems.push(`${name}: ${err.message.split('\n')[0]}`); }
  };

  await page.goto(ORIGIN);
  await step('service worker installs', () => page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('not ready after 15 s')), 15000)),
  ])));
  await step('onboarding opens on first visit', () => page.locator('#onboarding[open]').waitFor({ timeout: 5000 }));
  await step('skipping onboarding shows the today card', async () => {
    await page.click('#ob-skip');
    await page.locator('#today-card [data-open]').first().waitFor({ timeout: 5000 });
  });
  await step('reader loads the bundled LEB', async () => {
    await page.locator('#today-card [data-open]').first().click();
    await page.locator('#reader[open] #reader-body .verse').first().waitFor({ timeout: 10000 });
    await page.click('#reader-close');
    await page.locator('#reader[open]').waitFor({ state: 'detached', timeout: 2000 }).catch(() => {});
    if (await page.evaluate(() => document.querySelector('#reader').open)) throw new Error('reader did not close');
  });
  await step('settings open', async () => {
    await page.click('#settings-btn');
    await page.locator('#settings[open]').waitFor({ timeout: 2000 });
  });
  await step('no sideways scroll at 390px', async () => {
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    if (width > 390) throw new Error(`page is ${width}px wide`);
  });
  await context.close();
  return problems.map((p) => `[${colorScheme}] ${p}`);
}

(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { stdio: 'ignore' });
  let problems = [];
  try {
    await waitForServer();
    const browser = await chromium.launch();
    for (const scheme of ['light', 'dark']) problems.push(...await run(browser, scheme));
    await browser.close();
  } catch (err) {
    problems.push(err.message);
  } finally {
    server.kill();
  }
  if (problems.length) {
    console.error(problems.map((p) => `✗ ${p}`).join('\n'));
    process.exit(1);
  }
  console.log('✓ smoke test passed (light and dark, 390px)');
})();

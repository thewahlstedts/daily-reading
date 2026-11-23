// Renders the iOS app icon's dark and tinted variants (1024 px, transparent
// background: iOS draws its own backdrop) into the Xcode asset catalog. The
// shapes are icon.svg's book and bookmark, with the spine cut out instead of
// drawn in the background color. Needs Playwright, like tools/smoke.cjs:
//   NODE_PATH="$(npm root -g)" node tools/ios_icon_variants.cjs
const { chromium } = require('playwright');

const OUT = 'ios/App/App/Assets.xcassets/AppIcon.appiconset';
const VARIANTS = { dark: ['#efe6d6', '#d9a046'], tinted: ['#ffffff', '#9a9a9a'] };

const svg = (page, mark) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="1024" height="1024">
  <mask id="spine"><rect width="64" height="64" fill="#fff"/><path d="M32 19v27.6" stroke="#000" stroke-width="2.4" stroke-linecap="round"/></mask>
  <path mask="url(#spine)" d="M32 19c-5-3.6-11.6-4.6-17-3.8v27.6c5.4-.8 12 .2 17 3.8 5-3.6 11.6-4.6 17-3.8V15.2c-5.4-.8-12 .2-17 3.8z" fill="${page}"/>
  <path d="M38 17.4v15l3.5-2.6 3.5 2.6V15.6c-2.4-.1-4.8.5-7 1.8z" fill="${mark}"/>
</svg>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  for (const [name, [pageColor, markColor]] of Object.entries(VARIANTS)) {
    await page.setContent(`<style>html, body { margin: 0; background: transparent; } svg { display: block; }</style>${svg(pageColor, markColor)}`);
    await page.screenshot({ path: `${OUT}/AppIcon-${name}.png`, omitBackground: true });
    console.log(`Wrote ${OUT}/AppIcon-${name}.png`);
  }
  await browser.close();
})();

#!/usr/bin/env node
// Copies the web app into www/ for the iOS build (`npm run ios:sync` then
// copies www/ into the Xcode project). The app is exactly the service worker's
// SHELL_FILES plus the bundled Bibles, so that list stays the one place that
// says what the app is made of. The usage dashboard is added too: it's left
// out of SHELL_FILES because the website only serves it online, but in the app
// it's just another local page. Run from the repo root.
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const OUT = 'www';
const APP_ONLY = ['admin.html', 'admin.js', 'admin.css'];
const { SHELL_FILES } = vm.runInNewContext(`${readFileSync('sw.js', 'utf8')}\n;({ SHELL_FILES })`, { self: { addEventListener() {} } });

rmSync(OUT, { recursive: true, force: true });
for (const file of [...SHELL_FILES, ...APP_ONLY]) {
  if (file === './') continue;
  mkdirSync(join(OUT, dirname(file)), { recursive: true });
  cpSync(file, join(OUT, file));
}
cpSync('bibles', join(OUT, 'bibles'), { recursive: true });
console.log(`Copied ${SHELL_FILES.length - 1 + APP_ONLY.length} app files and bibles/ into ${OUT}/`);

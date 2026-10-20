#!/usr/bin/env node
// Static checks for the rules in CLAUDE.md that otherwise fail silently once deployed.
// No dependencies. Run from the repo root:
//   node tools/check.mjs                 # syntax, shell files, CSP rules
//   node tools/check.mjs --base <ref>    # also: cached files changed since <ref> need a new SHELL
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const errors = [];
const fail = (msg) => errors.push(msg);

// 1. Every script parses.
const scripts = [
  ...readdirSync('.').filter((f) => f.endsWith('.js')),
  ...readdirSync('tools').filter((f) => /\.m?js$/.test(f)).map((f) => `tools/${f}`),
];
for (const file of scripts) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    fail(`${file} doesn't parse:\n${err.stderr.toString().trim()}`);
  }
}

// Reads SHELL, BIBLES and SHELL_FILES by running sw.js's top level with a stub `self`.
function swConstants(source) {
  const self = { addEventListener() {} };
  return vm.runInNewContext(`${source}\n;({ SHELL, BIBLES, SHELL_FILES })`, { self });
}

const sw = swConstants(readFileSync('sw.js', 'utf8'));
// './' is served as index.html.
const shellPaths = new Set(sw.SHELL_FILES.map((f) => (f === './' ? 'index.html' : f)));

// 2. Every precached file exists (one missing file fails the whole service worker install).
for (const file of shellPaths) {
  if (!existsSync(file)) fail(`sw.js SHELL_FILES lists ${file}, which doesn't exist`);
}

// 3. HTML: no inline scripts or event handlers (the CSP blocks them), and every local
// file a page loads is precached, so the app still opens offline. (admin.html, the
// owner's dashboard, is online only, so it gets the CSP checks but isn't precached,
// and the app's link to it is allowed.)
for (const page of ['index.html', 'copyright.html', 'admin.html']) {
  const html = readFileSync(page, 'utf8');
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    if (!/\bsrc=/i.test(tag)) fail(`${page}: inline <script> (put code in a .js file)`);
  }
  for (const [, attr] of html.matchAll(/<[a-z][^>]*?\s(on[a-z]+)\s*=/gi)) {
    fail(`${page}: inline event handler ${attr}= (use addEventListener in a .js file)`);
  }
  for (const [, url] of html.matchAll(/\b(?:src|href)="([^"#:]+)"/g)) {
    const file = url === './' ? 'index.html' : url;
    if (page !== 'admin.html' && file !== 'admin.html' && !shellPaths.has(file)) fail(`${page} loads ${url}, which isn't in sw.js SHELL_FILES`);
  }
}

// 4. With --base: changing a cached file needs a newer SHELL than the base's, and
// changing bibles/ needs a new BIBLES cache name.
const baseArg = process.argv.indexOf('--base');
if (baseArg > 0) {
  const base = process.argv[baseArg + 1];
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
  const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
  const before = swConstants(git('show', `${base}:sw.js`));
  const version = (name) => Number(name.match(/-v(\d+)$/)?.[1]);
  const cached = changed.filter((f) => shellPaths.has(f));
  if (cached.length && !(version(sw.SHELL) > version(before.SHELL))) {
    fail(`Cached files changed (${cached.join(', ')}) but SHELL is ${sw.SHELL}; it must be newer than ${before.SHELL} on ${base}`);
  }
  if (changed.some((f) => f.startsWith('bibles/')) && sw.BIBLES === before.BIBLES) {
    fail(`bibles/ changed but BIBLES is still ${sw.BIBLES}; rename it so devices download the new files`);
  }
}

if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join('\n'));
  process.exit(1);
}
console.log(`✓ ${scripts.length} scripts parse, ${shellPaths.size} shell files exist, HTML follows the CSP rules${baseArg > 0 ? ', cache names bumped' : ''}`);

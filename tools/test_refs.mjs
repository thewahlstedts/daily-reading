import { createRequire } from 'node:module';
import assert from 'node:assert';
const { logosUrl, splitRefs, labelUrl } = createRequire(import.meta.url)('../logos-refs.js');

const links = (t, b) => splitRefs(t, b).filter((s) => s.url).map((s) => [s.text, s.url]);
const one = (t, text, url, b) => assert.deepStrictEqual(links(t, b), [[text, url]], t);
const none = (t, b) => assert.deepStrictEqual(links(t, b), [], t);

assert.strictEqual(logosUrl('Romans', 5, 12, 21), 'https://ref.ly/Romans5.12-21');
assert.strictEqual(logosUrl('1 Corinthians', 13), 'https://ref.ly/1Corinthians13');

one('see Rom 5:12–21', 'Rom 5:12–21', 'https://ref.ly/Romans5.12-21');
one('1 Cor 13', '1 Cor 13', 'https://ref.ly/1Corinthians13');
one('Gen 3', 'Gen 3', 'https://ref.ly/Genesis3');
one('Genesis 3:1-5', 'Genesis 3:1-5', 'https://ref.ly/Genesis3.1-5');
one('Ps 23', 'Ps 23', 'https://ref.ly/Psalms23');
one('Song of Songs 2:4', 'Song of Songs 2:4', 'https://ref.ly/SongofSongs2.4');
one('I John 4:8', 'I John 4:8', 'https://ref.ly/1John4.8');
one('2 Tim 3:16, and more', '2 Tim 3:16', 'https://ref.ly/2Timothy3.16');
one('Rom 5:12—21.', 'Rom 5:12—21', 'https://ref.ly/Romans5.12-21');
one('Gen 1:1–2:3', 'Gen 1:1–2:3', 'https://ref.ly/Genesis1.1');

const t = 'See Rom 5:12–21 and 3:16; Mark my words, Job 3.';
assert.strictEqual(splitRefs(t, 'John').map((s) => s.text).join(''), t);
assert.strictEqual(splitRefs(t).map((s) => s.text).join(''), t);

one('as in 3:16', '3:16', 'https://ref.ly/John3.16', 'John');
one('as in 3:16–18', '3:16–18', 'https://ref.ly/John3.16-18', 'John');
none('as in 3:16');
none('verse 3:16', undefined);

assert.strictEqual(labelUrl('Psalms', '23:1–6'), 'https://ref.ly/Psalms23.1');
assert.strictEqual(labelUrl('Genesis', '1:1–2:3'), 'https://ref.ly/Genesis1.1');
assert.strictEqual(labelUrl('Genesis', 'Introduction'), null);

['Mark my words', 'the book of Job was', 'Acts of the apostles', 'Amos said', 'Ruth and',
  'in 2026 we', 'chapter 12 and 34'].forEach((x) => none(x, 'John'));
console.log('ok');
one('Gen 12', 'Gen 12', 'https://ref.ly/Genesis12');
none('call 12:345 now'.replace('12:345', 'x12345:1'), 'John');

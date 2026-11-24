// Scripture reference parser and Logos (ref.ly) URL builder. No dependencies.
// Only the reference ever goes into a URL, never any text.
const LOGOS_BOOKS = [
  ['Genesis', 'Gen', 'Ge', 'Gn'], ['Exodus', 'Exod', 'Exo', 'Ex'], ['Leviticus', 'Lev', 'Lv'],
  ['Numbers', 'Num', 'Nu'], ['Deuteronomy', 'Deut', 'Dt'], ['Joshua', 'Josh', 'Jos'],
  ['Judges', 'Judg', 'Jdg'], ['Ruth', 'Ru'], ['1 Samuel', 'Sam', 'Sa', 'Sm'], ['2 Samuel'],
  ['1 Kings', 'Kgs', 'Ki'], ['2 Kings'], ['1 Chronicles', 'Chron', 'Chr', 'Ch'], ['2 Chronicles'],
  ['Ezra', 'Ezr'], ['Nehemiah', 'Neh'], ['Esther', 'Esth', 'Est'], ['Job'],
  ['Psalms', 'Psalm', 'Ps', 'Pss', 'Psa'], ['Proverbs', 'Prov', 'Pro', 'Prv'],
  ['Ecclesiastes', 'Eccles', 'Eccl', 'Ecc'], ['Song of Songs', 'Song of Solomon', 'Song of Sol', 'Song'],
  ['Isaiah', 'Isa'], ['Jeremiah', 'Jer'], ['Lamentations', 'Lam'], ['Ezekiel', 'Ezek', 'Eze'],
  ['Daniel', 'Dan'], ['Hosea', 'Hos'], ['Joel'], ['Amos'], ['Obadiah', 'Obad', 'Ob'],
  ['Jonah', 'Jon'], ['Micah', 'Mic'], ['Nahum', 'Nah'], ['Habakkuk', 'Hab'], ['Zephaniah', 'Zeph', 'Zep'],
  ['Haggai', 'Hag'], ['Zechariah', 'Zech', 'Zec'], ['Malachi', 'Mal'],
  ['Matthew', 'Matt', 'Mt'], ['Mark', 'Mk'], ['Luke', 'Lk'], ['John', 'Jn'], ['Acts', 'Ac'],
  ['Romans', 'Rom', 'Ro'], ['1 Corinthians', 'Cor', 'Co'], ['2 Corinthians'], ['Galatians', 'Gal'],
  ['Ephesians', 'Eph'], ['Philippians', 'Phil', 'Php'], ['Colossians', 'Col'],
  ['1 Thessalonians', 'Thess', 'Thes', 'Th'], ['2 Thessalonians'], ['1 Timothy', 'Tim', 'Ti'], ['2 Timothy'],
  ['Titus', 'Tit'], ['Philemon', 'Phlm', 'Phm'], ['Hebrews', 'Heb'], ['James', 'Jas', 'Jm'],
  ['1 Peter', 'Pet', 'Pe', 'Pt'], ['2 Peter'], ['1 John', 'Jn'], ['2 John'], ['3 John'],
  ['Jude'], ['Revelation', 'Rev', 'Re'],
];

const LOGOS_LOOKUP = (() => {
  const map = {};
  const add = (name, full) => { map[name.toLowerCase().replace(/\s+/g, ' ')] = full; };
  const prefixes = [['1', 'I', 'First'], ['2', 'II', 'Second'], ['3', 'III', 'Third']];
  LOGOS_BOOKS.forEach((names) => {
    const full = names[0];
    const m = /^([123]) (.+)$/.exec(full);
    if (!m) { names.forEach((n) => add(n, full)); return; }
    // Numbered book: the aliases are short stems; generate each numeral form
    const n = Number(m[1]);
    const stems = [m[2], ...names.slice(1)];
    prefixes[n - 1].forEach((p) => stems.forEach((s) => {
      add(p + ' ' + s, full);
      add(p + s, full);
    }));
  });
  // Aliases of the second/third books were declared only on the first; copy over their stems.
  const stemsOf = (first) => LOGOS_BOOKS.find((b) => b[0] === first).slice(1);
  [['2 Samuel', '1 Samuel'], ['2 Kings', '1 Kings'], ['2 Chronicles', '1 Chronicles'],
    ['2 Corinthians', '1 Corinthians'], ['2 Thessalonians', '1 Thessalonians'],
    ['2 Timothy', '1 Timothy'], ['2 Peter', '1 Peter']].forEach(([two, one]) => {
    stemsOf(one).forEach((s) => prefixes[1].forEach((p) => { add(p + ' ' + s, two); add(p + s, two); }));
  });
  ['2 John', '3 John'].forEach((b) => {
    prefixes[Number(b[0]) - 1].forEach((p) => { add(p + ' Jn', b); });
  });
  return map;
})();

const LOGOS_RE = (() => {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[ \\u00a0]+');
  // Longest first so "Song of Songs" beats "Song" and "1 John" beats "John".
  const names = Object.keys(LOGOS_LOOKUP).sort((a, b) => b.length - a.length).map(esc).join('|');
  const sp = '[ \\u00a0]';
  const dash = '[-\\u2013\\u2014]';
  const range = `(?:${sp}*${dash}${sp}*(?:(\\d+):)?(\\d+))?`;
  const book = `(?<![A-Za-z0-9])(${names})\\.?${sp}+(\\d+)(?::(\\d+)${range})?(?!\\d|:\\d)`;
  const bare = `(?<![\\w:.])(\\d+):(\\d+)${range}(?!\\d|:\\d)`;
  return new RegExp(`${book}|${bare}`, 'gi');
})();

function logosUrl(book, chapter, verseStart, verseEnd) {
  let ref = 'https://ref.ly/' + String(book).replace(/\s+/g, '') + chapter;
  if (verseStart) {
    ref += '.' + verseStart;
    if (verseEnd) ref += '-' + verseEnd;
  }
  return ref;
}

function splitRefs(text, defaultBook) {
  const out = [];
  let last = 0;
  const re = new RegExp(LOGOS_RE.source, LOGOS_RE.flags);
  let m;
  while ((m = re.exec(text))) {
    let url = null;
    if (m[1]) {
      // Require the capital letter the spec asks for ("mark 3" is not a reference)
      if (!/^[A-Z0-9]/.test(m[1])) { re.lastIndex = m.index + 1; continue; }
      const book = LOGOS_LOOKUP[m[1].toLowerCase().replace(/[ \u00a0]+/g, ' ')];
      url = logosUrl(book, m[2], m[3], m[4] ? null : m[5]);
    } else if (defaultBook) {
      url = logosUrl(defaultBook, m[6], m[7], m[8] ? null : m[9]);
    }
    if (!url) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], url });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

function labelUrl(book, label) {
  const m = /^\s*(\d+):(\d+)/.exec(String(label));
  return m ? logosUrl(book, m[1], m[2]) : null;
}

if (typeof module !== 'undefined') module.exports = { logosUrl, splitRefs, labelUrl };

// A small PDF text extractor.
//
// It does the part that matters for reading a proposal: find the content
// streams, inflate them, and turn the text-showing operators back into text -
// following each font's ToUnicode table, which is how modern PDFs (Word,
// Chrome, LaTeX) encode their glyphs.
//
// It does not render, and it cannot read a scanned page: those carry pictures
// of words, not words. When too little comes back, say so rather than handing
// the reader nonsense.

const latin1 = (bytes) => {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return out;
};

const bytesOf = (str) => {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
};

// /FlateDecode is zlib-wrapped deflate. The platform decompressor is stricter
// than zlib about trailing bytes, so fall back to the raw form before giving up.
async function inflateWith(bytes, format) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateInBrowser(bytes) {
  try {
    return await inflateWith(bytes, 'deflate');
  } catch {
    return inflateWith(bytes, 'deflate-raw');
  }
}

/* ------------------------------------------------------------ structure */

// Every "N 0 obj ... endobj" in the file, by object number.
function readObjects(raw) {
  const objects = new Map();
  const re = /(\d+)\s+0\s+obj\b/g;
  let m;
  while ((m = re.exec(raw))) {
    const end = raw.indexOf('endobj', m.index);
    if (end < 0) continue;
    objects.set(Number(m[1]), { body: raw.slice(m.index, end) });
  }
  return objects;
}

// The bytes between "stream" and "endstream", inflated when they are deflated.
async function streamOf(obj, inflate) {
  const at = obj.body.indexOf('stream');
  if (at < 0) return null;
  let from = at + 6;
  if (obj.body[from] === '\r') from++;
  if (obj.body[from] === '\n') from++;
  const to = obj.body.indexOf('endstream', from);
  if (to < 0) return null;
  const header = obj.body.slice(0, at);

  // Prefer the declared length: the bytes before "endstream" usually carry an
  // end-of-line the compressor never wrote, and strict decoders reject it.
  const declared = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(header);
  let body = obj.body.slice(from, to);
  if (declared) {
    const n = Number(declared[1]);
    if (n > 0 && n <= body.length) body = body.slice(0, n);
  } else {
    body = body.replace(/[\r\n]+$/, '');
  }
  const data = bytesOf(body);
  if (!/\/Filter\s*(\/FlateDecode|\[\s*\/FlateDecode)/.test(header)) return latin1(data);
  try {
    return latin1(await inflate(data));
  } catch {
    return null;                       // encrypted, damaged, or a filter we do not do
  }
}

/* --------------------------------------------------------------- CMaps */

const fromUtf16 = (hex) => {
  let out = '';
  for (let i = 0; i + 3 < hex.length + 1; i += 4) {
    const code = parseInt(hex.slice(i, i + 4), 16);
    if (!Number.isNaN(code) && code !== 0) out += String.fromCharCode(code);
  }
  return out;
};

// A font's ToUnicode table: glyph code -> the text it stands for.
function parseCMap(text) {
  const map = new Map();
  let width = 2;
  const range = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(text);
  if (range) {
    const first = /<([0-9A-Fa-f]+)>/.exec(range[1]);
    if (first) width = Math.max(1, Math.round(first[1].length / 2));
  }

  for (const block of text.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
    const pair = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g;
    let m;
    while ((m = pair.exec(block))) map.set(parseInt(m[1], 16), fromUtf16(m[2]));
  }

  for (const block of text.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
    const simple = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g;
    let m;
    while ((m = simple.exec(block))) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      const base = parseInt(m[3].slice(-4) || '0', 16);
      const prefix = m[3].length > 4 ? fromUtf16(m[3].slice(0, -4)) : '';
      if (hi < lo || hi - lo > 65535) continue;
      for (let c = lo; c <= hi; c++) map.set(c, prefix + String.fromCharCode(base + (c - lo)));
    }
    const listed = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g;
    while ((m = listed.exec(block))) {
      const lo = parseInt(m[1], 16);
      const items = m[3].match(/<([0-9A-Fa-f]*)>/g) || [];
      items.forEach((item, i) => map.set(lo + i, fromUtf16(item.slice(1, -1))));
    }
  }
  return { map, width };
}

// Resource name (/F4) -> that font's ToUnicode table.
async function readFonts(raw, objects, inflate) {
  const fonts = new Map();
  const toUnicodeOf = new Map();

  for (const [num, obj] of objects) {
    const ref = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(obj.body);
    if (!ref) continue;
    const target = objects.get(Number(ref[1]));
    if (!target) continue;
    const text = await streamOf(target, inflate);
    if (text) toUnicodeOf.set(num, parseCMap(text));
  }

  const dict = /\/Font\s*<<([\s\S]*?)>>/g;
  let d;
  while ((d = dict.exec(raw))) {
    const entry = /\/([A-Za-z0-9_.-]+)\s+(\d+)\s+0\s+R/g;
    let e;
    while ((e = entry.exec(d[1]))) {
      const cmap = toUnicodeOf.get(Number(e[2]));
      if (cmap) fonts.set(e[1], cmap);
    }
  }
  const fallback = toUnicodeOf.values().next().value || null;
  return { fonts, fallback };
}

/* ---------------------------------------------------------------- text */

const ESCAPES = { n: '\n', r: '\r', t: '\t', b: '', f: '' };
const unescapeLiteral = (s) => s
  .replace(/\\([nrtbf])/g, (_, c) => ESCAPES[c])
  .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
  .replace(/\\(.)/g, '$1');

function decodeHex(hex, cmap) {
  const clean = hex.replace(/\s+/g, '');
  if (!cmap) {
    let out = '';
    for (let i = 0; i + 1 < clean.length; i += 2) out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
    return out;
  }
  const step = cmap.width * 2;
  let out = '';
  for (let i = 0; i + step - 1 < clean.length; i += step) {
    const mapped = cmap.map.get(parseInt(clean.slice(i, i + step), 16));
    if (mapped !== undefined) out += mapped;
  }
  return out;
}

function textFromContent(content, fonts, fallback) {
  let out = '';
  let cmap = fallback;
  let y = null;                        // where on the page the current run sits
  let pendingBreak = false;

  // A run only starts a new line when it actually moved down the page; a font
  // change mid-sentence must not break the sentence.
  const moveTo = (nextY) => {
    if (y !== null && Math.abs(nextY - y) > 2.5) pendingBreak = true;
    y = nextY;
  };
  const emit = (piece) => {
    if (!piece) return;
    if (pendingBreak && out) out += '\n';
    pendingBreak = false;
    out += piece;
  };

  const re = new RegExp([
    '\\/([A-Za-z0-9_.-]+)\\s+[-\\d.]+\\s+Tf',                                   // 1 font
    '\\[((?:[^\\][\\\\]|\\\\.)*)\\]\\s*TJ',                              // 2 array show
    '\\(((?:[^()\\\\]|\\\\.)*)\\)\\s*Tj',                                  // 3 literal show
    '<([0-9A-Fa-f\\s]*)>\\s*Tj',                                                     // 4 hex show
    '([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\s+Tm', // 5-10 matrix
    '([-\\d.]+)\\s+([-\\d.]+)\\s+T[dD]',                                         // 11-12 offset
    '\\b(T\\*|ET)\\b',                                                             // 13 newline ops
  ].join('|'), 'g');

  let m;
  while ((m = re.exec(content))) {
    if (m[1] !== undefined) {
      cmap = fonts.get(m[1]) || fallback;
    } else if (m[2] !== undefined) {
      const parts = m[2].match(/\(((?:[^()\\]|\\.)*)\)|<([0-9A-Fa-f\s]*)>|(-?\d+(?:\.\d+)?)/g) || [];
      for (const part of parts) {
        if (part.startsWith('(')) emit(unescapeLiteral(part.slice(1, -1)));
        else if (part.startsWith('<')) emit(decodeHex(part.slice(1, -1), cmap));
        else if (Number(part) < -120) emit(' ');
      }
    } else if (m[3] !== undefined) {
      emit(unescapeLiteral(m[3]));
    } else if (m[4] !== undefined) {
      emit(decodeHex(m[4], cmap));
    } else if (m[10] !== undefined) {
      moveTo(Number(m[10]));
    } else if (m[12] !== undefined) {
      const dy = Number(m[12]);
      if (dy !== 0 && y !== null) moveTo(y + dy);
    } else if (m[13] === 'T*') {
      pendingBreak = true;
    }
  }
  return out;
}

/* -------------------------------------------------------------- public */

// The replacement character, plus the control codes that mean a glyph did not
// survive decoding. Built from escapes so the source stays plain ASCII.
const JUNK = new RegExp('[\\uFFFD\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');

// How much of this reads as language rather than salvage.
export function legibility(text) {
  if (!text) return 0;
  const letters = (text.match(/[\p{L}\p{N}]/gu) || []).length;
  const junk = (text.match(JUNK) || []).length;
  return Math.max(0, (letters - junk * 3) / text.length);
}

/**
 * Pull the text out of a PDF.
 * Returns { text, pages, legible, ok, reason } - when `ok` is false, tell the
 * reader why instead of handing them the text.
 */
export async function extractPdfText(buffer, inflate = inflateInBrowser) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const raw = latin1(bytes);
  if (!raw.startsWith('%PDF')) return { text: '', pages: 0, legible: 0, ok: false, reason: 'not-pdf' };
  if (/\/Encrypt\s/.test(raw)) return { text: '', pages: 0, legible: 0, ok: false, reason: 'encrypted' };

  const objects = readObjects(raw);
  const { fonts, fallback } = await readFonts(raw, objects, inflate);

  const chunks = [];
  for (const [, obj] of objects) {
    if (/\/ToUnicode|\/Type\s*\/Font|\/Subtype\s*\/Image/.test(obj.body)) continue;
    const content = await streamOf(obj, inflate);
    if (!content || !/\bTj\b|\bTJ\b/.test(content)) continue;
    chunks.push(textFromContent(content, fonts, fallback));
  }

  const text = chunks
    .join('\n')
    .replace(JUNK, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const pages = (raw.match(/\/Type\s*\/Page[^s]/g) || []).length || 1;
  const legible = legibility(text);
  const ok = text.length > 40 && legible > 0.45;
  return { text, pages, legible, ok, reason: ok ? '' : text.length > 40 ? 'unreadable' : 'no-text' };
}

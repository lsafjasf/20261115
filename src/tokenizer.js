const HAN_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const LATIN_RE = /[A-Za-z]/;
const DIGIT_RE = /[0-9]/;
const SPACE_RE = /[\s\u3000]/;
const CJK_PUNCT_RE = /[\u3000-\u303F\uFF00-\uFFEF]/;

export const CJK_OPEN = new Set('（【《「『〔〈｛'.split(''));
export const CJK_CLOSE = new Set('）】》」』〕〉、。！？；：…—·｝'.split(''));

export function isHan(ch) {
  return HAN_RE.test(ch);
}

export function isCjkOpen(token) {
  return token.cjk && CJK_OPEN.has(token.text);
}

export function isCjkClose(token) {
  return token.cjk && CJK_CLOSE.has(token.text);
}

function makeToken(type, text, cjk = false) {
  return { type, text, cjk };
}

function readNumber(src, start) {
  let i = start;
  while (i < src.length) {
    const ch = src[i];
    if (DIGIT_RE.test(ch)) {
      i += 1;
    } else if ((ch === '.' || ch === ',') && DIGIT_RE.test(src[i + 1] || '')) {
      i += 1;
    } else {
      break;
    }
  }
  return i;
}

function readLatin(src, start) {
  let i = start;
  while (i < src.length && LATIN_RE.test(src[i])) i += 1;
  return i;
}

export function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (SPACE_RE.test(ch)) {
      let j = i + 1;
      while (j < text.length && SPACE_RE.test(text[j])) j += 1;
      tokens.push(makeToken('space', text.slice(i, j), ch === '\u3000'));
      i = j;
    } else if (isHan(ch)) {
      tokens.push(makeToken('han', ch, true));
      i += 1;
    } else if (LATIN_RE.test(ch)) {
      const j = readLatin(text, i);
      tokens.push(makeToken('latin', text.slice(i, j), false));
      i = j;
    } else if (DIGIT_RE.test(ch)) {
      const j = readNumber(text, i);
      tokens.push(makeToken('number', text.slice(i, j), false));
      i = j;
    } else if (CJK_PUNCT_RE.test(ch)) {
      tokens.push(makeToken('punct', ch, true));
      i += 1;
    } else {
      tokens.push(makeToken('punct', ch, false));
      i += 1;
    }
  }
  return tokens;
}

export function breakAllowed(prev, next, strict) {
  if (!prev || !next) return false;
  if (next.type === 'space') return false;
  if (prev.type === 'space') return true;
  if (strict) {
    if (isCjkClose(next)) return false;
    if (isCjkOpen(prev)) return false;
  }
  return prev.cjk || next.cjk;
}

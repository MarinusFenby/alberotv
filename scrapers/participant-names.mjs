// School affiliations are source metadata, never part of a person's name.
// Keep personal aliases and other parenthetical text unless it is explicitly
// introduced as a school. Do not infer names from institutional fragments.
const SCHOOL = String.raw`(?:Escuela\b|E\.?\s*T\.?(?=\s|$)|Academia\s+Taurina\b|Centro\s+(?:Internacional\s+de\s+Tauromaquia|de\s+(?:Tauromaquia|Formaci[oó]n\s+Taurina))\b|CITAR\b)`;
const SCHOOL_START = new RegExp(String.raw`^(?:(?:de\s+la|de|del|la|perteneciente\s+a\s+la|tambi[eé]n\s+perteneciente\s+a\s+la)\s+)?${SCHOOL}`, 'i');
const SCHOOL_SUFFIX = new RegExp(String.raw`(?:\s*,\s*|\s+[—–-]\s+|\s+)(?:(?:de\s+la|de|del|perteneciente\s+a\s+la)\s+)?${SCHOOL}.*$`, 'i');
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

function removeSchoolGroups(text) {
  let output = '';
  for (let index = 0; index < text.length; index += 1) {
    const close = text[index] === '(' ? ')' : text[index] === '[' ? ']' : null;
    if (!close) {
      output += text[index];
      continue;
    }
    const start = index;
    const stack = [close];
    while (++index < text.length && stack.length) {
      if (text[index] === '(') stack.push(')');
      else if (text[index] === '[') stack.push(']');
      else if (text[index] === stack.at(-1)) stack.pop();
    }
    const end = stack.length ? text.length : index;
    const inner = clean(text.slice(start + 1, stack.length ? end : end - 1));
    const group = text.slice(start, end);
    // With unbalanced punctuation we retain the unknown text, not guess where
    // a school ends and a second participant begins.
    output += !stack.length && SCHOOL_START.test(inner) ? ' ' : group;
    index = end - 1;
  }
  return output;
}

// Hide aliases while locating an unparenthesized school suffix. A school
// word inside a personal alias ("El Niño de la Escuela") is not metadata.
function maskAnnotations(text) {
  let masked = '';
  const stack = [];
  let quote = '';
  for (const char of text) {
    if (quote) {
      masked += '_'.repeat(char.length);
      if (char === quote) quote = '';
      continue;
    }
    if (char === '«' || char === '“' || char === '"') {
      quote = char === '«' ? '»' : char === '“' ? '”' : '"';
      masked += '_'.repeat(char.length);
      continue;
    }
    if (char === '(' || char === '[') stack.push(char === '(' ? ')' : ']');
    if (stack.length) {
      masked += '_'.repeat(char.length);
      if (char === stack.at(-1)) stack.pop();
    } else masked += char;
  }
  return masked;
}

export function cleanParticipantName(value = '') {
  let name = clean(removeSchoolGroups(clean(value)))
    .replace(/^[,;\s]+|[,;.。\s]+$/g, '');
  if (SCHOOL_START.test(name)) return '';
  const suffix = maskAnnotations(name).match(SCHOOL_SUFFIX);
  if (suffix) name = name.slice(0, suffix.index);
  return name.replace(/[,;.。\s]+$/g, '').trim();
}

// Split punctuation and y/e only outside aliases and school parentheses.
// An affiliation after a comma is skipped as a unit, including its internal
// conjunctions. Stored participant arrays use punctuation only so a genuine
// compound surname with "y" is not split a second time by the merge step.
export function splitParticipantList(value = '', { splitConjunctions = true } = {}) {
  const text = clean(value);
  const parts = [];
  let part = '';
  const stack = [];
  let quote = '';
  const finish = () => {
    const name = cleanParticipantName(part.replace(/^(?:y|e)\s+/i, ''));
    if (name) parts.push(name);
    part = '';
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      part += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '«' || char === '“' || char === '"') {
      quote = char === '«' ? '»' : char === '“' ? '”' : '"';
      part += char;
      continue;
    }
    if (char === '(' || char === '[') stack.push(char === '(' ? ')' : ']');
    else if (stack.length && char === stack.at(-1)) stack.pop();
    if (!stack.length) {
      if (char === ',' || char === ';') {
        finish();
        continue;
      }
      const conjunction = splitConjunctions && /\s/.test(char)
        && text.slice(index).match(/^\s+(?:y|e)\s+/i);
      if (conjunction && !SCHOOL_START.test(clean(part))) {
        finish();
        index += conjunction[0].length - 1;
        continue;
      }
    }
    part += char;
  }
  finish();
  return parts;
}

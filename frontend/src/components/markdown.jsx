/*
 * [Sprint 4 · M6] US-38: a small, safe Markdown renderer for documentation pages.
 *
 * Why not innerHTML or a library? The page text is written by users. This renderer only ever
 * builds React elements from the text, and React prints text as text, so any HTML in a page
 * (<script>, <img onerror=...>, <iframe> ...) is shown literally and can never run. It uses no
 * dangerouslySetInnerHTML and needs no extra npm package.
 *
 * Supported (enough for project notes):
 *   # / ## / ###      headings                 **bold**   *italic*   `inline code`
 *   ``` ... ```       code block               [text](https://...)   links
 *   - item / * item   bulleted list            1. item               numbered list
 *   > text            quote                    ---                   horizontal rule
 *   blank line        new paragraph            single line break     kept as a line break
 *   \*  \`  \[ ...    backslash shows the next symbol as plain text
 *
 * Links are made only for http:, https: and mailto: addresses and open in a new tab with
 * rel="noopener noreferrer". Anything else (javascript:, data:, vbscript:, relative paths ...)
 * is shown as plain text, exactly as written.
 */

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const MAX_INLINE_DEPTH = 6; // **bold *italic `code`*** nesting deeper than this is shown as text
const MAX_QUOTE_DEPTH = 4; // > > > > nesting deeper than this is shown as text
const ESCAPABLE = '\\`*_{}[]()#+-.!>|~';

const styles = {
  body: { fontSize: 12, lineHeight: 1.7, color: 'var(--text)', overflowWrap: 'anywhere' },
  h1: { font: '700 18px Manrope, sans-serif', margin: '18px 0 8px' },
  h2: { font: '700 15px Manrope, sans-serif', margin: '16px 0 6px' },
  h3: { font: '700 13px Manrope, sans-serif', margin: '14px 0 6px' },
  p: { margin: '0 0 10px' },
  list: { margin: '0 0 10px', paddingLeft: 22 },
  quote: { margin: '0 0 10px', padding: '2px 0 2px 12px', borderLeft: '3px solid var(--line)', color: 'var(--muted)' },
  pre: { margin: '0 0 10px', padding: 12, borderRadius: 10, background: 'var(--bg)', border: '1px solid var(--line)', overflowX: 'auto', fontSize: 11, lineHeight: 1.55 },
  code: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  inlineCode: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '0.92em', padding: '1px 5px', borderRadius: 5, background: 'var(--soft)' },
  hr: { border: 0, borderTop: '1px solid var(--line)', margin: '14px 0' },
  link: { color: 'var(--accent)', fontWeight: 600 },
};

// Returns the cleaned URL when it is safe to link to, otherwise null.
export function safeHref(raw) {
  const url = String(raw || '').trim();
  if (!url || /[\s\u0000-\u001f\u007f]/.test(url)) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null; // relative paths and garbage are not linked
  }
  return SAFE_PROTOCOLS.has(parsed.protocol) ? url : null;
}

/*
 * Inline Markdown -> array of strings and React elements.
 * `keyBase` keeps React keys unique; `depth` stops runaway nesting.
 */
export function renderInline(text, keyBase = 'i', depth = 0) {
  const source = String(text);
  if (depth > MAX_INLINE_DEPTH) return [source];

  const out = [];
  let buffer = '';
  let n = 0;
  const missing = new Set(); // delimiters already known to have no closing match further on
  const flush = () => { if (buffer) { out.push(buffer); buffer = ''; } };
  const key = () => `${keyBase}.${n++}`;
  const find = (needle, from) => {
    if (missing.has(needle)) return -1;
    const at = source.indexOf(needle, from);
    if (at === -1) missing.add(needle);
    return at;
  };

  let i = 0;
  while (i < source.length) {
    const ch = source[i];

    if (ch === '\\' && i + 1 < source.length && ESCAPABLE.includes(source[i + 1])) {
      buffer += source[i + 1];
      i += 2;
      continue;
    }

    if (ch === '\n') {
      flush();
      out.push(<br key={key()} />);
      i += 1;
      continue;
    }

    if (ch === '`') {
      const end = find('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push(<code key={key()} style={styles.inlineCode}>{source.slice(i + 1, end)}</code>);
        i = end + 1;
        continue;
      }
    }

    if (ch === '[') {
      const close = find(']', i + 1);
      if (close > i && source[close + 1] === '(') {
        const end = source.indexOf(')', close + 2);
        if (end !== -1) {
          const label = source.slice(i + 1, close);
          const href = safeHref(source.slice(close + 2, end));
          if (href && label.trim()) {
            flush();
            out.push(
              <a key={key()} href={href} target="_blank" rel="noopener noreferrer" style={styles.link}>
                {renderInline(label, `${keyBase}.a${n}`, depth + 1)}
              </a>
            );
            i = end + 1;
            continue;
          }
          // Not a safe link: show the whole thing exactly as written.
          buffer += source.slice(i, end + 1);
          i = end + 1;
          continue;
        }
      }
    }

    if (ch === '*' && source[i + 1] === '*') {
      const end = find('**', i + 2);
      if (end > i + 2) {
        flush();
        out.push(<strong key={key()}>{renderInline(source.slice(i + 2, end), `${keyBase}.b${n}`, depth + 1)}</strong>);
        i = end + 2;
        continue;
      }
    }

    if (ch === '*' && source[i + 1] !== '*' && source[i + 1] !== ' ' && source[i + 1] !== undefined) {
      let end = find('*', i + 1);
      // Skip a "**" so *italic **bold** text* is read as italic around bold.
      while (end !== -1 && source[end + 1] === '*') {
        const after = source.indexOf('**', end + 2);
        end = after === -1 ? -1 : source.indexOf('*', after + 2);
      }
      if (end > i + 1 && source[end - 1] !== ' ') {
        flush();
        out.push(<em key={key()}>{renderInline(source.slice(i + 1, end), `${keyBase}.e${n}`, depth + 1)}</em>);
        i = end + 1;
        continue;
      }
    }

    buffer += ch;
    i += 1;
  }

  flush();
  return out;
}

const FENCE = /^\s{0,3}```/;
const HEADING = /^\s{0,3}(#{1,3})\s+(.*?)(?:\s+#+)?\s*$/; // "## C#" keeps the "#", "## Title ##" drops the closing ##
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const NUMBERED = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/;

function startsBlock(line) {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || BULLET.test(line) || NUMBERED.test(line);
}

// Markdown text -> array of block elements.
export function renderBlocks(markdown, keyBase = 'b', depth = 0) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  let n = 0;
  const key = () => `${keyBase}.${n++}`;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i += 1; continue; }

    if (FENCE.test(line)) {
      const code = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) { code.push(lines[i]); i += 1; }
      i += 1; // closing fence (or end of text: an unclosed block runs to the end)
      blocks.push(<pre key={key()} style={styles.pre}><code style={styles.code}>{code.join('\n')}</code></pre>);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      const Tag = `h${level + 2}`; // # -> h3: the panel already uses h2 for its own title
      blocks.push(<Tag key={key()} style={styles[`h${level}`]}>{renderInline(heading[2], key())}</Tag>);
      i += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push(<hr key={key()} style={styles.hr} />);
      i += 1;
      continue;
    }

    if (QUOTE.test(line) && depth < MAX_QUOTE_DEPTH) {
      const inner = [];
      while (i < lines.length && QUOTE.test(lines[i])) { inner.push(QUOTE.exec(lines[i])[1]); i += 1; }
      blocks.push(<blockquote key={key()} style={styles.quote}>{renderBlocks(inner.join('\n'), key(), depth + 1)}</blockquote>);
      continue;
    }

    const listMatch = BULLET.exec(line) || NUMBERED.exec(line);
    if (listMatch) {
      const ordered = !BULLET.test(line);
      const pattern = ordered ? NUMBERED : BULLET;
      const items = [];
      const start = ordered ? Number(NUMBERED.exec(line)[1]) : 1;
      while (i < lines.length && lines[i].trim()) {
        const item = pattern.exec(lines[i]);
        if (item) items.push(ordered ? item[2] : item[1]);
        else if (startsBlock(lines[i])) break;
        else items[items.length - 1] += `\n${lines[i].trim()}`; // continuation of the item above
        i += 1;
      }
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(
        <Tag key={key()} style={styles.list} start={ordered && start !== 1 ? start : undefined}>
          {items.map((item, index) => <li key={index}>{renderInline(item, `${keyBase}.${n}.${index}`)}</li>)}
        </Tag>
      );
      continue;
    }

    const paragraph = [];
    while (i < lines.length && lines[i].trim() && (paragraph.length === 0 || !startsBlock(lines[i]))) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push(<p key={key()} style={styles.p}>{renderInline(paragraph.join('\n'), key())}</p>);
  }

  return blocks;
}

export default function Markdown({ text }) {
  return <div className="markdown-body" style={styles.body}>{renderBlocks(text)}</div>;
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 4 · M6] What this file does
 * Turns a documentation page's Markdown into React elements (headings, lists,
 * quotes, code, bold/italic, links). Text is never inserted as HTML, and only
 * http/https/mailto links are made, so user content cannot run scripts.
 * ---------------------------------------------------------------------------
 */

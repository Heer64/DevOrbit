// [Sprint 4 · M6] US-38: the safe Markdown renderer used for documentation pages.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import Markdown, { safeHref } from './markdown';

const show = (text) => render(<Markdown text={text} />).container.querySelector('.markdown-body');

describe('Markdown features', () => {
  it('headings # ## ### (rendered as h3 h4 h5 inside the panel)', () => {
    const body = show('# One\n## Two\n### Three\n#### Not a heading');
    expect(body.querySelector('h3').textContent).toBe('One');
    expect(body.querySelector('h4').textContent).toBe('Two');
    expect(body.querySelector('h5').textContent).toBe('Three');
    expect(body.querySelector('p').textContent).toBe('#### Not a heading');
  });

  it('paragraphs, line breaks, bold, italic and inline code', () => {
    const body = show('First **bold** and *italic* and `npm test`\nsame paragraph\n\nSecond paragraph');
    const paragraphs = body.querySelectorAll('p');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].querySelector('strong').textContent).toBe('bold');
    expect(paragraphs[0].querySelector('em').textContent).toBe('italic');
    expect(paragraphs[0].querySelector('code').textContent).toBe('npm test');
    expect(paragraphs[0].querySelectorAll('br')).toHaveLength(1);
    expect(paragraphs[1].textContent).toBe('Second paragraph');
  });

  it('nested bold and italic', () => {
    const body = show('**bold *italic* bold** and *italic **bold** italic*');
    expect(body.querySelector('strong em').textContent).toBe('italic');
    expect(body.querySelector('em strong').textContent).toBe('bold');
  });

  it('fenced code blocks keep their text exactly, and an unclosed block runs to the end', () => {
    const body = show('```js\nconst a = 1 < 2 && **x**;\n```\nafter\n\n```\nnever closed\n# still code');
    const blocks = body.querySelectorAll('pre code');
    expect(blocks[0].textContent).toBe('const a = 1 < 2 && **x**;');
    expect(body.querySelector('p').textContent).toBe('after');
    expect(blocks[1].textContent).toBe('never closed\n# still code');
    expect(body.querySelector('strong')).toBeNull();
  });

  it('bulleted and numbered lists', () => {
    const body = show('- one\n* two\n+ three\n\n3. third\n4. fourth');
    expect([...body.querySelectorAll('ul li')].map((li) => li.textContent)).toEqual(['one', 'two', 'three']);
    const ol = body.querySelector('ol');
    expect([...ol.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['third', 'fourth']);
    expect(ol.getAttribute('start')).toBe('3');
  });

  it('quotes and horizontal rules', () => {
    const body = show('> quoted **text**\n> more\n\n---\n\nafter');
    expect(body.querySelector('blockquote strong').textContent).toBe('text');
    expect(body.querySelector('hr')).toBeTruthy();
  });

  it('safe links open in a new tab with noopener', () => {
    const body = show('See [the guide](https://example.com/docs) or [mail us](mailto:team@example.com).');
    const links = body.querySelectorAll('a');
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe('https://example.com/docs');
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
    expect(links[1].getAttribute('href')).toBe('mailto:team@example.com');
  });

  it('backslash shows a symbol as plain text', () => {
    const body = show('\\*not italic\\* and \\`not code\\`');
    expect(body.querySelector('em')).toBeNull();
    expect(body.querySelector('code')).toBeNull();
    expect(body.textContent).toBe('*not italic* and `not code`');
  });
});

describe('Markdown safety (XSS)', () => {
  it('<script> is shown as text and no script element is created', () => {
    const body = show('<script>alert(1)</script>');
    expect(body.querySelector('script')).toBeNull();
    expect(body.textContent).toBe('<script>alert(1)</script>');
  });

  it('<img onerror> and other tags are shown as text, not elements', () => {
    const body = show('<img src=x onerror=alert(1)>\n<iframe src="https://evil.example"></iframe>\n<b onclick="x()">hi</b>');
    expect(body.querySelector('img, iframe, b')).toBeNull();
    expect(body.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(body.innerHTML).not.toMatch(/<img|<iframe|<b[ >]/); // tags appear only escaped (&lt;img ...)
    expect(body.querySelector('[onerror], [onclick], [src]')).toBeNull();
  });

  it('javascript:, data:, vbscript: and relative links are not made into links', () => {
    for (const text of [
      '[x](javascript:alert(1))',
      '[x](JaVaScRiPt:alert(1))',
      '[x]( javascript:alert(1))',
      '[x](data:text/html,<script>alert(1)</script>)',
      '[x](vbscript:msgbox(1))',
      '[x](/project/123)',
      '[x](java\tscript:alert(1))',
    ]) {
      const body = show(text);
      expect(body.querySelector('a'), text).toBeNull();
    }
    expect(show('[x](javascript:alert(1))').textContent).toBe('[x](javascript:alert(1))');
  });

  it('safeHref only allows http, https and mailto', () => {
    expect(safeHref('https://a.dev')).toBe('https://a.dev');
    expect(safeHref(' http://a.dev ')).toBe('http://a.dev');
    expect(safeHref('mailto:a@b.dev')).toBe('mailto:a@b.dev');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('JAVASCRIPT:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,x')).toBeNull();
    expect(safeHref('//evil.example')).toBeNull();
    expect(safeHref('https://a.dev/x y')).toBeNull();
  });

  it('a 10,000-character line and deep nesting render without crashing', () => {
    expect(show('a'.repeat(10000)).textContent).toHaveLength(10000);
    expect(() => show('['.repeat(5000) + '*'.repeat(5000))).not.toThrow();
    expect(() => show('>'.repeat(200) + ' deep')).not.toThrow();
    expect(() => show('**'.repeat(3000))).not.toThrow();
  });
});

// [Sprint 4 · M6] US-38: the Docs tab — list, read, create, save, 10,000-character limit, Viewer.
import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import DocsPanel, { docLength, formatCount, validateDocForm } from './DocsPanel';

const P = 'p'.repeat(24);
const page = (id, extra = {}) => ({
  _id: id,
  title: 'Local setup',
  preview: 'Setup Run npm install',
  content: '# Setup\n\nRun **npm install**.',
  length: 30,
  createdBy: { _id: 'u1', name: 'Riya Kapoor' },
  updatedBy: null,
  createdAt: '2026-11-01T12:00:00.000Z',
  updatedAt: '2026-11-01T12:00:00.000Z',
  ...extra,
});

function fakeApi(initial = [page('d1')]) {
  let rows = [...initial];
  return {
    list: vi.fn(() => Promise.resolve({ docs: rows.map(({ content, ...rest }) => rest) })),
    get: vi.fn((projectId, id) => {
      const found = rows.find((d) => d._id === id);
      return found ? Promise.resolve({ doc: found }) : Promise.reject(Object.assign(new Error('Documentation page not found.'), { status: 404 }));
    }),
    create: vi.fn((projectId, payload) => {
      const doc = page(`new${rows.length}`, { ...payload, preview: payload.content.slice(0, 40), createdBy: { _id: 'u2', name: 'Rohan Mehta' } });
      rows = [doc, ...rows];
      return Promise.resolve({ doc });
    }),
    update: vi.fn((projectId, id, payload) => {
      rows = rows.map((d) => (d._id === id ? { ...d, ...payload, updatedBy: { _id: 'u2', name: 'Rohan Mehta' }, updatedAt: '2026-11-02T12:00:00.000Z' } : d));
      return Promise.resolve({ doc: rows.find((d) => d._id === id) });
    }),
  };
}

async function renderPanel({ role = 'Contributor', docId = '', api = fakeApi(), onOpenDoc = vi.fn() } = {}) {
  await act(async () => {
    render(<DocsPanel projectId={P} myRole={role} docId={docId} onOpenDoc={onOpenDoc} api={api} />);
  });
  return { api, onOpenDoc };
}

const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = async () => { await act(async () => { fireEvent.submit(screen.getByRole('form')); }); };

describe('doc helpers', () => {
  it('counts like the API and validates the same rules', () => {
    expect(docLength('a\r\nb')).toBe(3);
    expect(formatCount(1234)).toBe('1,234 / 10,000');
    expect(validateDocForm({ title: '', content: 'x' })).toBe('Title is required.');
    expect(validateDocForm({ title: 'T', content: '  \n' })).toBe('Write some content before saving.');
    expect(validateDocForm({ title: 'T', content: 'a'.repeat(10001) })).toBe('Content must be 10,000 characters or fewer.');
    expect(validateDocForm({ title: 'T', content: 'a'.repeat(10000) })).toBe('');
  });
});

describe('DocsPanel', () => {
  it('lists the project pages with title, preview and author', async () => {
    await renderPanel({ api: fakeApi([page('d1'), page('d2', { title: 'Coding rules', preview: 'Use Prettier', updatedBy: { name: 'Rohan Mehta' }, updatedAt: '2026-11-02T12:00:00.000Z' })]) });
    const rows = screen.getAllByTestId('doc-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Local setup');
    expect(rows[0].textContent).toContain('Created by Riya Kapoor');
    expect(rows[1].textContent).toContain('Use Prettier');
    expect(rows[1].textContent).toContain('Edited by Rohan Mehta');
  });

  it('opening a page shows it as formatted text and puts it in the URL', async () => {
    const { onOpenDoc } = await renderPanel();
    await act(async () => { fireEvent.click(screen.getByTestId('doc-row')); });
    expect(onOpenDoc).toHaveBeenCalledWith('d1');
    const article = await screen.findByRole('article', { name: 'Local setup' });
    expect(article.querySelector('h3 + small')).toBeTruthy();
    expect(article.querySelector('.markdown-body h3').textContent).toBe('Setup');
    expect(article.querySelector('.markdown-body strong').textContent).toBe('npm install');
  });

  it('?doc= opens that page directly; an unknown page says so', async () => {
    await renderPanel({ docId: 'd1', role: 'Viewer' });
    expect(await screen.findByRole('article', { name: 'Local setup' })).toBeTruthy();

    cleanup();
    await renderPanel({ docId: 'missing' });
    expect((await screen.findByRole('alert')).textContent).toBe('This page could not be found.');
  });

  it('a Viewer can read but has no New page or Edit buttons', async () => {
    await renderPanel({ role: 'Viewer' });
    expect(screen.queryByRole('button', { name: /new page/i })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByTestId('doc-row')); });
    await screen.findByRole('article', { name: 'Local setup' });
    expect(screen.queryByRole('button', { name: /^edit$/i })).toBeNull();
  });

  it('a Contributor creates a page; it opens formatted and is listed', async () => {
    const { api, onOpenDoc } = await renderPanel({ api: fakeApi([]) });
    expect(screen.getByText(/No documentation yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /new page/i }));
    type('Title', 'Release steps');
    type('Content (Markdown)', '## Steps\n\n1. Merge\n2. Deploy');
    expect(screen.getByTestId('doc-counter').textContent).toBe('28 / 10,000');
    fireEvent.click(screen.getByRole('tab', { name: /preview/i }));
    expect(screen.getByTestId('doc-preview').querySelector('h4').textContent).toBe('Steps');
    await submit();
    expect(api.create).toHaveBeenCalledWith(P, { title: 'Release steps', content: '## Steps\n\n1. Merge\n2. Deploy' });
    expect(onOpenDoc).toHaveBeenCalledWith('new0');
    const article = await screen.findByRole('article', { name: 'Release steps' });
    expect(article.querySelectorAll('ol li')).toHaveLength(2);
    expect(screen.getByText('Page created.')).toBeTruthy();
  });

  it('over 10,000 characters: the counter turns red and saving is blocked', async () => {
    const { api } = await renderPanel({ api: fakeApi([]) });
    fireEvent.click(screen.getByRole('button', { name: /new page/i }));
    type('Title', 'Huge');
    type('Content (Markdown)', 'a'.repeat(10001));
    const counter = screen.getByTestId('doc-counter');
    expect(counter.textContent).toBe('10,001 / 10,000 — too long');
    expect(counter.style.fontWeight).toBe('700');
    await submit();
    expect(screen.getByRole('alert').textContent).toBe('Content must be 10,000 characters or fewer.');
    expect(screen.getByRole('form')).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('empty title or content shows an error, keeps the form open and sends nothing', async () => {
    const { api } = await renderPanel({ api: fakeApi([]) });
    fireEvent.click(screen.getByRole('button', { name: /new page/i }));
    await submit();
    expect(screen.getByRole('alert').textContent).toBe('Title is required.');
    type('Title', 'T');
    await submit();
    expect(screen.getByRole('alert').textContent).toBe('Write some content before saving.');
    expect(api.create).not.toHaveBeenCalled();
  });

  it('a server error is shown inside the form', async () => {
    const api = fakeApi([]);
    api.create.mockRejectedValueOnce(Object.assign(new Error('Viewers can read documentation but cannot write it.'), { status: 403 }));
    await renderPanel({ api });
    fireEvent.click(screen.getByRole('button', { name: /new page/i }));
    type('Title', 'T'); type('Content (Markdown)', 'x');
    await submit();
    expect(screen.getByRole('alert').textContent).toBe('Viewers can read documentation but cannot write it.');
    expect(screen.getByRole('form')).toBeTruthy();
  });

  it('a Contributor edits and saves a page; the new content is shown', async () => {
    const { api } = await renderPanel({ docId: 'd1' });
    await screen.findByRole('article', { name: 'Local setup' });
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    expect(screen.getByLabelText('Title').value).toBe('Local setup');
    expect(screen.getByLabelText('Content (Markdown)').value).toBe('# Setup\n\nRun **npm install**.');
    type('Content (Markdown)', '# Setup\n\nRun *pnpm install*.');
    await submit();
    expect(api.update).toHaveBeenCalledWith(P, 'd1', { title: 'Local setup', content: '# Setup\n\nRun *pnpm install*.' });
    const article = await screen.findByRole('article', { name: 'Local setup' });
    expect(article.querySelector('.markdown-body em').textContent).toBe('pnpm install');
    expect(article.textContent).toContain('Edited by Rohan Mehta');
    expect(screen.getByText('Page saved.')).toBeTruthy();
  });

  it('HTML in a page is shown as text, never as elements', async () => {
    await renderPanel({ docId: 'x', api: fakeApi([page('x', { content: '<img src=x onerror=alert(1)><script>alert(2)</script>' })]) });
    const article = await screen.findByRole('article', { name: 'Local setup' });
    expect(article.querySelector('img, script')).toBeNull();
    expect(article.textContent).toContain('<script>alert(2)</script>');
  });
});

// [Sprint 6 · M4] US-42: a Copilot source links to one decision (?tab=decisions&decision=<id>);
// the Decisions tab scrolls to it and highlights it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DecisionsPanel from './DecisionsPanel';

const P = 'p'.repeat(24);
const decision = (id, title) => ({
  _id: id,
  title,
  description: 'Why we chose it.',
  date: '2026-11-03T00:00:00.000Z',
  participants: [{ _id: 'u1', name: 'Riya Kapoor' }],
  createdBy: { _id: 'u1', name: 'Riya Kapoor' },
  updatedBy: null,
  createdAt: '2026-11-03T10:00:00.000Z',
  updatedAt: '2026-11-03T10:00:00.000Z',
  link: null,
});
const api = {
  list: vi.fn(() => Promise.resolve({ decisions: [decision('d1', 'Use MongoDB Atlas'), decision('d2', 'Deploy on Render')] })),
};
const chat = { list: vi.fn(), messages: vi.fn() };

const original = Element.prototype.scrollIntoView;
afterEach(() => {
  Element.prototype.scrollIntoView = original;
});

async function renderPanel(highlightId) {
  const scrolled = [];
  Element.prototype.scrollIntoView = function scrollIntoView() {
    scrolled.push(this.getAttribute('data-decision-id'));
  };
  render(
    <MemoryRouter>
      <DecisionsPanel projectId={P} myRole="Viewer" api={api} chat={chat} highlightId={highlightId} />
    </MemoryRouter>
  );
  await screen.findByText('Deploy on Render');
  return scrolled;
}

describe('DecisionsPanel highlightId', () => {
  it('scrolls to and highlights the linked decision only', async () => {
    const scrolled = await renderPanel('d2');
    const rows = screen.getAllByTestId('decision');
    expect(rows.map((row) => row.className.includes('decision-highlight'))).toEqual([false, true]);
    expect(scrolled).toEqual(['d2']);
  });

  it('no link, or an unknown id: nothing is highlighted', async () => {
    for (const id of ['', 'nope"]x']) {
      const scrolled = await renderPanel(id);
      expect(screen.getAllByTestId('decision').some((row) => row.className.includes('decision-highlight'))).toBe(false);
      expect(scrolled).toEqual([]);
      cleanup();
    }
  });
});

// [Sprint 6 · M4] US-42 (answers grounded in project data, with sources shown) and US-43 (say so when the
// project data cannot answer) in the Ask the Copilot panel.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ copilotApi: { ask: vi.fn() } }));
vi.mock('../api', () => ({ copilotApi: mocks.copilotApi }));

import CopilotPanel from './CopilotPanel';

const P = 'a'.repeat(24);
const T = 'b'.repeat(24);
const D = 'd'.repeat(24);
const NOT_ENOUGH =
  "I don't have enough project data to answer that. Nothing in this project's messages, tasks, decisions or GitHub activity that you can see covers it, so I won't guess.";

const sources = [
  {
    ref: 'T2',
    type: 'task',
    label: 'Payment gateway',
    detail: 'Blocked',
    link: `/project/${P}?tab=tasks&task=${T}`,
    external: false,
    at: '2026-11-06T10:00:00.000Z',
  },
  {
    ref: 'D1',
    type: 'decision',
    label: 'Use MongoDB Atlas',
    detail: 'decided 2026-11-03',
    link: `/project/${P}?tab=decisions&decision=${D}`,
    external: false,
    at: '2026-11-03T10:00:00.000Z',
  },
  {
    ref: 'G1',
    type: 'github',
    label: 'Add login redirect',
    detail: 'Pull request #41 · heer64',
    link: 'https://github.com/Heer64/DevOrbit/pull/41',
    external: true,
    at: '2026-11-10T10:00:00.000Z',
  },
];

const result = (extra = {}) => ({
  question: 'Why is payment blocked?',
  answer: 'Payment is blocked on Stripe keys [T2]. We chose Atlas [D1] and merged the redirect [G1].',
  shortened: false,
  insufficient: false,
  sources,
  context: { budgetTokens: 8000, estimatedTokens: 900, included: { total: 3 }, available: { total: 3 }, leftOut: 0, trimmed: false },
  askedAt: '2026-11-12T10:00:00.000Z',
  answeredAt: '2026-11-12T10:00:01.000Z',
  durationMs: 900,
  ...extra,
});

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname + location.search}</div>;
}

async function ask(response, { router = true } = {}) {
  mocks.copilotApi.ask.mockResolvedValueOnce(response);
  const panel = <CopilotPanel projectId={P} />;
  render(
    router ? (
      <MemoryRouter initialEntries={[`/project/${P}`]}>
        <Routes>
          <Route
            path="/project/:id"
            element={
              <>
                {panel}
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    ) : (
      panel
    )
  );
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: response.question } });
  fireEvent.click(screen.getByRole('button', { name: /ask/i }));
  await act(async () => {});
  return screen.getByRole('article');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('US-42: answers show the records they are built from', () => {
  it('each [T2] citation becomes a numbered link to that record', async () => {
    const item = await ask(result());
    // Like footnotes: the number follows the word it supports.
    expect(item.querySelector('.copilot-reply p').textContent).toBe(
      'Payment is blocked on Stripe keys1. We chose Atlas2 and merged the redirect3.'
    );
    const taskLinks = within(item).getAllByRole('link', { name: 'Source 1: Task Payment gateway' });
    expect(taskLinks).toHaveLength(2); // the number in the answer and the entry in the Sources list
    for (const link of taskLinks) expect(link.getAttribute('href')).toBe(`/project/${P}?tab=tasks&task=${T}`);
  });

  it('lists the sources in order with their kind, detail and date', async () => {
    const item = await ask(result());
    const list = within(item).getByRole('list', { name: 'Sources' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Payment gateway');
    // Tasks and decisions carry their own dates in the detail; events show when they happened.
    expect(rows.map((row) => row.querySelector('small').textContent)).toEqual([
      'Task · Blocked',
      'Decision · decided 2026-11-03',
      'GitHub · Pull request #41 · heer64 · Nov 10, 2026',
    ]);
  });

  it('GitHub sources open github.com in a new tab', async () => {
    const item = await ask(result());
    const links = within(item).getAllByRole('link', { name: 'Source 3: GitHub Add login redirect' });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute('href')).toBe('https://github.com/Heer64/DevOrbit/pull/41');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('an in-app source opens the record on the project page and the answer stays', async () => {
    const item = await ask(result());
    const list = within(item).getByRole('list', { name: 'Sources' });
    fireEvent.click(within(list).getByRole('link', { name: 'Source 2: Decision Use MongoDB Atlas' }));
    expect(screen.getByTestId('where').textContent).toBe(`/project/${P}?tab=decisions&decision=${D}`);
    expect(screen.getByRole('article')).toBeTruthy();
  });

  it('says how many project records the answer is based on', async () => {
    await ask(result());
    expect(screen.getByText('Based on all 3 project records you can see.')).toBeTruthy();
  });

  it('AC2: says when records were left out to stay within the 8,000-token limit', async () => {
    await ask(result({ context: { budgetTokens: 8000, included: { total: 40 }, available: { total: 900 }, leftOut: 860, trimmed: true } }));
    expect(
      screen.getByText(
        'Based on 40 of 900 project records you can see. The rest were left out to stay within the 8,000-token AI input limit (least related and oldest first).'
      )
    ).toBeTruthy();
  });

  it('a link that is not one DevOrbit makes is shown as plain text', async () => {
    const item = await ask(result({ answer: 'Odd [T2].', sources: [{ ...sources[0], link: 'javascript:alert(1)' }], context: null }));
    expect(within(item).queryAllByRole('link')).toHaveLength(0);
    expect(within(item).getByText('Payment gateway')).toBeTruthy();
    expect(item.querySelector('.copilot-context')).toBeNull();
  });

  it('works outside a router too (plain links)', async () => {
    const item = await ask(result(), { router: false });
    expect(within(item).getAllByRole('link', { name: 'Source 1: Task Payment gateway' })[0].getAttribute('href')).toBe(
      `/project/${P}?tab=tasks&task=${T}`
    );
  });
});

describe('US-43: not enough project data', () => {
  it('shows a clear "Not enough project data" box, no sources and no error', async () => {
    const item = await ask(
      result({
        question: "What is the CEO's salary?",
        answer: NOT_ENOUGH,
        insufficient: true,
        sources: [],
        context: { budgetTokens: 8000, included: { total: 5 }, available: { total: 5 }, leftOut: 0, trimmed: false },
      })
    );
    expect(within(item).getByText('Not enough project data')).toBeTruthy();
    expect(within(item).getByText(NOT_ENOUGH)).toBeTruthy();
    expect(within(item).queryByRole('list', { name: 'Sources' })).toBeNull();
    expect(within(item).queryAllByRole('link')).toHaveLength(0);
    expect(item.querySelector('.copilot-reply')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Checked all 5 project records you can see.')).toBeTruthy();
  });

  it('an empty project says it has no records yet', async () => {
    await ask(
      result({
        answer: NOT_ENOUGH,
        insufficient: true,
        sources: [],
        context: { budgetTokens: 8000, included: { total: 0 }, available: { total: 0 }, leftOut: 0, trimmed: false },
      })
    );
    expect(screen.getByText('This project has no tasks, messages, decisions or GitHub activity yet.')).toBeTruthy();
  });
});

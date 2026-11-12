// [Sprint 6 · M3] US-41 Ask the Copilot: question box (500 characters), loading indicator after 2 seconds,
// "AI temporarily unavailable" when the AI provider is down.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ copilotApi: { ask: vi.fn() } }));
vi.mock('../api', () => ({ copilotApi: mocks.copilotApi }));

import CopilotPanel, {
  AI_UNAVAILABLE_TEXT,
  LOADING_DELAY_MS,
  MAX_SHOWN_ANSWERS,
  QUESTION_MAX_CHARS,
  describeCopilotError,
} from './CopilotPanel';

const P = 'a'.repeat(24);
const OTHER = 'b'.repeat(24);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function apiError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.response = { status, data: { message, code } };
  return error;
}

const answer = (question, text = 'Here is the answer.', extra = {}) => ({
  question,
  answer: text,
  shortened: false,
  askedAt: '2026-11-11T10:00:00.000Z',
  answeredAt: '2026-11-11T10:00:03.000Z',
  durationMs: 3000,
  ...extra,
});

const box = () => screen.getByLabelText('Your question');
const askButton = () => screen.getByRole('button', { name: /ask/i });
const type = (value) => fireEvent.change(box(), { target: { value } });
const settle = () => act(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.copilotApi.ask.mockImplementation(async (_id, question) => answer(question));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('describeCopilotError', () => {
  it('503 or AI_UNAVAILABLE -> the AI-unavailable message', () => {
    expect(describeCopilotError(apiError(503, 'x', 'AI_UNAVAILABLE'))).toEqual({ unavailable: true, text: AI_UNAVAILABLE_TEXT });
    expect(describeCopilotError({ response: { data: { code: 'AI_UNAVAILABLE' } }, status: 500 }).unavailable).toBe(true);
  });

  it('no HTTP status (network down) -> could not reach DevOrbit', () => {
    expect(describeCopilotError(new TypeError('Failed to fetch')).text).toMatch(/Could not reach DevOrbit/);
  });

  it('other errors show the server message', () => {
    expect(describeCopilotError(apiError(400, 'Questions can be up to 500 characters (yours has 501).'))).toEqual({
      unavailable: false,
      text: 'Questions can be up to 500 characters (yours has 501).',
    });
  });
});

describe('question box', () => {
  it('starts empty: counter 0 / 500, Ask disabled, hint about the limits', () => {
    render(<CopilotPanel projectId={P} />);
    expect(screen.getByRole('heading', { name: /ask the copilot/i })).toBeTruthy();
    expect(box().getAttribute('maxLength')).toBe(String(QUESTION_MAX_CHARS));
    expect(screen.getByText('0 / 500')).toBeTruthy();
    expect(askButton().disabled).toBe(true);
    expect(screen.getByText(/up to 500 characters/i)).toBeTruthy();
  });

  it('typing updates the counter and enables Ask; spaces alone do not', () => {
    render(<CopilotPanel projectId={P} />);
    type('   ');
    expect(askButton().disabled).toBe(true);
    type('What is due this week?');
    expect(screen.getByText('22 / 500')).toBeTruthy();
    expect(askButton().disabled).toBe(false);
  });

  it('500 characters can be asked; the counter warns near the limit', () => {
    render(<CopilotPanel projectId={P} />);
    type('q'.repeat(500));
    expect(screen.getByText('500 / 500').className).toContain('near');
    expect(askButton().disabled).toBe(false);
  });
});

describe('AC1: submit a question, receive an answer', () => {
  it('sends the trimmed question for this project and shows the answer', async () => {
    render(<CopilotPanel projectId={P} />);
    type('  What is a Kanban board?  ');
    fireEvent.click(askButton());
    await settle();

    expect(mocks.copilotApi.ask).toHaveBeenCalledWith(P, 'What is a Kanban board?');
    const item = screen.getByRole('article');
    expect(within(item).getByText('What is a Kanban board?')).toBeTruthy();
    expect(within(item).getByText('Here is the answer.')).toBeTruthy();
    expect(box().value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Enter sends, Shift+Enter does not', async () => {
    render(<CopilotPanel projectId={P} />);
    type('First line');
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true });
    expect(mocks.copilotApi.ask).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: 'Enter' });
    await settle();
    expect(mocks.copilotApi.ask).toHaveBeenCalledTimes(1);
  });

  it('one question at a time: clicking again while waiting sends nothing', async () => {
    const pending = deferred();
    mocks.copilotApi.ask.mockReturnValueOnce(pending.promise);
    render(<CopilotPanel projectId={P} />);
    type('Status?');
    fireEvent.click(askButton());
    expect(askButton().disabled).toBe(true);
    expect(askButton().textContent).toMatch(/Asking/);
    fireEvent.click(askButton());
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(mocks.copilotApi.ask).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(answer('Status?')));
  });

  it(`keeps the last ${MAX_SHOWN_ANSWERS} answers, newest first`, async () => {
    render(<CopilotPanel projectId={P} />);
    for (let i = 1; i <= MAX_SHOWN_ANSWERS + 1; i += 1) {
      type(`Question ${i}`);
      fireEvent.click(askButton());
      await settle();
    }
    const items = screen.getAllByRole('article');
    expect(items).toHaveLength(MAX_SHOWN_ANSWERS);
    expect(within(items[0]).getByText(`Question ${MAX_SHOWN_ANSWERS + 1}`)).toBeTruthy();
    expect(screen.queryByText('Question 1')).toBeNull();
  });

  it('says when an answer was shortened', async () => {
    mocks.copilotApi.ask.mockResolvedValueOnce(answer('Long?', 'Partial', { shortened: true }));
    render(<CopilotPanel projectId={P} />);
    type('Long?');
    fireEvent.click(askButton());
    await settle();
    expect(screen.getByText('This answer was shortened.')).toBeTruthy();
  });

  it('shows the answer as plain text, never as HTML', async () => {
    mocks.copilotApi.ask.mockResolvedValueOnce(answer('x', '<img src=x onerror="alert(1)"> **bold**'));
    const { container } = render(<CopilotPanel projectId={P} />);
    type('x');
    fireEvent.click(askButton());
    await settle();
    expect(container.querySelector('.copilot-answers img')).toBeNull();
    expect(screen.getByText('<img src=x onerror="alert(1)"> **bold**')).toBeTruthy();
  });
});

describe('AC2: loading indicator after 2 seconds', () => {
  it('not shown before 2 s, shown from 2 s until the answer arrives', async () => {
    vi.useFakeTimers();
    const pending = deferred();
    mocks.copilotApi.ask.mockReturnValueOnce(pending.promise);
    render(<CopilotPanel projectId={P} />);
    type('Who is working on the login page?');
    fireEvent.click(askButton());

    await act(async () => vi.advanceTimersByTime(LOADING_DELAY_MS - 1));
    expect(screen.queryByRole('status')).toBeNull();

    await act(async () => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status').textContent).toMatch(/thinking/i);

    await act(async () => vi.advanceTimersByTime(5000)); // still waiting at 7 s: still shown
    expect(screen.getByRole('status')).toBeTruthy();

    await act(async () => pending.resolve(answer('Who is working on the login page?', 'Riya.')));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('Riya.')).toBeTruthy();
  });

  it('an answer within 2 s never shows the indicator', async () => {
    vi.useFakeTimers();
    const pending = deferred();
    mocks.copilotApi.ask.mockReturnValueOnce(pending.promise);
    render(<CopilotPanel projectId={P} />);
    type('Quick one?');
    fireEvent.click(askButton());
    await act(async () => vi.advanceTimersByTime(1500));
    await act(async () => pending.resolve(answer('Quick one?', 'Yes.')));
    await act(async () => vi.advanceTimersByTime(5000));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('Yes.')).toBeTruthy();
  });

  it('the indicator stays until an error arrives, then the error replaces it', async () => {
    vi.useFakeTimers();
    const pending = deferred();
    mocks.copilotApi.ask.mockReturnValueOnce(pending.promise);
    render(<CopilotPanel projectId={P} />);
    type('Anything new?');
    fireEvent.click(askButton());
    await act(async () => vi.advanceTimersByTime(LOADING_DELAY_MS));
    expect(screen.getByRole('status')).toBeTruthy();
    await act(async () => pending.reject(apiError(503, 'AI temporarily unavailable.', 'AI_UNAVAILABLE')));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('AI temporarily unavailable');
  });
});

describe('AI unavailable and other errors', () => {
  it('503: shows "AI temporarily unavailable" and keeps the question for a retry', async () => {
    mocks.copilotApi.ask.mockRejectedValueOnce(apiError(503, 'AI temporarily unavailable.', 'AI_UNAVAILABLE'));
    render(<CopilotPanel projectId={P} />);
    type('Are we on track?');
    fireEvent.click(askButton());
    await settle();
    expect(screen.getByRole('alert').textContent).toBe(AI_UNAVAILABLE_TEXT);
    expect(box().value).toBe('Are we on track?');
    expect(askButton().disabled).toBe(false);

    // Retry works once the AI is back, and the warning goes away.
    fireEvent.click(askButton());
    await settle();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Here is the answer.')).toBeTruthy();
  });

  it('a refused question shows the server message', async () => {
    mocks.copilotApi.ask.mockRejectedValueOnce(apiError(400, 'Type a question for the Copilot.', 'QUESTION_REQUIRED'));
    render(<CopilotPanel projectId={P} />);
    type('?');
    fireEvent.click(askButton());
    await settle();
    expect(screen.getByRole('alert').textContent).toBe('Type a question for the Copilot.');
  });

  it('network down: could not reach DevOrbit', async () => {
    mocks.copilotApi.ask.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<CopilotPanel projectId={P} />);
    type('Hello?');
    fireEvent.click(askButton());
    await settle();
    expect(screen.getByRole('alert').textContent).toMatch(/Could not reach DevOrbit/);
  });
});

describe('switching projects', () => {
  it('clears the answers and ignores an answer that arrives for the old project', async () => {
    const late = deferred();
    const { rerender } = render(<CopilotPanel projectId={P} />);
    type('First project question');
    fireEvent.click(askButton());
    await settle();
    expect(screen.getAllByRole('article')).toHaveLength(1);

    mocks.copilotApi.ask.mockReturnValueOnce(late.promise);
    type('Slow question');
    fireEvent.click(askButton());
    rerender(<CopilotPanel projectId={OTHER} />);
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(askButton().textContent).not.toMatch(/Asking/);

    await act(async () => late.resolve(answer('Slow question', 'Old project answer')));
    expect(screen.queryByText('Old project answer')).toBeNull();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });
});

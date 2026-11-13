// [Sprint 6 · M6] US-55 Report a public post: the "Report this post" dialog.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ReportPostDialog from './ReportPostDialog';
import {
  REPORT_ALREADY_MESSAGE,
  REPORT_CREATED_MESSAGE,
  REPORT_DETAILS_REQUIRED_MESSAGE,
  REPORT_FAILED_MESSAGE,
  REPORT_REASON_MESSAGE,
} from '../reports';

const failure = (status, message = '') => Object.assign(new Error(message), { status });

function fakeApi(extra = {}) {
  return {
    reportStatus: vi.fn(() => Promise.resolve({ reported: false, report: null })),
    report: vi.fn((postId, { reason, details }) =>
      Promise.resolve({
        report: { _id: 'r1', post: postId, reason, details, status: 'open' },
        message: REPORT_CREATED_MESSAGE,
      })
    ),
    ...extra,
  };
}

function renderDialog({ api = fakeApi(), knownReported = false } = {}) {
  const onClose = vi.fn();
  const onReported = vi.fn();
  const onAlreadyReported = vi.fn();
  const view = render(
    <ReportPostDialog
      open
      postId="p1"
      authorName="Asha Author"
      api={api}
      knownReported={knownReported}
      onClose={onClose}
      onReported={onReported}
      onAlreadyReported={onAlreadyReported}
    />
  );
  return { api, onClose, onReported, onAlreadyReported, ...view };
}

const send = () => fireEvent.click(screen.getByRole('button', { name: 'Send report' }));

describe('ReportPostDialog', () => {
  it('asks the server first, then shows the six reasons and an optional details box', async () => {
    let answer;
    const api = fakeApi({
      reportStatus: vi.fn(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          })
      ),
    });
    renderDialog({ api });
    expect(screen.getByRole('dialog', { name: 'Report this post' })).toBeTruthy();
    expect(screen.getByText('Checking…')).toBeTruthy(); // NFR-28: visible while the server is asked
    expect(screen.queryByRole('radio')).toBeNull();

    answer({ reported: false, report: null });
    await screen.findByRole('radio', { name: 'Spam or misleading' });
    expect(api.reportStatus).toHaveBeenCalledWith('p1');
    expect(screen.getAllByRole('radio')).toHaveLength(6);
    expect(screen.getByText(/this post by Asha Author/)).toBeTruthy();
    expect(screen.getByText('Details (optional)')).toBeTruthy();
    expect(screen.getByText('0/300')).toBeTruthy();
  });

  it('US-55 AC1: choose a reason, add details and send -> the report is sent and onReported gets the result', async () => {
    const { api, onReported } = renderDialog();
    fireEvent.click(await screen.findByRole('radio', { name: 'Harassment or bullying' }));
    fireEvent.change(screen.getByLabelText('Report details'), { target: { value: 'Rude replies' } });
    expect(screen.getByText('12/300')).toBeTruthy();
    send();

    await waitFor(() => expect(onReported).toHaveBeenCalled());
    expect(api.report).toHaveBeenCalledWith('p1', { reason: 'harassment', details: 'Rude replies' });
    expect(onReported.mock.calls[0][0].message).toBe(REPORT_CREATED_MESSAGE);
  });

  it('Send without a reason shows "Choose a reason" and sends nothing', async () => {
    const { api } = renderDialog();
    await screen.findByRole('radio', { name: 'Spam or misleading' });
    send();
    expect((await screen.findByRole('alert')).textContent).toBe(REPORT_REASON_MESSAGE);
    expect(api.report).not.toHaveBeenCalled();
  });

  it('"Something else" needs details before it is sent', async () => {
    const { api, onReported } = renderDialog();
    fireEvent.click(await screen.findByRole('radio', { name: 'Something else' }));
    expect(screen.getByText('What is wrong? (required)')).toBeTruthy();
    send();
    expect((await screen.findByRole('alert')).textContent).toBe(REPORT_DETAILS_REQUIRED_MESSAGE);
    expect(api.report).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Report details'), { target: { value: 'Copies my project' } });
    send();
    await waitFor(() => expect(onReported).toHaveBeenCalled());
    expect(api.report).toHaveBeenCalledWith('p1', { reason: 'other', details: 'Copies my project' });
  });

  it('US-55 AC2: when the server says it was already reported, the user is told so before the form', async () => {
    const api = fakeApi({ reportStatus: vi.fn(() => Promise.resolve({ reported: true, report: { reason: 'spam' } })) });
    const { onAlreadyReported, onClose } = renderDialog({ api });

    expect(await screen.findByText(REPORT_ALREADY_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(onAlreadyReported).toHaveBeenCalledTimes(1);
    expect(api.report).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('US-55 AC2: a 409 from Send also says "You have already reported this post."', async () => {
    const api = fakeApi({ report: vi.fn(() => Promise.reject(failure(409, REPORT_ALREADY_MESSAGE))) });
    const { onAlreadyReported, onReported } = renderDialog({ api });
    fireEvent.click(await screen.findByRole('radio', { name: 'Spam or misleading' }));
    send();

    expect(await screen.findByText(REPORT_ALREADY_MESSAGE)).toBeTruthy();
    expect(onAlreadyReported).toHaveBeenCalled();
    expect(onReported).not.toHaveBeenCalled();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('a card that already knows it was reported does not ask the server again', async () => {
    const { api } = renderDialog({ knownReported: true });
    expect(await screen.findByText(REPORT_ALREADY_MESSAGE)).toBeTruthy();
    expect(api.reportStatus).not.toHaveBeenCalled();
  });

  it('a server error keeps the form and the chosen reason, and shows a message (NFR-26)', async () => {
    const api = fakeApi({ report: vi.fn(() => Promise.reject(failure(500, 'internal'))) });
    const { onReported } = renderDialog({ api });
    const spam = await screen.findByRole('radio', { name: 'Spam or misleading' });
    fireEvent.click(spam);
    send();

    expect((await screen.findByRole('alert')).textContent).toBe(REPORT_FAILED_MESSAGE);
    expect(screen.getByRole('radio', { name: 'Spam or misleading' }).checked).toBe(true);
    expect(onReported).not.toHaveBeenCalled();
  });

  it('a failed status check still lets the user report (the server checks again on Send)', async () => {
    const api = fakeApi({ reportStatus: vi.fn(() => Promise.reject(failure(500))) });
    renderDialog({ api });
    expect(await screen.findByRole('radio', { name: 'Spam or misleading' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Cancel, the close button and Escape close it without sending', async () => {
    const { api, onClose } = renderDialog();
    const dialog = screen.getByRole('dialog');
    await screen.findByRole('radio', { name: 'Spam or misleading' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(api.report).not.toHaveBeenCalled();
  });
});

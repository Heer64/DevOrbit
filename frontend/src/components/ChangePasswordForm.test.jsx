// [Sprint 7 · M5] Settings → change password (old password required, other sessions logged out).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ChangePasswordForm from './ChangePasswordForm';

const user = { id: 'u1', name: 'Aarohi Mehta', email: 'aarohi@example.com', isDemo: false };
const box = (name) => screen.getByLabelText(name);
const submit = () => screen.getByRole('button', { name: /change password/i });

function fill({ current = 'old-password', next = 'new-password-1', confirm = 'new-password-1' } = {}) {
  fireEvent.change(box('Current password'), { target: { value: current } });
  fireEvent.change(box('New password'), { target: { value: next } });
  fireEvent.change(box('Confirm new password'), { target: { value: confirm } });
}

function apiError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.response = { status, data: { message, code } };
  return error;
}

describe('ChangePasswordForm', () => {
  it('shows three password boxes, hidden by default, and the button waits for all three', () => {
    render(<ChangePasswordForm user={user} api={{ changePassword: vi.fn() }} />);
    expect(box('Current password').type).toBe('password');
    expect(box('New password').type).toBe('password');
    expect(box('Confirm new password').type).toBe('password');
    expect(submit().disabled).toBe(true);
    fill();
    expect(submit().disabled).toBe(false);
  });

  it('sends the old and new password, then clears the form and shows the server message', async () => {
    const api = { changePassword: vi.fn(() => Promise.resolve({ message: 'Your password has been changed. 2 other sessions were signed out.', signedOutSessions: 2 })) };
    render(<ChangePasswordForm user={user} api={api} />);
    fill();
    fireEvent.click(submit());
    expect((await screen.findByRole('status')).textContent).toBe('Your password has been changed. 2 other sessions were signed out.');
    expect(api.changePassword).toHaveBeenCalledWith('old-password', 'new-password-1');
    expect(box('Current password').value).toBe('');
    expect(box('New password').value).toBe('');
    expect(box('Confirm new password').value).toBe('');
  });

  it('checks the form before sending anything', () => {
    const api = { changePassword: vi.fn() };
    render(<ChangePasswordForm user={user} api={api} />);
    fill({ confirm: 'something-else' });
    fireEvent.click(submit());
    expect(screen.getByRole('alert').textContent).toBe('The new passwords do not match.');

    fill({ next: 'short', confirm: 'short' });
    fireEvent.click(submit());
    expect(screen.getByRole('alert').textContent).toBe('Password must be at least 8 characters.');

    fill({ current: 'same-password', next: 'same-password', confirm: 'same-password' });
    fireEvent.click(submit());
    expect(screen.getByRole('alert').textContent).toBe('Choose a new password that is different from your current one.');
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it('a wrong old password shows the error, empties only that box and focuses it', async () => {
    const api = { changePassword: vi.fn(() => Promise.reject(apiError('Your current password is not correct.', 400, 'current_password_wrong'))) };
    render(<ChangePasswordForm user={user} api={api} />);
    fill();
    fireEvent.click(submit());
    expect((await screen.findByRole('alert')).textContent).toBe('Your current password is not correct.');
    expect(box('Current password').value).toBe('');
    expect(box('New password').value).toBe('new-password-1');
    expect(box('Confirm new password').value).toBe('new-password-1');
    await waitFor(() => expect(document.activeElement).toBe(box('Current password')));
  });

  it('other errors (e.g. too many attempts) are shown as they come', async () => {
    const api = { changePassword: vi.fn(() => Promise.reject(apiError('Too many attempts. Please wait a few minutes and try again.', 429))) };
    render(<ChangePasswordForm user={user} api={api} />);
    fill();
    fireEvent.click(submit());
    expect((await screen.findByRole('alert')).textContent).toBe('Too many attempts. Please wait a few minutes and try again.');
    expect(box('Current password').value).toBe('old-password');
  });

  it('"Show passwords" reveals all three boxes', () => {
    render(<ChangePasswordForm user={user} api={{ changePassword: vi.fn() }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show passwords' }));
    expect(box('Current password').type).toBe('text');
    expect(box('New password').type).toBe('text');
    expect(box('Confirm new password').type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide passwords' }));
    expect(box('New password').type).toBe('password');
  });

  it('demo accounts get a note instead of the form', () => {
    render(<ChangePasswordForm user={{ ...user, isDemo: true }} api={{ changePassword: vi.fn() }} />);
    expect(screen.queryByLabelText('Current password')).toBeNull();
    expect(screen.getByText(/Demo accounts have no password/)).toBeTruthy();
  });
});

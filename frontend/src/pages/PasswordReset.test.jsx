// [Sprint 6 · M1] US-04 Reset a forgotten password: the two pages and the login page link, with a fake API.
//  AC1 a registered email gets a single-use 1-hour link · AC2 an unknown email sees the same message
//  AC3 a valid link + new password changes it and ends every session (this browser too).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  verifyPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  login: vi.fn(),
}));
vi.mock('../api', () => ({
  authApi: {
    requestPasswordReset: mocks.requestPasswordReset,
    verifyPasswordReset: mocks.verifyPasswordReset,
    resetPassword: mocks.resetPassword,
  },
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ login: mocks.login, exploreDemo: vi.fn() }) }));

import ForgotPasswordPage, { FALLBACK_SENT_MESSAGE } from './ForgotPasswordPage';
import ResetPasswordPage, { LINK_INVALID_MESSAGE, newPasswordProblem, readResetToken } from './ResetPasswordPage';
import LoginPage from './LoginPage';

const TOKEN = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U_-';
const SENT =
  'If an account exists for that email, we have sent it a link to reset the password. The link works once and expires in 1 hour.';
const DONE = 'Your password has been changed and you have been signed out on every device. Log in with your new password.';

// Shows where the app went, with the router state, so the tests can check navigation.
function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.hash}|${location.state?.notice || ''}|${location.state?.email || ''}`}</p>;
}

function renderAt(entry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/forgot-password"
          element={
            <>
              <ForgotPasswordPage />
              <Where />
            </>
          }
        />
        <Route
          path="/reset-password"
          element={
            <>
              <ResetPasswordPage />
              <Where />
            </>
          }
        />
        <Route
          path="/login"
          element={
            <>
              <LoginPage />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

const apiError = (message, code, status = 400) =>
  Object.assign(new Error(message), { status, response: { status, data: { message, code } } });

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
});

describe('readResetToken / newPasswordProblem', () => {
  it('reads the token from the fragment (or the query), and ignores anything that is not a token', () => {
    expect(readResetToken({ hash: `#token=${TOKEN}` })).toBe(TOKEN);
    expect(readResetToken({ search: `?token=${TOKEN}` })).toBe(TOKEN);
    expect(readResetToken({ hash: '#token=short' })).toBe('');
    expect(readResetToken({ hash: '', search: '' })).toBe('');
    expect(readResetToken(undefined)).toBe('');
  });

  it('checks length and that both fields match', () => {
    expect(newPasswordProblem('long-enough', 'long-enough')).toBe('');
    expect(newPasswordProblem('short', 'short')).toBe('Password must be at least 8 characters.');
    expect(newPasswordProblem('x'.repeat(129), 'x'.repeat(129))).toBe('Password must be 128 characters or fewer.');
    expect(newPasswordProblem('long-enough', 'long-enougH')).toBe('The two passwords do not match.');
  });
});

describe('Forgot password page (AC1, AC2)', () => {
  it('sends the email and shows the server confirmation', async () => {
    mocks.requestPasswordReset.mockResolvedValue({ message: SENT });
    renderAt('/forgot-password');
    expect(screen.getByRole('heading', { name: 'Forgot your password?' })).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: '  riya@example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect((await screen.findByRole('status')).textContent).toBe(SENT);
    expect(mocks.requestPasswordReset).toHaveBeenCalledWith('riya@example.com');
    expect(screen.getByRole('link', { name: /back to log in/i }).getAttribute('href')).toBe('/login');
  });

  it('AC2: shows exactly what the server says, so a known and an unknown email look the same', async () => {
    mocks.requestPasswordReset.mockResolvedValue({ message: SENT });
    renderAt('/forgot-password');
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'nobody@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    expect((await screen.findByRole('status')).textContent).toBe(SENT);
    // Falls back to the same wording if the server sends no text.
    expect(FALLBACK_SENT_MESSAGE).toBe(SENT);
  });

  it('shows an error from the server (e.g. invalid email or email not set up) and keeps the form', async () => {
    mocks.requestPasswordReset.mockRejectedValue(
      apiError('Password reset by email is not available on this server right now. Please try again later.', undefined, 503)
    );
    renderAt('/forgot-password');
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'riya@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/not available on this server/);
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeTruthy();
  });

  it('keeps the email typed on the login page, and can send another link', async () => {
    mocks.requestPasswordReset.mockResolvedValue({ message: SENT });
    render(
      <MemoryRouter initialEntries={[{ pathname: '/forgot-password', state: { email: 'riya@example.com' } }]}>
        <Routes>
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByPlaceholderText('you@example.com').value).toBe('riya@example.com');
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: /send another link/i }));
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeTruthy();
  });
});

describe('Reset password page (AC1, AC3)', () => {
  it('checks the link, removes the token from the address bar, and shows the form', async () => {
    mocks.verifyPasswordReset.mockResolvedValue({ valid: true });
    renderAt(`/reset-password#token=${TOKEN}`);
    expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeTruthy();
    expect(await screen.findByPlaceholderText('At least 8 characters')).toBeTruthy();
    expect(mocks.verifyPasswordReset).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByTestId('where').textContent).toBe('/reset-password||'); // no #token= left
  });

  it('AC3: changes the password, signs this browser out and goes to log in with the confirmation', async () => {
    mocks.verifyPasswordReset.mockResolvedValue({ valid: true });
    mocks.resetPassword.mockResolvedValue({ message: DONE });
    const expired = vi.fn();
    window.addEventListener('devorbit:session-expired', expired);
    renderAt(`/reset-password#token=${TOKEN}`);

    fireEvent.change(await screen.findByPlaceholderText('At least 8 characters'), { target: { value: 'brand-new-pass' } });
    fireEvent.change(screen.getByPlaceholderText('Type it again'), { target: { value: 'brand-new-pass' } });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`/login|${DONE}|`));
    expect(mocks.resetPassword).toHaveBeenCalledWith(TOKEN, 'brand-new-pass');
    expect(expired).toHaveBeenCalledTimes(1);
    // The login page shows the confirmation.
    expect(screen.getByRole('status').textContent).toBe(DONE);
    window.removeEventListener('devorbit:session-expired', expired);
  });

  it('does not call the API when the passwords are too short or do not match', async () => {
    mocks.verifyPasswordReset.mockResolvedValue({ valid: true });
    renderAt(`/reset-password#token=${TOKEN}`);
    const first = await screen.findByPlaceholderText('At least 8 characters');
    fireEvent.change(first, { target: { value: 'brand-new-pass' } });
    fireEvent.change(screen.getByPlaceholderText('Type it again'), { target: { value: 'brand-new-paSS' } });
    fireEvent.submit(first.closest('form'));
    expect((await screen.findByRole('alert')).textContent).toBe('The two passwords do not match.');

    fireEvent.change(first, { target: { value: 'short' } });
    fireEvent.change(screen.getByPlaceholderText('Type it again'), { target: { value: 'short' } });
    fireEvent.submit(first.closest('form'));
    expect((await screen.findByRole('alert')).textContent).toBe('Password must be at least 8 characters.');
    expect(mocks.resetPassword).not.toHaveBeenCalled();
  });

  it('an expired or already-used link shows the message and a way to get a new one', async () => {
    mocks.verifyPasswordReset.mockRejectedValue(apiError(LINK_INVALID_MESSAGE, 'reset_link_invalid'));
    renderAt(`/reset-password#token=${TOKEN}`);
    expect((await screen.findByRole('alert')).textContent).toBe(LINK_INVALID_MESSAGE);
    expect(screen.getByRole('link', { name: /request a new link/i }).getAttribute('href')).toBe('/forgot-password');
    expect(screen.queryByPlaceholderText('At least 8 characters')).toBeNull();
  });

  it('a link that expires while the form is open switches to the "request a new link" view', async () => {
    mocks.verifyPasswordReset.mockResolvedValue({ valid: true });
    mocks.resetPassword.mockRejectedValue(apiError(LINK_INVALID_MESSAGE, 'reset_link_invalid'));
    renderAt(`/reset-password#token=${TOKEN}`);
    fireEvent.change(await screen.findByPlaceholderText('At least 8 characters'), { target: { value: 'brand-new-pass' } });
    fireEvent.change(screen.getByPlaceholderText('Type it again'), { target: { value: 'brand-new-pass' } });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));
    expect(await screen.findByRole('link', { name: /request a new link/i })).toBeTruthy();
  });

  it('opening the page without a token never calls the API', () => {
    renderAt('/reset-password');
    expect(screen.getByRole('alert').textContent).toBe(LINK_INVALID_MESSAGE);
    expect(mocks.verifyPasswordReset).not.toHaveBeenCalled();
  });
});

describe('Login page link (US-04)', () => {
  it('"Forgot password?" opens the reset page with the email typed so far', async () => {
    renderAt('/login');
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'riya@example.com' } });
    fireEvent.click(screen.getByRole('link', { name: 'Forgot password?' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/forgot-password||riya@example.com'));
    expect(screen.getByPlaceholderText('you@example.com').value).toBe('riya@example.com');
  });
});

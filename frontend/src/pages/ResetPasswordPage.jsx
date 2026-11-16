// [Sprint 6 · M1] US-04 Reset a forgotten password, step 2: the page the emailed link opens (Actor: Visitor).
// The link is /reset-password#token=...: the token is in the URL fragment, which the browser never sends to a server.
// The page reads it once, removes it from the address bar, checks it with the API, then asks for the new password.
// AC3: on success the API ends every session, so this browser is signed out too and goes to the login page.
import { useEffect, useState } from 'react';
import { ArrowLeft, LockKeyhole } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthLayout from '../components/AuthLayout';
import { authApi } from '../api';

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const LINK_INVALID_MESSAGE = 'This reset link is invalid, has expired or has already been used. Request a new one.';
export const DONE_FALLBACK = 'Your password has been changed and you have been signed out on every device. Log in with your new password.';

// The token from "#token=..." (or "?token=..." in case a mail client moved it), or ''.
export function readResetToken(location) {
  const fromHash = new URLSearchParams(String(location?.hash || '').replace(/^#/, '')).get('token');
  const fromQuery = new URLSearchParams(String(location?.search || '')).get('token');
  const token = (fromHash || fromQuery || '').trim();
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : '';
}

// '' when the two fields are fine, otherwise the message to show. The server checks the same rules again.
export function newPasswordProblem(password, confirm) {
  if (password.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Password must be ${PASSWORD_MAX} characters or fewer.`;
  if (password !== confirm) return 'The two passwords do not match.';
  return '';
}

export default function ResetPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // Read once, on the first render, before the token is removed from the address bar.
  const [token] = useState(() => readResetToken(location));
  const [status, setStatus] = useState(token ? 'checking' : 'invalid'); // checking | ready | invalid
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Keep the token out of the address bar and the browser history.
    if (location.hash || location.search) navigate(location.pathname, { replace: true });
    if (!token) return undefined;
    let active = true;
    authApi
      .verifyPasswordReset(token)
      .then(() => active && setStatus('ready'))
      .catch(() => active && setStatus('invalid'));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once for the token read on the first render
  }, []);

  const onSubmit = async (event) => {
    event.preventDefault();
    const problem = newPasswordProblem(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setSaving(true);
    try {
      const result = await authApi.resetPassword(token, password);
      // AC3: every session has ended on the server; drop this browser's signed-in state as well.
      window.dispatchEvent(new Event('devorbit:session-expired'));
      navigate('/login', { replace: true, state: { notice: result?.message || DONE_FALLBACK } });
    } catch (err) {
      if (err?.response?.data?.code === 'reset_link_invalid') setStatus('invalid');
      else setError(err?.message || 'Could not change the password. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthLayout mode="reset">
      {status === 'checking' && (
        <p className="reset-hint" role="status">
          Checking your reset link…
        </p>
      )}

      {status === 'invalid' && (
        <div className="reset-done">
          <div className="form-error" role="alert">
            {LINK_INVALID_MESSAGE}
          </div>
          <Link className="btn full" to="/forgot-password">
            <LockKeyhole size={15} /> Request a new link
          </Link>
          <Link className="textbtn reset-back" to="/login">
            <ArrowLeft size={13} /> Back to log in
          </Link>
        </div>
      )}

      {status === 'ready' && (
        <form onSubmit={onSubmit}>
          <label>
            New password
            <div className="field">
              <LockKeyhole size={16} />
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={PASSWORD_MIN}
                maxLength={PASSWORD_MAX}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </div>
          </label>
          <label>
            Confirm new password
            <div className="field">
              <LockKeyhole size={16} />
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={PASSWORD_MIN}
                maxLength={PASSWORD_MAX}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Type it again"
              />
            </div>
          </label>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button className="btn full" disabled={saving} type="submit">
            {saving ? 'Saving...' : 'Change password'} <LockKeyhole size={15} />
          </button>
        </form>
      )}
    </AuthLayout>
  );
}

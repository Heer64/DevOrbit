// [Sprint 6 · M1] US-04 Reset a forgotten password, step 1: ask for a reset link by email (Actor: Visitor).
// The API answers with the same message whether or not the email has an account (AC2), and this page shows
// exactly that message, so it never reveals whether an account exists either.
import { useState } from 'react';
import { ArrowLeft, Mail, Send } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import AuthLayout from '../components/AuthLayout';
import { authApi } from '../api';

export const FALLBACK_SENT_MESSAGE =
  'If an account exists for that email, we have sent it a link to reset the password. The link works once and expires in 1 hour.';

export default function ForgotPasswordPage() {
  const location = useLocation();
  // The login page passes what was typed there, so the visitor does not type it twice.
  const [email, setEmail] = useState(typeof location.state?.email === 'string' ? location.state.email : '');
  const [sent, setSent] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await authApi.requestPasswordReset(email.trim());
      setSent(result?.message || FALLBACK_SENT_MESSAGE);
    } catch (err) {
      setError(err?.message || 'Could not reach DevOrbit. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout mode="forgot">
      {sent ? (
        <div className="reset-done">
          <p className="success-inline" role="status">
            {sent}
          </p>
          <p className="reset-hint">Can't find it? Check your spam folder. Only the newest link works.</p>
          <button type="button" className="btn secondary full" onClick={() => setSent('')}>
            <Send size={15} /> Send another link
          </button>
          <Link className="textbtn reset-back" to="/login">
            <ArrowLeft size={13} /> Back to log in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit}>
          <label>
            Email address
            <div className="field">
              <Mail size={16} />
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
          </label>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button className="btn full" disabled={loading} type="submit">
            {loading ? 'Sending link...' : 'Send reset link'} <Send size={15} />
          </button>
          <Link className="textbtn reset-back" to="/login">
            <ArrowLeft size={13} /> Back to log in
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}

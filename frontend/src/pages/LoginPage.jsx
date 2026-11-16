import { useState } from 'react';
import { ArrowRight, LockKeyhole, Mail, Sparkles } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthLayout from '../components/AuthLayout';
import { useAuth } from '../context/AuthContext';

// [Sprint 3 · M2] Where to go after logging in: the page that sent the user here, or the dashboard.
// Only in-app paths are used, never another site.
export function returnPath(from) {
  const path = from?.pathname;
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path === '/login' || path === '/signup') return '/dashboard';
  return `${path}${from.search || ''}`;
}

export default function LoginPage() {
  const { login, exploreDemo } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // [Sprint 6 · M1] US-04: after a password reset the reset page sends the visitor here with a confirmation.
  const notice = typeof location.state?.notice === 'string' ? location.state.notice : '';

  const onSubmit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try { await login(email, password); navigate(returnPath(location.state?.from), { replace: true }); }
    catch (err) { setError(err?.message || 'Could not connect to the DevOrbit API. Start the backend or explore the demo.'); }
    finally { setLoading(false); }
  };

  const demo = () => { exploreDemo(); navigate('/dashboard'); };

  return (
    <AuthLayout mode="login">
      <form onSubmit={onSubmit}>
        {notice && <p className="success-inline" role="status">{notice}</p>}
        <label>Email address<div className="field"><Mail size={16} /><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></div></label>
        <label>Password<div className="field"><LockKeyhole size={16} /><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" minLength={8} /></div></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="between">
          <label className="check"><input type="checkbox" /> Remember me</label>
          {/* [Sprint 6 · M1] US-04: opens the reset page with the email typed so far. */}
          <Link className="textbtn" to="/forgot-password" state={{ email }}>Forgot password?</Link>
        </div>
        <button className="btn full" disabled={loading} type="submit">{loading ? 'Signing in...' : 'Log in to DevOrbit'} <ArrowRight size={16} /></button>
      </form>
      <div className="or"><span />or jump right in<span /></div>
      <button type="button" className="btn github full" onClick={demo}><Sparkles size={17} /> Explore the interactive demo</button>
    </AuthLayout>
  );
}

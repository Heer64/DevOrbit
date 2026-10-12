import { useState } from 'react';
import { ArrowRight, LockKeyhole, Mail, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import AuthLayout from '../components/AuthLayout';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login, exploreDemo } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try { await login(email, password); navigate('/dashboard'); }
    catch (err) { setError(err?.message || 'Could not connect to the DevOrbit API. Start the backend or explore the demo.'); }
    finally { setLoading(false); }
  };

  const demo = () => { exploreDemo(); navigate('/dashboard'); };

  return (
    <AuthLayout mode="login">
      <form onSubmit={onSubmit}>
        <label>Email address<div className="field"><Mail size={16} /><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></div></label>
        <label>Password<div className="field"><LockKeyhole size={16} /><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" minLength={8} /></div></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="between">
          <label className="check"><input type="checkbox" /> Remember me</label>
          <button type="button" className="textbtn" onClick={() => setError('Password reset will be available when the email service is configured.')}>Forgot password?</button>
        </div>
        <button className="btn full" disabled={loading} type="submit">{loading ? 'Signing in...' : 'Log in to DevOrbit'} <ArrowRight size={16} /></button>
      </form>
      <div className="or"><span />or jump right in<span /></div>
      <button type="button" className="btn github full" onClick={demo}><Sparkles size={17} /> Explore the interactive demo</button>
    </AuthLayout>
  );
}

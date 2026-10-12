import { useState } from 'react';
import { ArrowRight, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import AuthLayout from '../components/AuthLayout';
import { useAuth } from '../context/AuthContext';

export default function SignupPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    try { await register(name, email, password); navigate('/dashboard'); }
    catch (err) { setError(err?.message || 'Could not connect to the API. Start the backend to create an account, or return to sign in and explore the demo.'); }
    finally { setLoading(false); }
  };

  return (
    <AuthLayout mode="signup">
      <form onSubmit={submit}>
        <label>Full name<div className="field"><UserRound size={16} /><input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aarav Mehta" autoComplete="name" /></div></label>
        <label>Email address<div className="field"><Mail size={16} /><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" /></div></label>
        <label>Password<div className="field"><LockKeyhole size={16} /><input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" /></div></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="btn full" disabled={loading}>{loading ? 'Creating account...' : 'Create account'} <ArrowRight size={16} /></button>
      </form>
    </AuthLayout>
  );
}

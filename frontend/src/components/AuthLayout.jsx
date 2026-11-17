import { Github, SquareKanban, MessagesSquare, Moon, ShieldCheck, Sparkles, Sun } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import Logo from './Logo';
import Logo3D from './Logo3D';
import { Avatar } from './ui';
import { useTheme } from '../context/ThemeContext';

// Card heading for each auth page. [Sprint 6 · M1] US-04 adds the two password reset pages.
const HEADINGS = {
  login: ['Welcome back', 'Your next breakthrough is waiting.'],
  signup: ['Create your account', 'Start building with your team.'],
  forgot: ['Forgot your password?', "Enter your email and we'll send you a link to choose a new one."],
  reset: ['Choose a new password', 'Use at least 8 characters. You will be signed out on every device.'],
};

export default function AuthLayout({ mode = 'login', children }) {
  const navigate = useNavigate();
  const { dark, toggle } = useTheme();
  const isLogin = mode === 'login';
  const [title, subtitle] = HEADINGS[mode] || HEADINGS.login;
  return (
    <div className="auth">
      <header className="auth-head">
        <Link to="/welcome" className="brand-link" aria-label="DevOrbit intro"><Logo /></Link>
        <div className="auth-head-actions">
          <Link to="/welcome" className="tour-link">Take the tour</Link>
          <button className="iconbtn" onClick={toggle} aria-label="Toggle theme" title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
        </div>
      </header>
      <div className="auth-layout">
        <section className="hero-copy">
          <div className="demo-pill"><i /> Team workspace for builders</div>
          <h1>Plan, build and ship together, in <em>one orbit</em>.</h1>
          <p>Tasks, Kanban boards, chat, docs and GitHub activity in one place, plus a Copilot that catches you up on what you missed.</p>
          <div className="hero-features">
            {[[SquareKanban, 'Real-time Kanban', ''], [Github, 'GitHub in your feed', 'cream'], [MessagesSquare, 'Channels and threads', 'coral'], [Sparkles, 'Copilot summaries', '']].map(([Icon, text, cls]) => (
              <div key={text}><span className={`hero-ic ${cls}`}><Icon size={16} /></span>{text}</div>
            ))}
          </div>
          <div className="proof">
            <div className="stack"><Avatar initials="MP" tone="mint" /><Avatar initials="AM" tone="orange" /><Avatar initials="IS" /></div>
            <div><b>Built for teams that build.</b><small>From first sketch to shipped work.</small></div>
          </div>
        </section>
        <div className="auth-orbit" aria-hidden="true"><div className="auth-glow" /><div className="floaty"><Logo3D size={300} /></div><div className="auth-shadow" /></div>
        <section className="auth-card">
          <div className="card-title">
            <div>
              <h2>{title}</h2>
              <p>{subtitle}</p>
            </div>
            <span><Sparkles size={17} /></span>
          </div>
          <div className="auth-tabs">
            <button type="button" className={isLogin ? 'active' : ''} onClick={() => navigate('/login')}>Log in</button>
            <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => navigate('/signup')}>Sign up</button>
          </div>
          {children}
          <p className="terms">By continuing, you agree to our <a href="#terms">Terms</a> and <a href="#privacy">Privacy Policy</a>.</p>
          <div className="safe"><ShieldCheck size={15} /> Your projects stay yours. Always.</div>
        </section>
      </div>
      <footer className="auth-footer"><span>© 2026 DevOrbit</span><span>Build together. Stay in context.</span><span>Made for makers ✦</span></footer>
    </div>
  );
}

import { Moon, ShieldCheck, Sparkles, Sun } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Logo, { LogoMark } from './Logo';
import { Avatar } from './ui';
import { useTheme } from '../context/ThemeContext';

export default function AuthLayout({ mode = 'login', children }) {
  const navigate = useNavigate();
  const { dark, toggle } = useTheme();
  const isLogin = mode === 'login';
  return (
    <div className="auth">
      <header className="auth-head">
        <Logo />
        <button className="iconbtn" onClick={toggle} aria-label="Toggle theme" title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
      </header>
      <div className="auth-layout">
        <section className="hero-copy">
          <div className="eyebrow"><i /> YOUR PROJECT, IN ORBIT</div>
          <h1>Great work<br />doesn't happen<br /><em>in silos.</em></h1>
          <p>One home for your team's conversations, code, decisions, and next big idea. Pick up the context. Keep the momentum.</p>
          <div className="proof">
            <div className="stack"><Avatar initials="MP" tone="mint" /><Avatar initials="AM" tone="orange" /><Avatar initials="IS" /></div>
            <div><b>Built for teams that build.</b><small>From first sketch to shipped work.</small></div>
          </div>
          <div className="orb-art"><div /><div /><div /><LogoMark /></div>
        </section>
        <section className="auth-card">
          <div className="card-title">
            <div>
              <h2>{isLogin ? 'Welcome back' : 'Create your account'}</h2>
              <p>{isLogin ? 'Your next breakthrough is waiting.' : 'Start building with your team.'}</p>
            </div>
            <span><Sparkles size={17} /></span>
          </div>
          <div className="auth-tabs">
            <button type="button" className={isLogin ? 'active' : ''} onClick={() => navigate('/login')}>Log in</button>
            <button type="button" className={!isLogin ? 'active' : ''} onClick={() => navigate('/signup')}>Sign up</button>
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

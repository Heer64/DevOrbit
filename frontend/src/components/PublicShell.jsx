import { Link, Outlet, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';
import Logo from './Logo';

/*
 * [Sprint 5 · M1] US-45: the light page frame for visitors who are NOT logged in
 * (FR-30: a Public Visitor can browse public projects and public project pages, and can
 * sign up or log in). Logged-in users never see it; they get the normal AppShell.
 *
 * Reusable: render it as a layout route and put the public page inside, e.g.
 *   <Route path="/discover" element={<PublicOrAppShell />}><Route index element={<DiscoverPage />} /></Route>
 * M2 (US-46 public project page) can use it the same way. "Log in" remembers the current page,
 * so after logging in the visitor comes back to it (LoginPage returnPath).
 */
export default function PublicShell({ children }) {
  const location = useLocation();
  const from = { pathname: location.pathname, search: location.search };
  return (
    <div className="shell public-shell" style={{ flexDirection: 'column' }}>
      <header className="topbar" aria-label="DevOrbit">
        <Link to="/discover" aria-label="DevOrbit home: Discover" style={{ color: 'inherit', textDecoration: 'none' }}><Logo /></Link>
        <nav aria-label="Account" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link to="/discover" className="link" style={{ marginTop: 0, display: 'inline-flex', alignItems: 'center', gap: 5 }}><Compass size={14} /> Discover</Link>
          <Link to="/login" state={{ from }} className="btn secondary small">Log in</Link>
          <Link to="/signup" state={{ from }} className="btn small">Sign up</Link>
        </nav>
      </header>
      <main className="content">{children || <Outlet />}</main>
    </div>
  );
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 5 · M1] What this file does
 * Page frame (logo, Discover, Log in, Sign up) for logged-out visitors on public
 * pages such as Discover. Works as a layout route (Outlet) or with children.
 * ---------------------------------------------------------------------------
 */

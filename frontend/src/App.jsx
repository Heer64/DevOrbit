import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import AppShell from './components/AppShell';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import DashboardPage from './pages/DashboardPage';
import ProfilePage from './pages/ProfilePage';
import DiscoverPage from './pages/DiscoverPage';
import ProjectPage from './pages/ProjectPage';
import PublicShell from './components/PublicShell'; // [Sprint 5 · M1] US-45
import PortfolioPage from './pages/PortfolioPage'; // [Sprint 5 · M5] US-49
import UserProfilePage from './pages/UserProfilePage'; // [Sprint 5 · M3] US-06
import FeedPage from './pages/FeedPage'; // [Sprint 5 · M6] US-50, US-51

// [Sprint 5 · M1] US-45 (Actor: Visitor): public pages open without logging in. Logged-out
// visitors get the light PublicShell; logged-in users keep the normal AppShell around the same page.
export function PublicOrAppShell() {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="boot"><div className="auth-card"><div className="card-title"><div><h2>Opening your orbit…</h2><p>Restoring your DevOrbit session.</p></div></div></div></div>;
  }
  return user ? <AppShell /> : <PublicShell />;
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <div className="boot"><div className="auth-card"><div className="card-title"><div><h2>Opening your orbit…</h2><p>Restoring your DevOrbit session.</p></div></div></div></div>;
  }
  // [Sprint 3 · M2] Remember the page, so after logging in the user comes back to it
  // (US-47: a logged-out visitor who opens a project is asked to log in first, then can request to join).
  return user ? children : <Navigate to="/login" replace state={{ from: location }} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="profile" element={<ProfilePage />} />
        {/* [Sprint 5 · M1] US-45: /discover moved out of ProtectedRoute (below) so visitors can open it. */}
        <Route path="project/:id" element={<ProjectPage />} />
        {/* [Sprint 5 · M3] US-06 (Actor: Registered User): another user's read-only profile, login required. */}
        <Route path="people/:username" element={<UserProfilePage />} />
        {/* [Sprint 5 · M6] US-50/US-51: community feed (public posts). Logged-in users only. */}
        <Route path="feed" element={<FeedPage />} />
      </Route>
      {/* [Sprint 5 · M1] US-45: Discover works logged out (PublicShell) and logged in (AppShell). */}
      <Route path="/discover" element={<PublicOrAppShell />}>
        <Route index element={<DiscoverPage />} />
      </Route>
      {/* [Sprint 5 · M5] US-49 AC3: a shared portfolio link opens for anyone, read-only. */}
      <Route path="/portfolio/:username" element={<PublicOrAppShell />}>
        <Route index element={<PortfolioPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

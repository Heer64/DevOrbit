import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi, clearAccessToken, normalizeUser, setAccessToken } from '../api';

const AuthContext = createContext(null);
const demoUser = normalizeUser({
  id: 'demo-user',
  name: 'Aarav Mehta',
  fullName: 'Aarav Mehta',
  email: 'aarav@example.com',
  username: 'aaravmehta',
  headline: 'Full-stack developer · Building useful things',
  bio: 'Full-stack developer · Building useful things',
  skills: ['React', 'Node.js', 'MongoDB', 'TypeScript'],
  avatar: 'AM',
  isDemo: true,
});

function cachedUser() {
  try { return JSON.parse(localStorage.getItem('devorbit_user') || 'null'); }
  catch { return null; }
}

export function AuthProvider({ children }) {
  // Never restore the demo identity across page reloads. Only a valid
  // server-side refresh session may restore a real signed-in user.
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const saveUser = useCallback((nextUser) => {
    const normalized = normalizeUser(nextUser);
    setUser(normalized);
    localStorage.setItem('devorbit_user', JSON.stringify(normalized));
    return normalized;
  }, []);

  useEffect(() => {
    const saved = cachedUser();
    // Remove demo state written by previous builds; it must not bypass login.
    if (saved?.isDemo) localStorage.removeItem('devorbit_user');

    let mounted = true;
    authApi.refresh()
      .then((result) => {
        if (!mounted) return;
        setAccessToken(result.accessToken);
        saveUser(result.user);
      })
      .catch(() => {
        if (!mounted) return;
        clearAccessToken();
        localStorage.removeItem('devorbit_user');
        setUser(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    const onExpired = () => {
      clearAccessToken();
      localStorage.removeItem('devorbit_user');
      setUser(null);
      setLoading(false);
    };
    window.addEventListener('devorbit:session-expired', onExpired);
    return () => {
      mounted = false;
      window.removeEventListener('devorbit:session-expired', onExpired);
    };
  }, [saveUser]);

  const login = async (email, password) => {
    const result = await authApi.login({ email, password });
    setAccessToken(result.accessToken);
    return saveUser(result.user);
  };

  const register = async (name, email, password) => {
    const result = await authApi.register({ name, email, password });
    setAccessToken(result.accessToken);
    return saveUser(result.user);
  };

  const exploreDemo = () => {
    clearAccessToken();
    // Keep demo identity in memory only. Reloading the page returns to login.
    localStorage.removeItem('devorbit_user');
    setUser(demoUser);
    setLoading(false);
  };

  const logout = async () => {
    try {
      if (user && !user.isDemo) await authApi.logout();
    } catch {
      // Always clear the local UI state. The backend cookie/session may already have expired.
    }
    clearAccessToken();
    localStorage.removeItem('devorbit_user');
    setUser(null);
  };

  const updateUser = (nextUser) => saveUser({ ...user, ...nextUser });

  const value = useMemo(() => ({ user, loading, login, register, exploreDemo, logout, updateUser }), [user, loading, saveUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

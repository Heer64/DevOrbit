import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/*
 * Light / dark theme for the whole app.
 * [Sprint 7 · M5] Settings page: the choice can now also be "system" (follow the device's light/dark setting,
 * and change live when the device changes). The choice is kept per browser in localStorage ('devorbit_theme').
 *   choice  'dark' | 'light' | 'system'   what the user picked (Settings → Appearance)
 *   theme   'dark' | 'light'              what is shown right now
 *   toggle  switches between dark and light (top bar, account menu, "T" shortcut); leaves "system" mode
 * Saved values from before ('dark', 'light' or nothing) keep working exactly as they did.
 */
export const THEME_CHOICES = ['dark', 'light', 'system'];
const STORAGE_KEY = 'devorbit_theme';
const LIGHT_QUERY = '(prefers-color-scheme: light)';

const ThemeContext = createContext({ theme: 'dark', choice: 'dark', dark: true, toggle: () => {}, setTheme: () => {} });

export function readThemeChoice() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return THEME_CHOICES.includes(saved) ? saved : 'dark';
  } catch {
    return 'dark';
  }
}

function lightMedia() {
  try { return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(LIGHT_QUERY) : null; }
  catch { return null; }
}

export function systemTheme() {
  return lightMedia()?.matches ? 'light' : 'dark';
}

export function resolveTheme(choice, system = systemTheme()) {
  if (choice === 'light') return 'light';
  if (choice === 'system') return system === 'light' ? 'light' : 'dark';
  return 'dark';
}

export function ThemeProvider({ children }) {
  const [choice, setChoice] = useState(readThemeChoice);
  const [system, setSystem] = useState(systemTheme);
  const theme = resolveTheme(choice, system);

  // Follow the device while "system" is picked.
  useEffect(() => {
    if (choice !== 'system') return undefined;
    const media = lightMedia();
    if (!media) return undefined;
    const onChange = () => setSystem(media.matches ? 'light' : 'dark');
    onChange();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }
    media.addListener?.(onChange); // older Safari
    return () => media.removeListener?.(onChange);
  }, [choice]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(theme);
    root.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#120b09' : '#f7f3ee');
  }, [theme]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, choice); } catch { /* storage unavailable */ }
  }, [choice]);

  const setTheme = useCallback((value) => {
    if (THEME_CHOICES.includes(value)) setChoice(value);
  }, []);
  const toggle = useCallback(() => setChoice(theme === 'dark' ? 'light' : 'dark'), [theme]);
  const value = useMemo(() => ({ theme, choice, dark: theme === 'dark', toggle, setTheme }), [theme, choice, toggle, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

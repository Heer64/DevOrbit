import { Monitor, Moon, Palette, Sun } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { THEME_OPTIONS } from '../settings';

/*
 * [Sprint 7 · M5] Settings → Appearance: Dark, Light or System (follow the device). Applies at once and is
 * remembered in this browser (context/ThemeContext.jsx). The top-bar button and the "T" shortcut still switch
 * between dark and light.
 */
const ICONS = { dark: Moon, light: Sun, system: Monitor };

export default function ThemeSettings() {
  const { choice, theme, setTheme } = useTheme();

  return (
    <section className="panel settings-card" aria-label="Appearance">
      <div className="panel-head">
        <div>
          <div className="eyebrow">
            <Palette size={12} /> APPEARANCE
          </div>
          <h2 style={{ marginTop: 6 }}>Theme</h2>
          <p>Choose how DevOrbit looks on this device. It changes straight away.</p>
        </div>
      </div>
      <div className="segmented theme-options" role="radiogroup" aria-label="Theme">
        {THEME_OPTIONS.map(({ value, label, hint }) => {
          const Icon = ICONS[value];
          return (
            <label key={value} className={choice === value ? 'on' : ''}>
              <input
                type="radio"
                name="theme"
                value={value}
                checked={choice === value}
                onChange={() => setTheme(value)}
                aria-label={label}
              />
              <Icon size={15} aria-hidden="true" />
              <span>
                {label}
                <small>{hint}</small>
              </span>
            </label>
          );
        })}
      </div>
      <p className="tiny-note settings-theme-note" aria-live="polite">
        {choice === 'system' ? `Following this device: ${theme} right now.` : `${theme === 'dark' ? 'Dark' : 'Light'} theme is on.`} Saved
        in this browser.
      </p>
    </section>
  );
}

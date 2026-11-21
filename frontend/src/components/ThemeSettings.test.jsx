// [Sprint 7 · M5] Settings → Appearance: Dark / Light / System theme.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, readThemeChoice, resolveTheme, useTheme } from '../context/ThemeContext';
import ThemeSettings from './ThemeSettings';

// A fake device setting for "(prefers-color-scheme: light)" that the test can flip.
function fakeDevice(light) {
  const listeners = new Set();
  const media = {
    get matches() { return light; },
    addEventListener: (_type, fn) => listeners.add(fn),
    removeEventListener: (_type, fn) => listeners.delete(fn),
  };
  window.matchMedia = vi.fn(() => media);
  return { flip(next) { light = next; listeners.forEach((fn) => fn()); } };
}

function Toggle() {
  const { toggle } = useTheme();
  return <button type="button" onClick={toggle}>toggle</button>;
}

const renderSettings = () => render(<ThemeProvider><ThemeSettings /><Toggle /></ThemeProvider>);
const radio = (name) => screen.getByRole('radio', { name });
const shown = () => document.documentElement.dataset.theme;

afterEach(() => { delete window.matchMedia; });

describe('ThemeSettings', () => {
  it('starts on Dark when nothing is saved (the old default)', () => {
    renderSettings();
    expect(radio('Dark').checked).toBe(true);
    expect(shown()).toBe('dark');
  });

  it('keeps a "light" saved by an older version', () => {
    localStorage.setItem('devorbit_theme', 'light');
    renderSettings();
    expect(radio('Light').checked).toBe(true);
    expect(shown()).toBe('light');
  });

  it('picking Light applies it at once and saves it in this browser', () => {
    renderSettings();
    fireEvent.click(radio('Light'));
    expect(shown()).toBe('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(localStorage.getItem('devorbit_theme')).toBe('light');
  });

  it('System follows the device, and changes live when the device changes', () => {
    const device = fakeDevice(true);
    renderSettings();
    fireEvent.click(radio('System'));
    expect(shown()).toBe('light');
    expect(localStorage.getItem('devorbit_theme')).toBe('system');
    expect(screen.getByText(/Following this device: light right now/)).toBeTruthy();
    act(() => device.flip(false));
    expect(shown()).toBe('dark');
  });

  it('the top-bar toggle still flips dark/light and leaves System mode', () => {
    fakeDevice(true);
    renderSettings();
    fireEvent.click(radio('System'));
    expect(shown()).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(shown()).toBe('dark');
    expect(radio('Dark').checked).toBe(true);
  });
});

describe('theme helpers', () => {
  it('resolveTheme', () => {
    expect(resolveTheme('dark', 'light')).toBe('dark');
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme('system', 'light')).toBe('light');
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('nonsense', 'light')).toBe('dark');
  });

  it('readThemeChoice ignores unknown saved values', () => {
    localStorage.setItem('devorbit_theme', 'purple');
    expect(readThemeChoice()).toBe('dark');
    localStorage.setItem('devorbit_theme', 'system');
    expect(readThemeChoice()).toBe('system');
  });
});

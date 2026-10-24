// [Sprint 3 · M2] After logging in, go back to the page that asked for it (US-47: log in first, then request to join).
import { describe, expect, it, vi } from 'vitest';

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ login: vi.fn(), exploreDemo: vi.fn() }) }));

import { returnPath } from './LoginPage';

describe('returnPath', () => {
  it('returns to the page that sent the user to log in', () => {
    expect(returnPath({ pathname: '/project/abc', search: '?tab=tasks' })).toBe('/project/abc?tab=tasks');
    expect(returnPath({ pathname: '/discover' })).toBe('/discover');
  });

  it('falls back to the dashboard for anything else', () => {
    expect(returnPath(undefined)).toBe('/dashboard');
    expect(returnPath({})).toBe('/dashboard');
    expect(returnPath({ pathname: '/login' })).toBe('/dashboard');
    expect(returnPath({ pathname: '//evil.example' })).toBe('/dashboard');
    expect(returnPath({ pathname: 'https://evil.example' })).toBe('/dashboard');
  });
});

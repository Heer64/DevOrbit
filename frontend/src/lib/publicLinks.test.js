// [Sprint 5 · M2] US-46: where Discover cards and the workspace link lead.
import { describe, expect, it } from 'vitest';
import { publicProjectPath, workspacePath } from './publicLinks';

describe('publicProjectPath', () => {
  it('a real project (24-character ID) opens its public read-only page', () => {
    expect(publicProjectPath('0123456789abcdef01234567')).toBe('/discover/0123456789abcdef01234567');
    expect(publicProjectPath('0123456789ABCDEF01234567')).toBe('/discover/0123456789ABCDEF01234567');
  });

  it('demo sample projects keep opening the demo workspace page', () => {
    expect(publicProjectPath('orbit-dashboard')).toBe('/project/orbit-dashboard');
    expect(publicProjectPath('p9')).toBe('/project/p9');
  });

  it('odd input is encoded, never turned into another path', () => {
    expect(publicProjectPath('../admin')).toBe('/project/..%2Fadmin');
    expect(publicProjectPath(undefined)).toBe('/project/');
  });
});

describe('workspacePath', () => {
  it('points to the member workspace', () => {
    expect(workspacePath('0123456789abcdef01234567')).toBe('/project/0123456789abcdef01234567');
  });
});

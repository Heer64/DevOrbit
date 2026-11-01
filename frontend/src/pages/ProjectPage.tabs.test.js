// [Sprint 4 · M7] US-39: the Dashboard tab is reachable from the URL; Tasks stays the default.
import { describe, expect, it } from 'vitest';
import { PROJECT_TABS, tabFromParam } from './ProjectPage';

describe('project tabs', () => {
  it('includes the Dashboard tab first', () => {
    expect(PROJECT_TABS[0]).toBe('Dashboard');
    expect(PROJECT_TABS).toEqual(['Dashboard', 'Tasks', 'Chat', 'Milestones', 'Decisions', 'Files', 'Activity']);
  });

  // [Sprint 4 · M5] US-37
  it('?tab=files opens the Files tab', () => {
    expect(tabFromParam('files')).toBe('Files');
  });

  it('?tab=dashboard opens the dashboard (any letter case)', () => {
    expect(tabFromParam('dashboard')).toBe('Dashboard');
    expect(tabFromParam('DASHBOARD')).toBe('Dashboard');
  });

  it('keeps Tasks as the default for missing or unknown tabs', () => {
    expect(tabFromParam(null)).toBe('Tasks');
    expect(tabFromParam('')).toBe('Tasks');
    expect(tabFromParam('health')).toBe('Tasks');
  });
});

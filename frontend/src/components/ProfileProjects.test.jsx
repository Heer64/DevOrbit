// [Sprint 7 · M4] A user's projects on their profile: Public, plus Private when the viewer is a member too.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProfileProjects from './ProfileProjects';

const project = (overrides = {}) => ({
  _id: 'p1',
  name: 'Open Garden',
  description: 'Community gardening app',
  domain: 'Community',
  status: 'In progress',
  visibility: 'Public',
  tags: ['React'],
  color: 'mint',
  role: 'Owner',
  memberCount: 3,
  viewerIsMember: false,
  path: '/discover/p1',
  ...overrides,
});

function renderProjects(api, props = {}) {
  return render(
    <MemoryRouter>
      <ProfileProjects username="ann" name="Ann Author" api={api} {...props} />
    </MemoryRouter>
  );
}

describe('ProfileProjects (Sprint 7 · M4)', () => {
  it('lists the projects the server sends, each linking to its project page', async () => {
    const api = {
      projects: vi.fn(() =>
        Promise.resolve({
          projects: [
            project(),
            project({
              _id: 'p2',
              name: 'Shared Secret',
              visibility: 'Private',
              viewerIsMember: true,
              path: '/project/p2',
              role: 'Admin',
              memberCount: 1,
            }),
          ],
        })
      ),
    };
    renderProjects(api);
    const garden = await screen.findByRole('link', { name: 'Open Open Garden' });
    expect(garden.getAttribute('href')).toBe('/discover/p1');
    const secret = screen.getByRole('link', { name: 'Open Shared Secret' });
    expect(secret.getAttribute('href')).toBe('/project/p2');
    expect(api.projects).toHaveBeenCalledWith('ann');
    expect(screen.getByText('Owner · Community · 3 members')).toBeTruthy();
    expect(screen.getByText('Admin · Community · 1 member')).toBeTruthy();
    expect(secret.textContent).toContain('Private');
    expect(garden.textContent).toContain('Public');
  });

  it('says when there is nothing to show', async () => {
    renderProjects({ projects: vi.fn(() => Promise.resolve({ projects: [] })) });
    expect(await screen.findByText('No projects to show on Ann Author’s profile yet.')).toBeTruthy();
  });

  it('shows an error when projects cannot load', async () => {
    renderProjects({ projects: vi.fn(() => Promise.reject(new Error('Could not reach the server.'))) });
    expect((await screen.findByRole('alert')).textContent).toBe('Could not reach the server.');
  });

  it('renders nothing when the api has no projects call', () => {
    const { container } = renderProjects({ user: vi.fn() });
    expect(container.textContent).toBe('');
  });
});

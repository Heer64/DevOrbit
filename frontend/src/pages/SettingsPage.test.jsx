// [Sprint 7 · M5] Settings page: password, privacy switches (moved from My profile) and theme in one place.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '../context/ThemeContext';

const auth = vi.hoisted(() => ({
  user: { id: 'u1', name: 'Aarohi Mehta', email: 'aarohi@example.com', username: 'aarohi', isDemo: false, profileDiscoverable: true, portfolioPublic: true },
  updateUser: vi.fn(),
}));
const mocks = vi.hoisted(() => ({
  profileApi: { update: vi.fn() },
  settingsApi: { changePassword: vi.fn() },
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), ...mocks }));

import SettingsPage from './SettingsPage';

function renderPage() {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/profile" element={<p>my profile page</p>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
}

beforeEach(() => { vi.clearAllMocks(); });

describe('SettingsPage', () => {
  it('has the account, change password, privacy and appearance sections', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Account' }).textContent).toContain('aarohi@example.com');
    expect(screen.getByRole('region', { name: 'Change password' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Privacy settings' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy();
  });

  it('the privacy switches work here and save with the profile API', async () => {
    mocks.profileApi.update.mockResolvedValue({ user: { ...auth.user, portfolioPublic: false } });
    renderPage();
    fireEvent.click(screen.getByRole('switch', { name: 'Public portfolio' }));
    fireEvent.click(screen.getByRole('button', { name: /save privacy settings/i }));
    expect((await screen.findByText('Privacy settings saved.'))).toBeTruthy();
    expect(mocks.profileApi.update).toHaveBeenCalledWith({ profileDiscoverable: true, portfolioPublic: false });
    expect(auth.updateUser).toHaveBeenCalled();
  });

  it('changing the password goes through the settings API', async () => {
    mocks.settingsApi.changePassword.mockResolvedValue({ message: 'Your password has been changed. 1 other session was signed out.', signedOutSessions: 1 });
    renderPage();
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-password' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password-1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));
    expect(await screen.findByText('Your password has been changed. 1 other session was signed out.')).toBeTruthy();
    expect(mocks.settingsApi.changePassword).toHaveBeenCalledWith('old-password', 'new-password-1');
  });

  it('"Edit profile" goes to My profile', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /edit profile/i }));
    expect(screen.getByText('my profile page')).toBeTruthy();
  });
});

// [Sprint 5 · M3] US-07 Set privacy preferences.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PrivacySettings from './PrivacySettings';

const user = (overrides = {}) => ({ id: 'u1', name: 'Bob Skilltag', isDemo: false, profileDiscoverable: true, portfolioPublic: true, ...overrides });
const searchSwitch = () => screen.getByRole('switch', { name: 'Appear in collaborator search' });
const portfolioSwitch = () => screen.getByRole('switch', { name: 'Public portfolio' });
const saveButton = () => screen.getByRole('button', { name: /save privacy settings/i });

describe('PrivacySettings (US-07)', () => {
  it('shows both switches with the saved values', () => {
    render(<PrivacySettings user={user({ profileDiscoverable: false, portfolioPublic: true })} api={{ update: vi.fn() }} />);
    expect(searchSwitch().checked).toBe(false);
    expect(portfolioSwitch().checked).toBe(true);
    expect(screen.getByText(/You are not shown when people search on Discover/)).toBeTruthy();
  });

  it('accounts without saved values start with both on (the defaults)', () => {
    render(<PrivacySettings user={{ id: 'u1', name: 'New Person' }} api={{ update: vi.fn() }} />);
    expect(searchSwitch().checked).toBe(true);
    expect(portfolioSwitch().checked).toBe(true);
  });

  it('Save is only enabled after a change', () => {
    render(<PrivacySettings user={user()} api={{ update: vi.fn() }} />);
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(searchSwitch());
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(searchSwitch());
    expect(saveButton().disabled).toBe(true);
  });

  it('AC1: turning off "appear in collaborator search" saves profileDiscoverable = false', async () => {
    const saved = user({ profileDiscoverable: false });
    const api = { update: vi.fn(() => Promise.resolve({ user: saved })) };
    const onSaved = vi.fn();
    render(<PrivacySettings user={user()} api={api} onSaved={onSaved} />);
    fireEvent.click(searchSwitch());
    fireEvent.click(saveButton());
    expect((await screen.findByRole('status')).textContent).toBe('Privacy settings saved.');
    expect(api.update).toHaveBeenCalledWith({ profileDiscoverable: false, portfolioPublic: true });
    expect(onSaved).toHaveBeenCalledWith(saved);
  });

  it('AC2: turning off "public portfolio" saves portfolioPublic = false and explains the link', async () => {
    const api = { update: vi.fn(() => Promise.resolve({ user: user({ portfolioPublic: false }) })) };
    render(<PrivacySettings user={user()} api={api} onSaved={vi.fn()} />);
    fireEvent.click(portfolioSwitch());
    expect(screen.getByText(/sees "not available"/)).toBeTruthy();
    fireEvent.click(saveButton());
    await screen.findByRole('status');
    expect(api.update).toHaveBeenCalledWith({ profileDiscoverable: true, portfolioPublic: false });
  });

  it('a failed save shows the error and keeps the choice', async () => {
    const api = { update: vi.fn(() => Promise.reject(new Error('Privacy settings must be true or false.'))) };
    render(<PrivacySettings user={user()} api={api} onSaved={vi.fn()} />);
    fireEvent.click(portfolioSwitch());
    fireEvent.click(saveButton());
    expect((await screen.findByRole('alert')).textContent).toBe('Privacy settings must be true or false.');
    expect(portfolioSwitch().checked).toBe(false);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('demo users change the settings locally without calling the API', async () => {
    const api = { update: vi.fn() };
    const onSaved = vi.fn();
    const demo = user({ isDemo: true });
    render(<PrivacySettings user={demo} api={api} onSaved={onSaved} />);
    fireEvent.click(searchSwitch());
    fireEvent.click(saveButton());
    expect((await screen.findByRole('status')).textContent).toBe('Privacy settings saved.');
    expect(api.update).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith({ ...demo, profileDiscoverable: false, portfolioPublic: true });
  });

  it('follows the saved values when the user changes', () => {
    const { rerender } = render(<PrivacySettings user={user()} api={{ update: vi.fn() }} />);
    rerender(<PrivacySettings user={user({ profileDiscoverable: false, portfolioPublic: false })} api={{ update: vi.fn() }} />);
    expect(searchSwitch().checked).toBe(false);
    expect(portfolioSwitch().checked).toBe(false);
  });
});

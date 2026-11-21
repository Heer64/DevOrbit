import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, KeyRound, Lock, Palette, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Avatar, Heading, initialsOf } from '../components/ui';
import ChangePasswordForm from '../components/ChangePasswordForm';
import PrivacySettings from '../components/PrivacySettings'; // [Sprint 5 · M3] US-07, moved here from My profile
import ThemeSettings from '../components/ThemeSettings';

/*
 * [Sprint 7 · M5] Settings page (/settings), opened from the sidebar and the account menu.
 *   Account     who is signed in, with a link to edit the public profile
 *   Security    change password: old password required, every other session signed out (ChangePasswordForm)
 *   Privacy     "Appear in collaborator search" and "Public portfolio" (US-07), moved here from My profile
 *   Appearance  Dark / Light / System theme (ThemeSettings)
 */
const SECTIONS = [
  { id: 'settings-account', label: 'Account', icon: UserRound },
  { id: 'settings-security', label: 'Security', icon: KeyRound },
  { id: 'settings-privacy', label: 'Privacy', icon: Lock },
  { id: 'settings-appearance', label: 'Appearance', icon: Palette },
];

export default function SettingsPage() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const jump = (id) => document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });

  // /settings#settings-privacy (the link left on My profile) opens at that section.
  useEffect(() => {
    const id = hash ? decodeURIComponent(hash.slice(1)) : '';
    if (SECTIONS.some((section) => section.id === id)) jump(id);
  }, [hash]);

  return (
    <div className="settings-page">
      <Heading eyebrow="ACCOUNT" title="Settings" subtitle="Your password, privacy and how DevOrbit looks." />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button type="button" key={id} onClick={() => jump(id)}>
              <Icon size={15} aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>

        <div className="settings-sections">
          <section id="settings-account" className="panel settings-card settings-account" aria-label="Account">
            <Avatar initials={user?.avatar || initialsOf(user?.name)} src={user?.avatarSrc} />
            <div className="settings-account-text">
              <b>{user?.name || 'Demo user'}</b>
              <small>
                {user?.email || 'demo@devorbit.app'}
                {user?.username ? ` · @${user.username}` : ''}
              </small>
            </div>
            <button type="button" className="link" onClick={() => navigate('/profile')}>
              Edit profile <ArrowUpRight size={13} />
            </button>
          </section>

          <div id="settings-security">
            <ChangePasswordForm user={user} />
          </div>
          <div id="settings-privacy">
            <PrivacySettings user={user} onSaved={updateUser} />
          </div>
          <div id="settings-appearance">
            <ThemeSettings />
          </div>
        </div>
      </div>
    </div>
  );
}

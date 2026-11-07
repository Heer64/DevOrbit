import { useEffect, useState } from 'react';
import { Check, Lock } from 'lucide-react';
import { profileApi } from '../api';
import { Btn } from './ui';

/*
 * [Sprint 5 · M3] US-07 Set privacy preferences (FR-19, FR-21).
 * Two switches on the Profile page, saved with PATCH /api/profile/me:
 *   profileDiscoverable  "Appear in collaborator search": off = not returned by people search (AC1)
 *   portfolioPublic      "Public portfolio": off = the portfolio link shows "not available" (AC2)
 * Both default to on (User model). Saving shows a success or error message (NFR-26).
 */

const isOn = (value) => value !== false;

export default function PrivacySettings({ user, onSaved, api = profileApi }) {
  const [discoverable, setDiscoverable] = useState(isOn(user?.profileDiscoverable));
  const [portfolioPublic, setPortfolioPublic] = useState(isOn(user?.portfolioPublic));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // Follow the saved values when the user changes (another tab, or after saving).
  useEffect(() => {
    setDiscoverable(isOn(user?.profileDiscoverable));
    setPortfolioPublic(isOn(user?.portfolioPublic));
  }, [user?.id, user?.profileDiscoverable, user?.portfolioPublic]);

  const changed = discoverable !== isOn(user?.profileDiscoverable) || portfolioPublic !== isOn(user?.portfolioPublic);

  const save = async () => {
    setNotice(''); setError(''); setSaving(true);
    const payload = { profileDiscoverable: discoverable, portfolioPublic };
    try {
      if (user?.isDemo) onSaved?.({ ...user, ...payload });
      else { const result = await api.update(payload); onSaved?.(result.user); }
      setNotice('Privacy settings saved.');
    } catch (e) {
      setError(e?.message || 'Could not save your privacy settings.');
    } finally {
      setSaving(false);
    }
  };

  const pick = (setter) => (event) => { setter(event.target.checked); setNotice(''); setError(''); };

  return (
    <section className="panel privacy-settings" aria-label="Privacy settings">
      <div className="panel-head">
        <div><div className="eyebrow"><Lock size={12} /> PRIVACY</div><h2 style={{ marginTop: 6 }}>Privacy settings</h2><p>Decide how much of your information other people can discover.</p></div>
      </div>

      <label className="privacy-row">
        <span>
          <b>Appear in collaborator search</b>
          <small>{discoverable ? 'People can find you on Discover by your name or skill tags.' : 'You are not shown when people search on Discover. Your profile still opens from a direct link.'}</small>
        </span>
        <input type="checkbox" role="switch" checked={discoverable} disabled={saving} onChange={pick(setDiscoverable)} aria-label="Appear in collaborator search" />
      </label>

      <label className="privacy-row">
        <span>
          <b>Public portfolio</b>
          <small>{portfolioPublic ? 'Anyone with your portfolio link can view it, read-only.' : 'Anyone who opens your portfolio link sees "not available".'}</small>
        </span>
        <input type="checkbox" role="switch" checked={portfolioPublic} disabled={saving} onChange={pick(setPortfolioPublic)} aria-label="Public portfolio" />
      </label>

      {error && <div className="form-error" role="alert">{error}</div>}
      {notice && <p className="success-inline" role="status">{notice}</p>}
      <div className="privacy-footer">
        <Btn icon={Check} disabled={saving || !changed} onClick={save}>{saving ? 'Saving…' : 'Save privacy settings'}</Btn>
      </div>
    </section>
  );
}

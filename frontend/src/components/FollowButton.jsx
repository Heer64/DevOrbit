import { useState } from 'react';
import { UserCheck, UserPlus } from 'lucide-react';
import { profileApi } from '../api';

/*
 * [Sprint 5 · M8] US-54 Follow / Unfollow on another user's profile (FR-26, NFR-26).
 * Calls PUT / DELETE /api/profile/users/:username/follow (backend/src/routes/follows.js) and reports
 * the server's answer, so the follower count shown is always the real one, not a local guess.
 *
 * Props
 *   username, name     whose profile this is
 *   following          does the viewer follow them now (profile.isFollowing)
 *   onChange({ following, followerCount })   after a successful follow / unfollow
 *   api                profileApi (tests pass a fake)
 */
export default function FollowButton({ username, name, following, onChange, api = profileApi }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = following ? await api.unfollow(username) : await api.follow(username);
      onChange?.({ following: Boolean(result.following), followerCount: result.followerCount });
      setNotice(result.message || '');
    } catch (failure) {
      setError(failure?.message || `Could not ${following ? 'unfollow' : 'follow'} ${name || 'this user'}. Please try again.`);
    } finally {
      setBusy(false);
    }
  };

  const Icon = following ? UserCheck : UserPlus;
  let label = following ? 'Unfollow' : 'Follow';
  if (busy) label = following ? 'Unfollowing…' : 'Following…';

  return (
    <div className="follow-control">
      <button
        type="button"
        className={`btn ${following ? 'secondary' : ''} follow-button`}
        onClick={toggle}
        disabled={busy}
        aria-pressed={Boolean(following)}
        aria-label={`${following ? 'Unfollow' : 'Follow'} ${name || username}`}
      >
        <Icon size={13} aria-hidden="true" /> {label}
      </button>
      {notice && (
        <p className="tiny-note follow-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="form-error follow-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

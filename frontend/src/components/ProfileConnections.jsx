import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { assetUrl, profileApi } from '../api';
import { Avatar, initialsOf } from './ui';

/*
 * [Sprint 7 · M4] Followers / following lists, on your own profile and on other people's.
 * Two tabs with the real counts. Each person links to their profile (/people/:username).
 * Contract: GET /api/profile/users/:username/followers|following?page=  (backend/src/routes/profile.js)
 *   -> { people: [{ name, username, headline, avatarUrl }], total, page, pageSize, hasMore }
 *
 * Props
 *   username         whose lists these are
 *   name             their display name (for empty-state text)
 *   isMe             true on My profile ("You have no followers yet")
 *   followerCount, followingCount   numbers shown on the tabs before a list is loaded
 *   refreshKey       change it (e.g. after Follow / Unfollow) to load the open list again
 *   api              profileApi (tests pass a fake)
 */
export const CONNECTION_TABS = [
  { key: 'followers', label: 'Followers' },
  { key: 'following', label: 'Following' },
];

const empty = { loading: false, people: [], total: null, page: 0, hasMore: false, error: '' };

export default function ProfileConnections({
  username,
  name,
  isMe = false,
  followerCount = 0,
  followingCount = 0,
  refreshKey = 0,
  api = profileApi,
}) {
  const [tab, setTab] = useState('followers');
  const [list, setList] = useState(empty);
  const canLoad = typeof api?.followers === 'function' && typeof api?.following === 'function';
  const latest = useRef(0); // only the newest request may update the list (fast tab switches)

  const load = async (page, keep = []) => {
    const request = latest.current + 1;
    latest.current = request;
    setList((current) => ({ ...current, loading: true, error: '' }));
    try {
      const result = await api[tab](username, page);
      if (latest.current !== request) return;
      setList({
        loading: false,
        people: [...keep, ...(result.people || [])],
        total: Number.isFinite(result.total) ? result.total : null,
        page: result.page || page,
        hasMore: Boolean(result.hasMore),
        error: '',
      });
    } catch (error) {
      if (latest.current !== request) return;
      setList((current) => ({ ...current, loading: false, error: error?.message || 'Could not load this list.' }));
    }
  };

  useEffect(() => {
    if (!canLoad || !username) return;
    setList(empty);
    load(1);
  }, [tab, username, refreshKey, canLoad]);

  if (!canLoad || !username) return null;

  const countFor = (key) => {
    if (key === tab && list.total !== null) return list.total;
    return key === 'followers' ? followerCount : followingCount;
  };
  const who = isMe ? 'You' : name || `@${username}`;
  const emptyText =
    tab === 'followers'
      ? `${isMe ? 'You have' : `${who} has`} no followers yet.`
      : `${isMe ? 'You are' : `${who} is`} not following anyone yet.`;

  return (
    <section className="panel profile-connections" aria-label="Followers and following">
      <div className="panel-head">
        <div>
          <div className="eyebrow">CONNECTIONS</div>
          <h2 style={{ marginTop: 6 }}>Followers &amp; following</h2>
        </div>
      </div>
      <div className="feed-tabs connection-tabs" role="tablist" aria-label="Followers or following">
        {CONNECTION_TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={tab === item.key ? 'active' : ''}
            onClick={() => setTab(item.key)}
          >
            {item.label} <span className="pill">{countFor(item.key)}</span>
          </button>
        ))}
      </div>

      <div className="connection-list" role="tabpanel" aria-label={tab === 'followers' ? 'Followers' : 'Following'}>
        {list.people.map((person) => (
          <Link key={person.username} className="member-row connection-row" to={`/people/${encodeURIComponent(person.username)}`}>
            <Avatar initials={initialsOf(person.name)} src={assetUrl(person.avatarUrl)} small />
            <span className="who">
              <b>{person.name}</b>
              <small>
                @{person.username}
                {person.headline ? ` · ${person.headline}` : ''}
              </small>
            </span>
          </Link>
        ))}
        {list.loading && <p className="team-note">Loading…</p>}
        {!list.loading && !list.error && list.people.length === 0 && <p className="empty-inline">{emptyText}</p>}
        {list.error && (
          <div className="form-error" role="alert">
            {list.error}
          </div>
        )}
        {!list.loading && list.hasMore && (
          <button type="button" className="link connection-more" onClick={() => load(list.page + 1, list.people)}>
            Show more
          </button>
        )}
      </div>
    </section>
  );
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 7 · M4] What this file does
 * Shows a Followers tab and a Following tab with real counts for any profile. Each person
 * links to their profile; long lists load 20 more at a time with "Show more".
 * ---------------------------------------------------------------------------
 */

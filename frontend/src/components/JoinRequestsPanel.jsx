import { useCallback, useEffect, useState } from 'react';
import { Check, Inbox, X } from 'lucide-react';
import { Avatar, AVATAR_TONES, initialsOf } from './ui';
import { assetUrl, joinRequestApi } from '../api';
import { assignableRoles } from '../roles';
import { formatDay } from './JoinRequestCard';

// [Sprint 3 · M2] Join-request queue for a project's Owner and Admins (US-12).
// Approve (with the role chosen, Contributor by default) or reject each pending request.
// The API checks every action again: an Admin cannot hand out Admin, and only one decision wins.
export default function JoinRequestsPanel({ projectId, myRole, api = joinRequestApi, onApproved }) {
  const [requests, setRequests] = useState(null);
  const [roles, setRoles] = useState({}); // requestId -> chosen role
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    let active = true;
    setError('');
    api.list(projectId)
      .then((result) => { if (active) setRequests(result.joinRequests || []); })
      .catch((e) => { if (active) { setRequests([]); setError(e.message || 'Could not load join requests.'); } });
    return () => { active = false; };
  }, [projectId, api]);

  useEffect(() => {
    setRequests(null);
    return load();
  }, [load]);

  const roleChoices = assignableRoles(myRole);
  const defaultRole = roleChoices.includes('Contributor') ? 'Contributor' : roleChoices[0];
  const drop = (requestId) => setRequests((old) => (old || []).filter((item) => item._id !== requestId));

  const decide = async (item, action) => {
    const name = item.user?.name || 'This person';
    const role = roles[item._id] || defaultRole;
    setError(''); setNotice(''); setBusyId(item._id);
    try {
      if (action === 'approve') {
        await api.approve(projectId, item._id, role);
        setNotice(`${name} joined as ${role}.`);
        onApproved?.();
      } else {
        await api.reject(projectId, item._id);
        setNotice(`${name}'s request was rejected. They can ask again in 7 days.`);
      }
      drop(item._id);
    } catch (e) {
      setError(e.message || 'That did not work.');
      // Already decided by another Owner/Admin: it is no longer pending.
      if (e.status === 409 || e.status === 404) drop(item._id);
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="panel join-requests-panel">
      <div className="panel-head">
        <div><div className="eyebrow">PEOPLE</div><h2 className="with-icon" style={{ marginTop: 6 }}><Inbox size={17} /> Join requests</h2></div>
        {requests && requests.length > 0 && <span className="pill orange">{requests.length} pending</span>}
      </div>

      {requests === null && <p className="team-note">Loading requests…</p>}
      {requests && requests.length === 0 && !error && <p className="team-note">No pending requests.</p>}

      {(requests || []).map((item, index) => {
        const name = item.user?.name || 'Former user';
        const busy = busyId === item._id;
        return (
          <div className="join-request" key={item._id}>
            <div className="member-row">
              <Avatar initials={initialsOf(name)} src={assetUrl(item.user?.avatarUrl)} tone={AVATAR_TONES[index % 4]} small />
              <div className="who"><b>{name}</b><small>{item.user?.username ? `@${item.user.username} · ` : ''}asked {formatDay(item.createdAt)}</small></div>
            </div>
            {item.message && <p className="join-message">{item.message}</p>}
            <div className="join-actions">
              <select
                aria-label={`Role for ${name}`}
                value={roles[item._id] || defaultRole}
                disabled={busy}
                onChange={(e) => setRoles((old) => ({ ...old, [item._id]: e.target.value }))}
              >
                {roleChoices.map((role) => <option key={role}>{role}</option>)}
              </select>
              <button type="button" className="btn small" disabled={busy} onClick={() => decide(item, 'approve')} aria-label={`Approve ${name}`}><Check size={14} /> Approve</button>
              <button type="button" className="btn secondary small" disabled={busy} onClick={() => decide(item, 'reject')} aria-label={`Reject ${name}`}><X size={14} /> Reject</button>
            </div>
          </div>
        );
      })}

      {error && <div className="form-error" role="alert">{error}</div>}
      {notice && !error && <p className="success-inline" role="status">{notice}</p>}
    </section>
  );
}

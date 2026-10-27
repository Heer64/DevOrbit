import { useEffect, useState } from 'react';
import { Mail, Send } from 'lucide-react';
import { Avatar, AVATAR_TONES, Btn, initialsOf } from './ui';
import { assetUrl, invitationApi } from '../api';
import { assignableRoles } from '../roles';
import { formatDay, invitationBadge } from './invitationDisplay';

// [Sprint 3 · M1] Invite people to a project (US-10) and see what happened to each invitation (US-11).
// Shown to the project's Owner and Admins under Team & roles. The invited person has to accept before
// they become a member; a pending invitation expires after 7 days.
// The API checks every rule again (who may invite, which roles, no duplicates) and its message is shown.
export default function InvitationsPanel({ projectId, myRole, api = invitationApi }) {
  const [invitations, setInvitations] = useState(null);
  const [identifier, setIdentifier] = useState('');
  const roleChoices = assignableRoles(myRole);
  const defaultRole = roleChoices.includes('Contributor') ? 'Contributor' : roleChoices[0];
  const [role, setRole] = useState(defaultRole);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setInvitations(null);
    api.forProject(projectId)
      .then((result) => { if (active) setInvitations(result.invitations || []); })
      .catch((e) => { if (active) { setInvitations([]); setError(e.message || 'Could not load invitations.'); } });
    return () => { active = false; };
  }, [projectId, api]);

  const send = async (e) => {
    e.preventDefault();
    const value = identifier.trim();
    if (!value) return;
    setError(''); setNotice(''); setBusy(true);
    try {
      const { invitation } = await api.send(projectId, { identifier: value, role });
      setInvitations((old) => [invitation, ...(old || [])]);
      setNotice(`Invitation sent to ${invitation.invitee?.name || value}. It expires on ${formatDay(invitation.expiresAt)}.`);
      setIdentifier('');
    } catch (err) {
      setError(err.message || 'Could not send the invitation.');
    } finally {
      setBusy(false);
    }
  };

  const pendingCount = (invitations || []).filter((item) => item.status === 'Pending').length;

  return (
    <section className="panel invitations-panel">
      <div className="panel-head">
        <div><div className="eyebrow">PEOPLE</div><h2 className="with-icon" style={{ marginTop: 6 }}><Mail size={17} /> Invitations</h2></div>
        {pendingCount > 0 && <span className="pill orange">{pendingCount} pending</span>}
      </div>
      <p className="team-note">Invite someone who already has a DevOrbit account. They join once they accept. Invitations expire after 7 days.</p>

      <form className="add-member invite-form" onSubmit={send}>
        <div className="row">
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="Email or username" aria-label="Email or username to invite" maxLength={254} disabled={busy} />
          <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role for the invited person" disabled={busy}>
            {roleChoices.map((choice) => <option key={choice}>{choice}</option>)}
          </select>
        </div>
        <Btn type="submit" icon={Send} disabled={busy || !identifier.trim()}>{busy ? 'Sending…' : 'Send invite'}</Btn>
      </form>
      {error && <div className="form-error" role="alert">{error}</div>}
      {notice && !error && <p className="success-inline" role="status">{notice}</p>}

      {invitations === null && <p className="team-note invite-loading">Loading invitations…</p>}
      {invitations && invitations.length > 0 && (
        <div className="invite-list" aria-label="Sent invitations">
          {invitations.map((item, index) => {
            const name = item.invitee?.name || 'Former user';
            const badge = invitationBadge(item);
            const when = item.respondedAt ? `${item.status.toLowerCase()} ${formatDay(item.respondedAt)}` : `sent ${formatDay(item.createdAt)}`;
            return (
              <div className="member-row" key={item._id}>
                <Avatar initials={initialsOf(name)} src={assetUrl(item.invitee?.avatarUrl)} tone={AVATAR_TONES[index % 4]} small />
                <div className="who">
                  <b>{name}</b>
                  <small>{item.role} · {when}{item.invitedBy?.name ? ` · by ${item.invitedBy.name}` : ''}</small>
                </div>
                <span className={`pill ${badge.tone}`}>{badge.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

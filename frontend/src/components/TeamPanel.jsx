import { useCallback, useEffect, useState } from 'react';
import { LogOut, ShieldCheck, UserPlus, X } from 'lucide-react';
import { Avatar, AVATAR_TONES, Btn, initialsOf } from './ui';
import { projectApi, assetUrl } from '../api';
import { ROLE_HELP, assignableRoles, canActOnMember, canManageMembers } from '../roles';
import ConfirmDialog from './ConfirmDialog'; // [Sprint 3 · M3] US-13, US-14

// Team & roles for one project. Buttons are hidden when the role cannot use them,
// but the API checks every request again and answers 403 if the rules are broken.
// [Sprint 3 · M3] Removing a member and leaving the project both ask for confirmation first (US-13, US-14).
// projectName is optional and only used in the confirmation text.
export default function TeamPanel({ projectId, projectName = '', myRole, currentUserId, onMembers, onLeft }) {
  const [members, setMembers] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [newRole, setNewRole] = useState('Contributor');
  // [Sprint 3 · M3] Open confirmation: { kind: 'remove', member } | { kind: 'leave' } | { kind: 'owner-leave' } | null
  const [confirm, setConfirm] = useState(null);
  const [confirmError, setConfirmError] = useState('');

  const apply = useCallback((list) => { setMembers(list); onMembers?.(list); }, [onMembers]);

  useEffect(() => {
    let active = true;
    setMembers(null); setError('');
    projectApi.members(projectId)
      .then((result) => { if (active) apply(result.members || []); })
      .catch((e) => { if (active) setError(e.message || 'Could not load the team.'); });
    return () => { active = false; };
  }, [projectId, apply]);

  const run = async (action, success) => {
    setError(''); setNotice(''); setBusy(true);
    try { const result = await action(); apply(result.members || []); if (success) setNotice(success); return true; }
    catch (e) { setError(e.message || 'That did not work.'); return false; }
    finally { setBusy(false); }
  };

  const changeRole = (member, role) => run(() => projectApi.setMemberRole(projectId, member.userId, role), `${member.name} is now ${role}.`);
  const add = async (e) => {
    e.preventDefault();
    if (!identifier.trim()) return;
    const ok = await run(() => projectApi.addMember(projectId, { identifier: identifier.trim(), role: newRole }), 'Member added.');
    if (ok) setIdentifier('');
  };

  const openConfirm = (next) => { setConfirmError(''); setError(''); setNotice(''); setConfirm(next); };
  const closeConfirm = () => { if (!busy) { setConfirm(null); setConfirmError(''); } };

  // US-13: remove after confirming. History (messages, tasks, activity) stays on the server.
  const confirmRemove = async () => {
    const { member } = confirm;
    setConfirmError(''); setBusy(true);
    try {
      const result = await projectApi.removeMember(projectId, member.userId);
      apply(result.members || []);
      setNotice(`${member.name} was removed from the project.`);
      setConfirm(null);
    } catch (e) {
      setConfirmError(e.message || 'Could not remove this member.');
    } finally {
      setBusy(false);
    }
  };

  // US-14: leave after confirming.
  const confirmLeave = async () => {
    setConfirmError(''); setBusy(true);
    try {
      await projectApi.removeMember(projectId, currentUserId);
      setConfirm(null);
      window.dispatchEvent(new Event('devorbit:projects-updated'));
      onLeft?.();
    } catch (e) {
      setConfirmError(e.message || 'Could not leave the project.');
    } finally {
      setBusy(false);
    }
  };

  const manage = canManageMembers(myRole);
  const roleChoices = assignableRoles(myRole);
  const projectLabel = projectName ? `“${projectName}”` : 'this project';

  return (
    <section className="panel team-panel">
      <div className="panel-head">
        <div><div className="eyebrow">PEOPLE</div><h2 className="with-icon" style={{ marginTop: 6 }}><ShieldCheck size={17} /> Team &amp; roles</h2></div>
        <span className="pill purple">You: {myRole}</span>
      </div>
      <p className="team-note">{ROLE_HELP[myRole]}{!manage && ' Only Owners and Admins can change roles.'}</p>

      {members === null && !error && <p className="team-note">Loading team…</p>}
      {(members || []).map((member, index) => {
        const isMe = member.userId === currentUserId;
        const editable = manage && !isMe && canActOnMember(myRole, member.role);
        return (
          <div className="member-row" key={member.userId}>
            <Avatar initials={initialsOf(member.name)} src={assetUrl(member.avatarUrl)} tone={AVATAR_TONES[index % 4]} small />
            <div className="who"><b>{member.name}{isMe ? ' (you)' : ''}</b><small>{member.username ? `@${member.username}` : 'DevOrbit member'}</small></div>
            {editable ? (
              <>
                <select aria-label={`Role for ${member.name}`} value={member.role} disabled={busy} onChange={(e) => changeRole(member, e.target.value)}>
                  {roleChoices.map((role) => <option key={role}>{role}</option>)}
                </select>
                <button className="iconbtn" disabled={busy} aria-label={`Remove ${member.name}`} title="Remove from project" onClick={() => openConfirm({ kind: 'remove', member })}><X size={14} /></button>
              </>
            ) : (
              <>
                <span className={`pill ${member.role === 'Owner' ? 'purple' : ''}`}>{member.role}</span>
                {isMe && (
                  <button
                    className="iconbtn"
                    disabled={busy}
                    aria-label="Leave project"
                    title="Leave project"
                    onClick={() => openConfirm({ kind: member.role === 'Owner' ? 'owner-leave' : 'leave' })}
                  >
                    <LogOut size={14} />
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}

      {manage && (
        <form className="add-member" onSubmit={add}>
          <div className="row">
            <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="Email or username" aria-label="Email or username to add" maxLength={254} />
            <select value={newRole} onChange={(e) => setNewRole(e.target.value)} aria-label="Role for new member">
              {roleChoices.map((role) => <option key={role}>{role}</option>)}
            </select>
          </div>
          <Btn type="submit" icon={UserPlus} disabled={busy || !identifier.trim()}>Add to project</Btn>
        </form>
      )}
      {error && <div className="form-error" role="alert">{error}</div>}
      {notice && !error && <p className="success-inline" role="status">{notice}</p>}

      {/* [Sprint 3 · M3] Confirmations (US-13, US-14) */}
      <ConfirmDialog
        open={confirm?.kind === 'remove'}
        title={`Remove ${confirm?.member?.name || 'this member'}?`}
        confirmLabel="Remove member"
        danger
        busy={busy}
        error={confirmError}
        onConfirm={confirmRemove}
        onCancel={closeConfirm}
      >
        <p>They will lose access to {projectLabel} straight away: chat, activity and editing tasks.</p>
        <p>Their past messages, tasks and activity stay in the project. You can add them again later.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm?.kind === 'leave'}
        title="Leave this project?"
        confirmLabel="Leave project"
        danger
        busy={busy}
        error={confirmError}
        onConfirm={confirmLeave}
        onCancel={closeConfirm}
      >
        <p>You will lose access to {projectLabel} straight away: its chat, activity and editing tasks. If it is private, you will no longer be able to open it.</p>
        <p>Your messages and tasks stay in the project. To come back, an Owner or Admin has to add you again.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm?.kind === 'owner-leave'}
        title="Transfer ownership first"
        confirmLabel="OK"
        hideCancel
        onConfirm={closeConfirm}
        onCancel={closeConfirm}
      >
        <p>You are the only Owner of {projectLabel}. Every project needs an Owner, so make another member the Owner before you leave.</p>
      </ConfirmDialog>
    </section>
  );
}

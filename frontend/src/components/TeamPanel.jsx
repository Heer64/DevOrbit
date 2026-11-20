import { useCallback, useEffect, useState } from 'react';
import { Crown, LogOut, ShieldCheck, X } from 'lucide-react';
import { Avatar, AVATAR_TONES, initialsOf } from './ui';
import { projectApi, assetUrl } from '../api';
import { ROLE_HELP, assignableRoles, canActOnMember, canManageMembers, canTransferOwnership } from '../roles';
import ConfirmDialog from './ConfirmDialog'; // [Sprint 3 · M3] US-13, US-14

// Team & roles for one project. Buttons are hidden when the role cannot use them,
// but the API checks every request again and answers 403 if the rules are broken.
// [Sprint 3 · M3] Removing a member and leaving the project both ask for confirmation first (US-13, US-14).
// projectName is optional and only used in the confirmation text.
// [Sprint 7 · M7] The Owner can make another member the Owner (crown button, after confirming); the Owner
// then becomes an Admin and onRoleChange('Admin') tells the page. After that, leaving works like for any Admin.
// [Sprint 3 · M1] New people now join through an invitation they accept (US-10, US-11, see InvitationsPanel),
// so the old "Add to project" form is gone from here. The API's POST /members (US-09) is unchanged.
export default function TeamPanel({ projectId, projectName = '', myRole, currentUserId, onMembers, onLeft, onRoleChange }) {
  const [members, setMembers] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  // [Sprint 3 · M3] Open confirmation: { kind: 'remove', member } | { kind: 'leave' } | { kind: 'owner-leave' }
  // | [Sprint 7 · M7] { kind: 'transfer', member } | null
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

  // [Sprint 7 · M7] Make another member the Owner after confirming. I become an Admin.
  const confirmTransfer = async () => {
    const { member } = confirm;
    setConfirmError(''); setBusy(true);
    try {
      const result = await projectApi.transferOwnership(projectId, member.userId);
      apply(result.members || []);
      setConfirm(null);
      setNotice(`${member.name} is now the Owner. You are now an Admin.`);
      onRoleChange?.(result.membershipRole || 'Admin');
      window.dispatchEvent(new Event('devorbit:projects-updated'));
    } catch (e) {
      setConfirmError(e.message || 'Could not transfer ownership.');
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
  const canTransfer = canTransferOwnership(myRole);
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
                {canTransfer && (
                  <button className="iconbtn" disabled={busy} aria-label={`Make ${member.name} the Owner`} title="Transfer ownership" onClick={() => openConfirm({ kind: 'transfer', member })}><Crown size={14} /></button>
                )}
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

      {/* [Sprint 7 · M7] Transfer ownership */}
      <ConfirmDialog
        open={confirm?.kind === 'transfer'}
        title={`Make ${confirm?.member?.name || 'this member'} the Owner?`}
        confirmLabel="Transfer ownership"
        danger
        busy={busy}
        error={confirmError}
        onConfirm={confirmTransfer}
        onCancel={closeConfirm}
      >
        <p>{confirm?.member?.name || 'They'} will become the Owner of {projectLabel}, with full control over its members and settings.</p>
        <p>You will become an Admin. You cannot undo this yourself: only the new Owner can make you the Owner again.</p>
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
        <p>{(members || []).some((member) => member.userId !== currentUserId)
          ? 'Use the crown button next to a member to transfer ownership. You become an Admin and can then leave.'
          : 'Add or invite another member first, then use the crown button next to them to transfer ownership.'}</p>
      </ConfirmDialog>
    </section>
  );
}

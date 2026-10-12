import { useCallback, useEffect, useState } from 'react';
import { LogOut, ShieldCheck, UserPlus, X } from 'lucide-react';
import { Avatar, AVATAR_TONES, Btn, initialsOf } from './ui';
import { projectApi, assetUrl } from '../api';
import { ROLE_HELP, assignableRoles, canActOnMember, canManageMembers } from '../roles';

// Team & roles for one project. Buttons are hidden when the role cannot use them,
// but the API checks every request again and answers 403 if the rules are broken.
export default function TeamPanel({ projectId, myRole, currentUserId, onMembers, onLeft }) {
  const [members, setMembers] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [newRole, setNewRole] = useState('Contributor');

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
  const remove = (member) => run(() => projectApi.removeMember(projectId, member.userId), `${member.name} was removed.`);
  const add = async (e) => {
    e.preventDefault();
    if (!identifier.trim()) return;
    const ok = await run(() => projectApi.addMember(projectId, { identifier: identifier.trim(), role: newRole }), 'Member added.');
    if (ok) setIdentifier('');
  };
  const leave = async () => {
    if (!window.confirm('Leave this project? You will lose access if it is private.')) return;
    setError(''); setBusy(true);
    try { await projectApi.removeMember(projectId, currentUserId); window.dispatchEvent(new Event('devorbit:projects-updated')); onLeft?.(); }
    catch (e) { setError(e.message || 'Could not leave the project.'); }
    finally { setBusy(false); }
  };

  const manage = canManageMembers(myRole);
  const roleChoices = assignableRoles(myRole);

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
                <button className="iconbtn" disabled={busy} aria-label={`Remove ${member.name}`} title="Remove from project" onClick={() => remove(member)}><X size={14} /></button>
              </>
            ) : (
              <>
                <span className={`pill ${member.role === 'Owner' ? 'purple' : ''}`}>{member.role}</span>
                {isMe && member.role !== 'Owner' && <button className="iconbtn" disabled={busy} aria-label="Leave project" title="Leave project" onClick={leave}><LogOut size={14} /></button>}
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
    </section>
  );
}

import { useEffect, useState } from 'react';
import { ArrowRight, Check, Mail, X } from 'lucide-react';
import { invitationApi } from '../api';
import { tone } from './ui';
import { daysLeft, formatDay } from './invitationDisplay';

// [Sprint 3 · M1] "Your invitations" on the dashboard (US-10, US-11).
// Lists my pending project invitations with Accept and Decline. Accepting makes me a member with the
// invited role (the project list reloads); declining leaves me out and the inviter sees it was declined.
// Nothing is shown when there are no pending invitations, or for the demo account.
export default function MyInvitations({ user, api = invitationApi, onOpenProject }) {
  const [invitations, setInvitations] = useState([]);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [joined, setJoined] = useState(null); // { _id, name, role } after an accept
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!user || user.isDemo) return undefined;
    let active = true;
    const load = () => api.mine()
      .then((result) => { if (active) setInvitations(result.invitations || []); })
      .catch(() => { /* The dashboard still works without this panel. */ });
    load();
    // Joining or leaving a project elsewhere may change what is still pending.
    window.addEventListener('devorbit:projects-updated', load);
    return () => { active = false; window.removeEventListener('devorbit:projects-updated', load); };
  }, [user, api]);

  if (!user || user.isDemo) return null;
  if (!invitations.length && !joined && !notice && !error) return null;

  const drop = (id) => setInvitations((old) => old.filter((item) => item._id !== id));

  const answer = async (item, action) => {
    const projectName = item.project?.name || 'the project';
    setError(''); setNotice(''); setJoined(null); setBusyId(item._id);
    try {
      if (action === 'accept') {
        const result = await api.accept(item._id);
        drop(item._id);
        setJoined({ _id: String(result.project?._id || item.project?._id || ''), name: result.project?.name || projectName, role: item.role, wasMember: result.joined === false });
        window.dispatchEvent(new Event('devorbit:projects-updated'));
      } else {
        await api.decline(item._id);
        drop(item._id);
        setNotice(`You declined the invitation to ${projectName}.`);
      }
    } catch (e) {
      setError(e.message || 'That did not work.');
      // Expired, or already answered in another tab: it is no longer pending.
      if (e.status === 409 || e.status === 404) drop(item._id);
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="panel invite-inbox" aria-label="Your invitations">
      <div className="panel-head">
        <div><h2 className="with-icon"><Mail size={16} /> Your invitations</h2><p>Projects you have been invited to join.</p></div>
        {invitations.length > 0 && <span className="pill orange">{invitations.length} pending</span>}
      </div>

      {invitations.map((item) => {
        const project = item.project || {};
        const busy = busyId === item._id;
        const left = daysLeft(item.expiresAt);
        return (
          <div className="invite-item" key={item._id}>
            <span className={`project-avatar ${tone(project.color)}`}>{(project.name || 'P')[0].toUpperCase()}</span>
            <div className="invite-copy">
              <b>{project.name || 'A project'}</b>
              <p>{item.invitedBy?.name || 'Someone'} invited you to join as <strong>{item.role}</strong>.</p>
              <small>Expires {formatDay(item.expiresAt)}{left <= 1 ? ' · last day' : ` · ${left} days left`}</small>
            </div>
            <div className="invite-buttons">
              <button type="button" className="btn small" disabled={busy} onClick={() => answer(item, 'accept')} aria-label={`Accept invitation to ${project.name || 'project'}`}><Check size={14} /> Accept</button>
              <button type="button" className="btn secondary small" disabled={busy} onClick={() => answer(item, 'decline')} aria-label={`Decline invitation to ${project.name || 'project'}`}><X size={14} /> Decline</button>
            </div>
          </div>
        );
      })}

      {joined && (
        <div className="success-inline invite-joined" role="status">
          <span>{joined.wasMember ? `You were already a member of ${joined.name}.` : `You joined ${joined.name} as ${joined.role}.`}</span>
          {joined._id && onOpenProject && (
            <button type="button" className="link" onClick={() => onOpenProject(joined._id)}>Open project <ArrowRight size={13} /></button>
          )}
        </div>
      )}
      {notice && <p className="success-inline" role="status">{notice}</p>}
      {error && <div className="form-error" role="alert">{error}</div>}
    </section>
  );
}

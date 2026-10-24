import { useEffect, useState } from 'react';
import { Clock3, UserPlus } from 'lucide-react';
import { Btn } from './ui';
import { joinRequestApi } from '../api';

// [Sprint 3 · M2] "Request to join" for a signed-in visitor of a Public project (US-47).
// Shows the request form, the pending request, or when a rejected person may ask again (US-12: 7 days).
export const JOIN_MESSAGE_MAX = 500;

export function formatDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// 'pending' | 'blocked' | 'form', from the GET /me answer.
export function joinState({ joinRequest, canRequestAgainAt } = {}, now = Date.now()) {
  if (joinRequest?.status === 'Pending') return 'pending';
  if (canRequestAgainAt && new Date(canRequestAgainAt).getTime() > now) return 'blocked';
  return 'form';
}

export default function JoinRequestCard({ projectId, api = joinRequestApi }) {
  const [status, setStatus] = useState(null); // GET /me answer
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setStatus(null); setLoadError(''); setError('');
    api.mine(projectId)
      .then((result) => { if (active) setStatus(result); })
      .catch((e) => { if (active) setLoadError(e.message || 'Could not load your join request.'); });
    return () => { active = false; };
  }, [projectId, api]);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const result = await api.create(projectId, message.trim());
      setStatus({ joinRequest: result.joinRequest, canRequestAgainAt: null, isMember: false });
      setMessage('');
    } catch (err) {
      const data = err.response?.data || {};
      if (err.status === 409 && data.canRequestAgainAt) {
        setStatus((old) => ({ ...(old || {}), canRequestAgainAt: data.canRequestAgainAt }));
      } else if (err.status === 409 && /pending/i.test(data.message || '')) {
        // Sent from another tab: reload to show it.
        api.mine(projectId).then(setStatus).catch(() => {});
      }
      setError(err.message || 'Could not send your request.');
    } finally {
      setBusy(false);
    }
  };

  if (status?.isMember) return null;
  const state = status ? joinState(status) : null;

  return (
    <section className="panel join-card" aria-label="Join this project">
      <div className="panel-head">
        <div><div className="eyebrow">JOIN</div><h2 className="with-icon" style={{ marginTop: 6 }}><UserPlus size={17} /> Request to join</h2></div>
        {state === 'pending' && <span className="pill orange">Pending</span>}
      </div>

      {!status && !loadError && <p className="team-note">Loading…</p>}
      {loadError && <div className="form-error" role="alert">{loadError}</div>}

      {state === 'pending' && (
        <div className="join-status" role="status">
          <Clock3 size={15} />
          <p>
            Request sent on {formatDay(status.joinRequest.createdAt)}. The project Owner or an Admin will review it.
            {status.joinRequest.message && <><br /><q>{status.joinRequest.message}</q></>}
          </p>
        </div>
      )}

      {state === 'blocked' && (
        <div className="join-status" role="status">
          <Clock3 size={15} />
          <p>Your last request was not approved. You can ask again on {formatDay(status.canRequestAgainAt)}.</p>
        </div>
      )}

      {state === 'form' && (
        <form className="join-form" onSubmit={submit}>
          <p className="team-note">Want to help build this? Tell the team a little about yourself (optional).</p>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={JOIN_MESSAGE_MAX}
            rows={3}
            placeholder="e.g. I know React and would love to help with the UI."
            aria-label="Message to the project team"
          />
          <small className="join-count">{message.length}/{JOIN_MESSAGE_MAX}</small>
          <Btn type="submit" icon={UserPlus} disabled={busy}>{busy ? 'Sending…' : 'Request to join'}</Btn>
        </form>
      )}

      {error && state !== 'blocked' && <div className="form-error" role="alert">{error}</div>}
    </section>
  );
}

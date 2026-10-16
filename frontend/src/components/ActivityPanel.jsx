import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { activityApi } from '../api';
import { Btn } from './ui';
import { activityLook, activitySentence, timeAgo } from './activityDisplay';

// The project's Activity tab: who did what, newest first. Members only (the API answers 403 otherwise).
// Pass a changing `refreshKey` (for example a counter bumped after a task edit) to reload it.
export default function ActivityPanel({ projectId, refreshKey = 0 }) {
  const [events, setEvents] = useState(null);
  const [nextBefore, setNextBefore] = useState(null);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await activityApi.project(projectId);
      setEvents(result.activity || []);
      setNextBefore(result.nextBefore || null);
    } catch (e) {
      setEvents([]);
      setError(e.message || 'Could not load activity.');
    }
  }, [projectId]);

  useEffect(() => {
    setEvents(null);
    load();
  }, [load, refreshKey]);

  const loadOlder = async () => {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const result = await activityApi.project(projectId, { before: nextBefore });
      setEvents((old) => [...(old || []), ...(result.activity || [])]);
      setNextBefore(result.nextBefore || null);
    } catch (e) {
      setError(e.message || 'Could not load older activity.');
    } finally {
      setLoadingMore(false);
    }
  };

  if (events === null) return <div className="task-empty"><Activity size={20} /><p>Loading activity…</p></div>;

  return (
    <div>
      {error && (
        <div className="form-error" role="alert" style={{ margin: '10px 0' }}>
          {error} <button className="link" onClick={load}><RefreshCw size={12} /> Try again</button>
        </div>
      )}
      {!error && events.length === 0 && (
        <div className="task-empty"><Activity size={20} /><p>No activity yet. Create a task or add a teammate and it will show up here.</p></div>
      )}
      {events.map((event) => {
        const look = activityLook(event);
        const Icon = look.icon;
        return (
          <div className="event" key={event._id}>
            <span className={`event-icon ${look.tone}`}><Icon size={15} /></span>
            <div>
              <b>{look.title}</b>
              <p>{activitySentence(event)}</p>
              <small title={new Date(event.createdAt).toLocaleString()}>{timeAgo(event.createdAt)}</small>
            </div>
          </div>
        );
      })}
      {nextBefore && (
        <Btn secondary className="small" onClick={loadOlder} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Show older activity'}
        </Btn>
      )}
    </div>
  );
}

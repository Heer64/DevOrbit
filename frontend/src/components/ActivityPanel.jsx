import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { activityApi, liveApi } from '../api';
import { Btn } from './ui';
import { ACTIVITY_TYPE_KEYS, activityLook, activitySentence, timeAgo } from './activityDisplay';

// Merge events without duplicates and keep newest-first ordering.
function mergeEvents(...groups) {
  const unique = new Map();

  for (const group of groups) {
    for (const event of group || []) {
      if (event?._id) {
        unique.set(String(event._id), event);
      }
    }
  }

  return [...unique.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export default function ActivityPanel({ projectId, refreshKey = 0 }) {
  const [events, setEvents] = useState(null);
  const [nextBefore, setNextBefore] = useState(null);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');

  // Keep live events received while the initial API request is in flight.
  const liveEventsRef = useRef([]);

  const load = useCallback(async () => {
    setError('');

    try {
      const result = await activityApi.project(projectId);

      setEvents((current) =>
        mergeEvents(
          result.activity || [],
          liveEventsRef.current,
          current || []
        )
      );

      setNextBefore(result.nextBefore || null);
    } catch (e) {
      setError(e.message || 'Could not load activity.');

      // Preserve events already received through Socket.IO.
      setEvents((current) => current ?? mergeEvents(liveEventsRef.current));
    }
  }, [projectId]);

  // Reset the filter only when switching projects, not on every refresh.
  useEffect(() => {
    setTypeFilter('all');
  }, [projectId]);

  useEffect(() => {
    let active = true;

    liveEventsRef.current = [];
    setEvents(null);
    setNextBefore(null);
    setError('');

    // Subscribe before loading, so events are not missed during the request.
    const stop = liveApi.onProject(
      projectId,
      'activity:created',
      (payload) => {
        if (!active || !payload?.activity?._id) return;

        const incoming = payload.activity;

        liveEventsRef.current = mergeEvents(
          [incoming],
          liveEventsRef.current
        );

        setEvents((current) =>
          mergeEvents([incoming], current || [])
        );
      }
    );

    load();

    return () => {
      active = false;
      stop();
    };
  }, [projectId, refreshKey, load]);

  const loadOlder = async () => {
    if (!nextBefore || loadingMore) return;

    setLoadingMore(true);

    try {
      const result = await activityApi.project(projectId, {
        before: nextBefore,
      });

      setEvents((current) =>
        mergeEvents(current || [], result.activity || [])
      );

      setNextBefore(result.nextBefore || null);
      setError('');
    } catch (e) {
      setError(e.message || 'Could not load older activity.');
    } finally {
      setLoadingMore(false);
    }
  };

  const visibleEvents =
    typeFilter === 'all'
      ? events || []
      : (events || []).filter((event) => event.type === typeFilter);

  if (events === null) {
    return (
      <div className="task-empty">
        <Activity size={20} />
        <p>Loading activity…</p>
      </div>
    );
  }

  return (
    <div>
      {events.length > 0 && (
        <div className="activity-filter">
          <label htmlFor="activity-type-filter">Filter by type</label>
          <select
            id="activity-type-filter"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
          >
            <option value="all">All activity</option>
            {ACTIVITY_TYPE_KEYS.map((type) => (
              <option key={type} value={type}>
                {activityLook({ type }).title}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <div
          className="form-error"
          role="alert"
          style={{ margin: '10px 0' }}
        >
          {error}{' '}
          <button className="link" onClick={load}>
            <RefreshCw size={12} /> Try again
          </button>
        </div>
      )}

      {!error && events.length === 0 && (
        <div className="task-empty">
          <Activity size={20} />
          <p>
            No activity yet. Create a task or add a teammate and it will show
            up here.
          </p>
        </div>
      )}

      {events.length > 0 && visibleEvents.length === 0 && (
        <p>No loaded activity matches this filter.</p>
      )}

      {visibleEvents.map((event) => {
        const look = activityLook(event);
        const Icon = look.icon;

        return (
          <div className="event" key={event._id}>
            <span className={`event-icon ${look.tone}`}>
              <Icon size={15} />
            </span>

            <div>
              <b>{look.title}</b>
              <p>{activitySentence(event)}</p>
              <small title={new Date(event.createdAt).toLocaleString()}>
                {timeAgo(event.createdAt)}
              </small>
            </div>
          </div>
        );
      })}

      {nextBefore && (
        <Btn
          secondary
          className="small"
          onClick={loadOlder}
          disabled={loadingMore}
        >
          {loadingMore ? 'Loading…' : 'Show older activity'}
        </Btn>
      )}
    </div>
  );
}
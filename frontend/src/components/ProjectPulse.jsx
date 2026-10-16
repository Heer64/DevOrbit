import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, MoreHorizontal } from 'lucide-react';
import { activityApi } from '../api';
import { activityLook, activitySentence, timeAgo } from './activityDisplay';

// Dashboard "Project pulse": the latest events across all of the user's projects (GET /api/activity/me).
// Demo users keep the sample feed passed in as demoActivities.
export default function ProjectPulse({ user, demoActivities = [], fallbackProjectId }) {
  const navigate = useNavigate();
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!user || user.isDemo) return () => { active = false; };
    setEvents(null); setError('');
    const load = () => activityApi.mine(5)
      .then((result) => { if (active) { setEvents(result.activity || []); setError(''); } })
      .catch((e) => { if (active) { setEvents([]); setError(e.message || 'Could not load recent activity.'); } });
    load();
    // Creating a project from the sidebar fires this event; it also creates a "project created" entry.
    window.addEventListener('devorbit:projects-updated', load);
    return () => { active = false; window.removeEventListener('devorbit:projects-updated', load); };
  }, [user]);

  const latestProjectId = events?.[0]?.project?._id || fallbackProjectId;

  return (
    <section className="panel">
      <div className="panel-head"><div><h2>Project pulse</h2><p>The latest from your workspace.</p></div><MoreHorizontal size={18} /></div>

      {user?.isDemo && demoActivities.map((a, i) => (
        <div className="event" key={a.title + i}>
          <span className={`event-icon ${a.color}`}><a.icon size={16} /></span>
          <div><b>{a.title}</b><p>{a.detail}</p><small>{a.project} · {a.time}</small></div>
        </div>
      ))}

      {!user?.isDemo && events === null && <p className="preview-note">Loading recent activity…</p>}
      {!user?.isDemo && error && <div className="form-error" role="alert">{error}</div>}
      {!user?.isDemo && events?.length === 0 && !error && (
        <div className="task-empty"><Activity size={20} /><p>Nothing yet. Activity from your projects will appear here.</p></div>
      )}
      {!user?.isDemo && events?.map((event) => {
        const look = activityLook(event);
        const Icon = look.icon;
        return (
          <button
            type="button"
            className="event"
            key={event._id}
            onClick={() => event.project?._id && navigate(`/project/${event.project._id}`)}
            style={{ width: '100%', border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}
          >
            <span className={`event-icon ${look.tone}`}><Icon size={16} /></span>
            <div><b>{look.title}</b><p>{activitySentence(event)}</p><small>{event.project?.name || 'Project'} · {timeAgo(event.createdAt)}</small></div>
          </button>
        );
      })}

      <button className="link" onClick={() => navigate(`/project/${latestProjectId}`)}>Open project activity <ArrowRight size={14} /></button>
    </section>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, Ban, CalendarX, HeartPulse, RefreshCw } from 'lucide-react';
import { healthApi, taskApi } from '../api';

/*
 * [Sprint 4 · M8] Project health (US-40, FR-22). Shown under the dashboard for Owners and Admins.
 * Everything comes from GET /api/projects/:id/health (backend/src/routes/health.js):
 *   - overdue tasks: past their due day and not Done
 *   - blocked tasks: status "Blocked" or label "Blocked" (not Done)
 *   - activity level from feed events in the last 7 days: Low (< 5), Medium (5-20), High (> 20)
 *
 * Props
 *   projectId        real project id (Owner/Admin only; the API answers 403 otherwise)
 *   refreshKey       change it to reload (ProjectPage bumps it after task edits)
 *   onOpenTask(id)   open a task in the Tasks tab
 */

const STATUS_PILL = { Done: 'green', 'In progress': 'purple', Blocked: 'red', 'To do': 'orange' }; // same as TasksPanel
const LEVEL_TONE = { Low: 'orange', Medium: 'blue', High: 'green' };
const LIVE_RELOAD_DELAY_MS = 400;

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// Due dates are calendar days stored as midnight UTC, so they are shown in UTC.
export function formatDay(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function levelHint(activity) {
  if (!activity) return '';
  const { mediumFrom = 5, highAbove = 20 } = activity.thresholds || {};
  return `Low < ${mediumFrom} · Medium ${mediumFrom}–${highAbove} · High > ${highAbove} events in ${activity.days || 7} days`;
}

function TaskRow({ task, kind, onOpen }) {
  const detail = kind === 'overdue'
    ? `${plural(task.daysOverdue, 'day')} overdue · due ${formatDay(task.dueDate)}`
    : (task.status === 'Blocked' ? 'Status: Blocked' : 'Label: Blocked');
  return (
    <li>
      <button type="button" className="pd-due-task" onClick={onOpen} aria-label={`Open task ${task.title}`}>
        <span className="pd-due-main">
          <b>{task.title}</b>
          <small>{task.assignee?.name || 'Unassigned'} · {detail}</small>
        </span>
        <span className={`pill ${STATUS_PILL[task.status] || ''}`}>{task.status}</span>
      </button>
    </li>
  );
}

function TaskList({ id, title, icon: Icon, list, kind, emptyText, onOpenTask }) {
  const hidden = Math.max(0, list.total - list.tasks.length);
  return (
    <section className="pd-card" aria-labelledby={id}>
      <div className="pd-card-head">
        <h3 id={id} className="ph-title"><Icon size={14} /> {title}</h3>
        <span className={`pill ${list.total > 0 ? 'red' : 'green'}`}>{list.total}</span>
      </div>
      {list.tasks.length === 0 ? (
        <div className="task-empty"><Icon size={20} /><p>{emptyText}</p></div>
      ) : (
        <ul className="pd-list">
          {list.tasks.map((task) => <TaskRow key={task._id} task={task} kind={kind} onOpen={() => onOpenTask?.(task._id)} />)}
        </ul>
      )}
      {hidden > 0 && <p className="preview-note">+{plural(hidden, 'more task')}. See the Tasks tab for all of them.</p>}
    </section>
  );
}

export default function ProjectHealth({ projectId, refreshKey = 0, onOpenTask }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    try {
      const result = await healthApi.project(projectId);
      if (requestRef.current !== requestId) return;
      setData(result);
      setError('');
    } catch (err) {
      if (requestRef.current !== requestId) return;
      setError(err.status === 403
        ? 'Project health is visible to the project Owner and Admins only.'
        : err.message || 'Could not load project health.');
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { setData(null); setError(''); }, [projectId]);
  useEffect(() => { load(); }, [load, refreshKey]);

  // Live: reload shortly after a teammate creates, edits, moves or deletes a task.
  useEffect(() => {
    if (!taskApi.subscribe) return undefined;
    let timer = null;
    const reloadSoon = () => {
      clearTimeout(timer);
      timer = setTimeout(load, LIVE_RELOAD_DELAY_MS);
    };
    const stop = taskApi.subscribe(projectId, reloadSoon, reloadSoon);
    return () => { clearTimeout(timer); stop?.(); };
  }, [projectId, load]);

  useEffect(() => () => { requestRef.current += 1; }, []);

  if (!data && loading) {
    return <div className="task-empty" role="status"><HeartPulse size={20} /><p>Loading project health…</p></div>;
  }

  if (!data) {
    return (
      <div className="form-error" role="alert">
        {error} <button type="button" className="link" onClick={load}><RefreshCw size={12} /> Try again</button>
      </div>
    );
  }

  const { overdue, blocked, activity } = data;
  const problems = overdue.total + blocked.total;

  return (
    <section className="pd ph" aria-labelledby="ph-heading" aria-busy={loading}>
      <div className="pd-toolbar">
        <div>
          <h3 id="ph-heading" className="ph-heading"><HeartPulse size={15} /> Project health</h3>
          <p className="muted">
            {problems === 0 ? 'Nothing overdue or blocked right now.' : `${plural(problems, 'item')} need attention.`} Visible to Owners and Admins.
          </p>
        </div>
        <button type="button" className="iconbtn" onClick={load} disabled={loading} aria-label="Refresh project health" title="Refresh project health">
          <RefreshCw size={15} className={loading ? 'spin' : ''} />
        </button>
      </div>
      {error && (
        <div className="form-error" role="alert">
          Showing the last loaded numbers. {error} <button type="button" className="link" onClick={load}>Try again</button>
        </div>
      )}

      <div className="pd-stats">
        <div className="pd-stat">
          <div className="pd-stat-top"><span className="event-icon orange"><CalendarX size={16} /></span><p>Overdue tasks</p></div>
          <b className="pd-stat-value">{overdue.total}</b>
          <small>Past due date and not Done</small>
        </div>
        <div className="pd-stat">
          <div className="pd-stat-top"><span className="event-icon purple"><Ban size={16} /></span><p>Blocked tasks</p></div>
          <b className="pd-stat-value">{blocked.total}</b>
          <small>Status or label “Blocked”</small>
        </div>
        <div className="pd-stat">
          <div className="pd-stat-top"><span className={`event-icon ${LEVEL_TONE[activity.level] || 'blue'}`}><Activity size={16} /></span><p>Activity level</p></div>
          <b className="pd-stat-value" data-testid="activity-level">{activity.level}</b>
          <small>{plural(activity.count, 'event')} in the last {activity.days} days</small>
          <small className="ph-hint">{levelHint(activity)}</small>
        </div>
      </div>

      <div className="pd-columns">
        <TaskList id="ph-overdue-title" title="Overdue" icon={AlertTriangle} list={overdue} kind="overdue" emptyText="No overdue tasks." onOpenTask={onOpenTask} />
        <TaskList id="ph-blocked-title" title="Blocked" icon={Ban} list={blocked} kind="blocked" emptyText="No blocked tasks." onOpenTask={onOpenTask} />
      </div>
    </section>
  );
}

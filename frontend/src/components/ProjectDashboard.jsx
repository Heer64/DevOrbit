import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarClock, Check, Circle, Flag, LayoutDashboard, ListTodo, RefreshCw } from 'lucide-react';
import { dashboardApi, taskApi } from '../api';

/*
 * [Sprint 4 · M7] Project dashboard tab (US-39, FR-15).
 * Everything comes from GET /api/projects/:id/dashboard (backend/src/routes/dashboard.js):
 * milestone progress, the number of tasks that are not Done, and open tasks due today
 * through 7 days ahead. Nothing is calculated from the (possibly filtered) task list here.
 *
 * Props
 *   projectId          real project id (members only; the API answers 403 otherwise)
 *   refreshKey         change it to reload (ProjectPage bumps it after task/milestone edits)
 *   onOpenTask(id)     open a task in the Tasks tab
 *   onOpenMilestones() switch to the Milestones tab
 * Teammates' task changes arrive live (task:created/updated/deleted) and trigger a reload.
 */

const STATUS_PILL = { Done: 'green', 'In progress': 'purple', Blocked: 'red', 'To do': 'orange' }; // same as TasksPanel
const OPEN_STATUSES = ['To do', 'In progress', 'Blocked'];
const DAY_MS = 24 * 60 * 60 * 1000;
const LIVE_RELOAD_DELAY_MS = 400;

// Due dates are calendar days stored as midnight UTC, so they are always shown in UTC.
export function formatDueDay(value, withYear = false) {
  if (!value) return 'No due date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No due date';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
}

// Whole days between the dashboard's "today" (dueSoon.from, 'YYYY-MM-DD') and a due date.
// Measured against the server's day so the labels always agree with the list it sent.
export function daysFromToday(dueDate, fromDay) {
  if (!dueDate || !fromDay) return null;
  const due = new Date(dueDate);
  const start = new Date(`${fromDay}T00:00:00.000Z`);
  if (Number.isNaN(due.getTime()) || Number.isNaN(start.getTime())) return null;
  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  return Math.round((dueDay - start.getTime()) / DAY_MS);
}

export function relativeDueLabel(days) {
  if (days === null || days === undefined) return '';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1) return `In ${days} days`;
  return 'Overdue';
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function milestoneTone(milestone) {
  if (milestone.completed) return 'green';
  return 'violet';
}

function StatTile({ icon: Icon, tone, label, value, detail, children }) {
  return (
    <div className="pd-stat">
      <div className="pd-stat-top">
        <span className={`event-icon ${tone}`}><Icon size={16} /></span>
        <p>{label}</p>
      </div>
      <b className="pd-stat-value">{value}</b>
      {detail && <small>{detail}</small>}
      {children}
    </div>
  );
}

function MilestoneRow({ milestone }) {
  const tone = milestoneTone(milestone);
  return (
    <li className="pd-milestone">
      <div className={`milestone-status ${tone}`} aria-hidden="true">{milestone.completed ? <Check size={14} /> : <Circle size={12} />}</div>
      <div className="pd-milestone-copy">
        <div className="pd-milestone-title">
          <b>{milestone.title}</b>
          <span>{milestone.progress}%</span>
        </div>
        <div
          className={`progress ${tone}`}
          role="progressbar"
          aria-label={`${milestone.title} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={milestone.progress}
          aria-valuetext={`${milestone.progress}% (${milestone.doneCount} of ${milestone.taskCount} tasks done)`}
        >
          <i style={{ width: `${milestone.progress}%` }} />
        </div>
        <small>
          {milestone.taskCount === 0 ? 'No tasks attached yet' : `${milestone.doneCount} of ${plural(milestone.taskCount, 'task')} done`}
          {' · '}
          {milestone.dueDate ? `Due ${formatDueDay(milestone.dueDate, true)}` : 'No due date'}
          {milestone.completed ? ' · Completed' : ''}
        </small>
      </div>
    </li>
  );
}

function DueTaskRow({ task, fromDay, onOpen }) {
  const days = daysFromToday(task.dueDate, fromDay);
  return (
    <li>
      <button type="button" className="pd-due-task" onClick={onOpen} aria-label={`Open task ${task.title}`}>
        <span className={`pd-due-day ${days === 0 ? 'today' : ''}`}>
          <b>{relativeDueLabel(days)}</b>
          <small>{formatDueDay(task.dueDate)}</small>
        </span>
        <span className="pd-due-main">
          <b>{task.title}</b>
          <small>{task.assignee?.name || 'Unassigned'}{task.milestone?.title ? ` · ${task.milestone.title}` : ''}</small>
        </span>
        <span className={`pill ${STATUS_PILL[task.status] || ''}`}>{task.status}</span>
      </button>
    </li>
  );
}

export default function ProjectDashboard({ projectId, refreshKey = 0, onOpenTask, onOpenMilestones }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    try {
      const result = await dashboardApi.project(projectId);
      if (requestRef.current !== requestId) return; // a newer request is on its way
      setData(result);
      setError('');
    } catch (err) {
      if (requestRef.current !== requestId) return;
      setError(err.status === 403
        ? 'The project dashboard is visible to project members only.'
        : err.message || 'Could not load the project dashboard.');
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [projectId]);

  // A different project starts from a clean slate.
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

  // Ignore the answer of a request that is still running when the tab closes.
  useEffect(() => () => { requestRef.current += 1; }, []);

  if (!data && loading) {
    return <div className="task-empty" role="status"><LayoutDashboard size={20} /><p>Loading dashboard…</p></div>;
  }

  if (!data) {
    return (
      <div className="form-error" role="alert">
        {error} <button type="button" className="link" onClick={load}><RefreshCw size={12} /> Try again</button>
      </div>
    );
  }

  const { milestones, tasks, dueSoon } = data;
  const hiddenDue = Math.max(0, dueSoon.total - dueSoon.tasks.length);

  return (
    <div className="pd" aria-busy={loading}>
      <div className="pd-toolbar">
        <p className="muted">Live numbers for this project. Due dates use calendar days (UTC).</p>
        <button type="button" className="iconbtn" onClick={load} disabled={loading} aria-label="Refresh dashboard" title="Refresh dashboard">
          <RefreshCw size={15} className={loading ? 'spin' : ''} />
        </button>
      </div>
      {error && (
        <div className="form-error" role="alert">
          Showing the last loaded numbers. {error} <button type="button" className="link" onClick={load}>Try again</button>
        </div>
      )}

      <div className="pd-stats">
        <StatTile icon={ListTodo} tone="purple" label="Open tasks" value={tasks.open} detail={tasks.total === 0 ? 'No tasks yet' : `of ${plural(tasks.total, 'task')} not Done`}>
          <ul className="pd-status-list" aria-label="Open tasks by status">
            {OPEN_STATUSES.map((status) => (
              <li key={status}><span className={`pill ${STATUS_PILL[status]}`}>{status}</span><b>{tasks.byStatus?.[status] ?? 0}</b></li>
            ))}
          </ul>
        </StatTile>
        <StatTile icon={CalendarClock} tone="orange" label="Due in the next 7 days" value={dueSoon.total} detail={`${formatDueDay(dueSoon.from)} – ${formatDueDay(dueSoon.to)}`} />
        <StatTile
          icon={Flag}
          tone="green"
          label="Milestones completed"
          value={milestones.total === 0 ? '0' : `${milestones.completed} / ${milestones.total}`}
          detail={milestones.total === 0 ? 'No milestones yet' : `${plural(milestones.total - milestones.completed, 'milestone')} in progress`}
        />
      </div>

      <div className="pd-columns">
        <section className="pd-card" aria-labelledby="pd-milestones-title">
          <div className="pd-card-head">
            <h3 id="pd-milestones-title">Milestone progress</h3>
            {onOpenMilestones && <button type="button" className="link" onClick={onOpenMilestones}>Open milestones</button>}
          </div>
          {milestones.items.length === 0 ? (
            <div className="task-empty"><Flag size={20} /><p>No milestones yet. Owners and Admins can create them in the Milestones tab.</p></div>
          ) : (
            <ul className="pd-list">
              {milestones.items.map((milestone) => <MilestoneRow key={milestone._id} milestone={milestone} />)}
            </ul>
          )}
        </section>

        <section className="pd-card" aria-labelledby="pd-due-title">
          <div className="pd-card-head">
            <h3 id="pd-due-title">Due in the next 7 days</h3>
            <span className="muted">{formatDueDay(dueSoon.from)} – {formatDueDay(dueSoon.to)}</span>
          </div>
          {dueSoon.tasks.length === 0 ? (
            <div className="task-empty">
              <CalendarClock size={20} />
              <p>{tasks.total === 0 ? 'No tasks yet. Add tasks with due dates to see deadlines here.' : 'Nothing is due in the next 7 days.'}</p>
            </div>
          ) : (
            <ul className="pd-list">
              {dueSoon.tasks.map((task) => (
                <DueTaskRow key={task._id} task={task} fromDay={dueSoon.from} onOpen={() => onOpenTask?.(task._id)} />
              ))}
            </ul>
          )}
          {hiddenDue > 0 && <p className="preview-note">+{plural(hiddenDue, 'more task')} due in the next 7 days. See the Tasks tab for all of them.</p>}
        </section>
      </div>
    </div>
  );
}

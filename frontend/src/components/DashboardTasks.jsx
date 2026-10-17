import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, ListTodo } from 'lucide-react';
import { myTaskApi } from '../api';
import { tone } from './ui';

/*
 * Dashboard task widgets (Sprint 2 leftovers).
 *   UpcomingDeadlines  open tasks due in the next 7 days across my projects (US-23)
 *   MyTasks            open tasks assigned to me
 *   useTaskStats       numbers for the "Tasks completed" and "Assigned to me" stat cards
 * Demo users get the sample data passed in and never call the API.
 * All three reload when another page fires 'devorbit:projects-updated'.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// Due dates are stored as midnight UTC (from <input type="date">), so compare whole UTC days.
export function dueLabel(value, now = new Date()) {
  if (!value) return 'No due date';
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return 'No due date';
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate()) - today) / DAY_MS);
  if (days < 0) return `Overdue · ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days < 7) return `Due in ${days} days`;
  return `Due ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}

// Loads one of the personal task lists; returns { tasks, total, error } (tasks is null while loading).
function useMyTasks(user, load) {
  const [state, setState] = useState({ tasks: null, total: 0, error: '' });

  useEffect(() => {
    let active = true;
    if (!user || user.isDemo) return () => { active = false; };
    const run = () => {
      load()
        .then((result) => { if (active) setState({ tasks: result.tasks || [], total: result.total ?? (result.tasks || []).length, error: '' }); })
        .catch((error) => { if (active) setState({ tasks: [], total: 0, error: error.message || 'Could not load tasks.' }); });
    };
    setState({ tasks: null, total: 0, error: '' });
    run();
    window.addEventListener('devorbit:projects-updated', run);
    return () => { active = false; window.removeEventListener('devorbit:projects-updated', run); };
    // `load` only wraps a module-level API call, so the user alone decides when to reload.
  }, [user]);

  return state;
}

export function useTaskStats(user) {
  const [stats, setStats] = useState(null); // null while loading or after an error

  useEffect(() => {
    let active = true;
    if (!user || user.isDemo) return () => { active = false; };
    const run = () => myTaskApi.stats()
      .then((result) => { if (active) setStats(result); })
      .catch(() => { if (active) setStats(null); });
    run();
    window.addEventListener('devorbit:projects-updated', run);
    return () => { active = false; window.removeEventListener('devorbit:projects-updated', run); };
  }, [user]);

  return stats;
}

function TaskLine({ task, onOpen }) {
  const overdue = dueLabel(task.dueDate).startsWith('Overdue');
  return (
    <button type="button" className="dash-task" onClick={onOpen} aria-label={`Open ${task.title} in ${task.project?.name || 'its project'}`}>
      <span className={`project-avatar small ${tone(task.project?.color)}`}>{(task.project?.name || 'P')[0].toUpperCase()}</span>
      <span className="dash-task-main">
        <b>{task.title}</b>
        <small>{task.project?.name || 'Project'}{task.status ? ` · ${task.status}` : ''}</small>
      </span>
      <span className={`dash-task-due ${overdue ? 'overdue' : ''}`}>{dueLabel(task.dueDate)}</span>
    </button>
  );
}

function TaskList({ title, subtitle, icon: Icon, user, state, demoTasks, emptyText, footer }) {
  const navigate = useNavigate();
  const tasks = user?.isDemo ? demoTasks : state.tasks;

  return (
    <section className="panel dash-tasks" aria-label={title}>
      <div className="panel-head"><div><h2>{title}</h2><p>{subtitle}</p></div><Icon size={18} /></div>
      {tasks === null && <p className="preview-note">Loading tasks…</p>}
      {!user?.isDemo && state.error && <div className="form-error" role="alert">{state.error}</div>}
      {tasks?.length === 0 && !state.error && <div className="task-empty"><Icon size={20} /><p>{emptyText}</p></div>}
      {tasks?.map((task) => (
        <TaskLine key={task._id} task={task} onOpen={() => task.project?._id && navigate(`/project/${task.project._id}`)} />
      ))}
      {footer}
    </section>
  );
}

export function UpcomingDeadlines({ user, demoTasks = [] }) {
  const state = useMyTasks(user, () => myTaskApi.upcoming(7, 6));
  return (
    <TaskList
      title="Upcoming deadlines"
      subtitle="Open tasks due in the next 7 days."
      icon={CalendarClock}
      user={user}
      state={state}
      demoTasks={demoTasks}
      emptyText="Nothing due in the next 7 days."
    />
  );
}

export function MyTasks({ user, demoTasks = [] }) {
  const state = useMyTasks(user, () => myTaskApi.mine(6));
  const shown = user?.isDemo ? demoTasks.length : (state.tasks || []).length;
  const total = user?.isDemo ? demoTasks.length : state.total;
  return (
    <TaskList
      title="My tasks"
      subtitle="Open tasks assigned to you."
      icon={ListTodo}
      user={user}
      state={state}
      demoTasks={demoTasks}
      emptyText="No open tasks assigned to you."
      footer={total > shown ? <p className="preview-note">+{total - shown} more open task{total - shown === 1 ? '' : 's'} assigned to you.</p> : null}
    />
  );
}

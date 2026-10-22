import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Ban, Check, CheckCircle2, Circle, Clock3, Columns3, List, ListTodo, Loader2, Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { assetUrl, taskApi } from '../api';
import { canDeleteTask, canWriteTasks } from '../roles';
import { Avatar, AVATAR_TONES, initialsOf } from './ui';
import KanbanBoard from './KanbanBoard';
import { CONFLICT_MESSAGE, mergeTask, versionOf } from './kanbanLogic';

// [Pair D] 'Blocked' added (FR-7b); same order as the Kanban columns.
export const TASK_STATUSES = ['To do', 'In progress', 'Blocked', 'Done'];
export const TASK_PRIORITIES = ['Low', 'Medium', 'High'];
const TITLE_MAX = 200;
export const LABEL_MAX = 30; // same limit as the API (US-21)
const EMPTY_FORM = { title: '', description: '', label: '', priority: 'Medium', status: 'To do', assignee: '', dueDate: '', milestone: '' };
const STATUS_PILL = { Done: 'green', 'In progress': 'purple', Blocked: 'red', 'To do': 'orange' };
const VIEW_KEY = 'devorbit_task_view';

function savedView() {
  try { return localStorage.getItem(VIEW_KEY) === 'board' ? 'board' : 'list'; } catch { return 'list'; }
}

const idOf = (value) => String(value?._id || value?.id || value || '');
const nextStatus = (status) => TASK_STATUSES[(TASK_STATUSES.indexOf(status) + 1) % TASK_STATUSES.length];

// Due dates are stored as midnight UTC (from <input type="date">), so read and show them in UTC.
const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');
function formatDue(value) {
  if (!value) return 'No due date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No due date';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function isOverdue(task) {
  if (!task.dueDate || task.status === 'Done') return false;
  const now = new Date();
  return new Date(task.dueDate).getTime() < Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}
const formFromTask = (task) => ({
  title: task.title || '',
  description: task.description || '',
  label: task.label || '',
  priority: task.priority || 'Medium',
  status: task.status || 'To do',
  assignee: idOf(task.assignee),
  dueDate: toDateInput(task.dueDate),
  milestone: idOf(task.milestone),
});

/**
 * The Tasks tab of a project.
 *
 * Props
 *   projectId      project the tasks belong to
 *   myRole         'Owner' | 'Admin' | 'Contributor' | 'Viewer' | null (not a member -> read only)
 *   currentUserId  used for "Assigned to me" and for the Contributor delete rule
 *   members        [{ userId, name, avatarUrl }] for the assignee dropdown (from TeamPanel)
 *   api            taskApi (real) or mockTaskApi (demo); must be a stable object
 *   addSignal      number; each time it goes up the "Add a task" modal opens (header button)
 *   onTasksChange  (tasks) => void, so the page can show "Open tasks"
 *   onChanged      () => void after a create/edit/delete, so the page can refresh progress
 *   onNotice       (text) => void for the success toast
 *   milestones     [{ _id, title }] for the milestone dropdown (Pair C); the dropdown is hidden when empty
 *   openTaskId     [Sprint 2 final] task to open as soon as tasks are loaded (from a link such as
 *                  /project/<id>?tab=tasks&task=<taskId>); fetched with api.get when not in the list
 *   onCloseTask    [Sprint 2 final] () => void when the task window closes, so the page can clear the link
 *
 * [Pair D] The panel has a List / Board switch. The board (KanbanBoard) shares this panel's task
 * list, so moves, edits and live task:updated events show up in both views.
 */
export default function TasksPanel({ projectId, myRole, currentUserId, members = [], api = taskApi, addSignal = 0, onTasksChange, onChanged, onNotice, milestones = [], openTaskId = '', onCloseTask }) {
  const [tasks, setTasks] = useState(null); // null while loading
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState('');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [assigneeFilter, setAssigneeFilter] = useState('All');

  const [editing, setEditing] = useState(null); // null = modal closed, 'new' = add, task object = edit
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [view, setView] = useState(savedView); // [Pair D] 'list' | 'board'

  const canWrite = canWriteTasks(myRole);
  const notify = (text) => onNotice?.(text);

  const chooseView = (next) => {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* storage unavailable: keep it for this visit only */ }
  };

  // [Pair D] Board updates go through the full list, never just the filtered one.
  const updateTasks = useCallback((updater) => setTasks((old) => updater(old || [])), []);

  // [Pair D] Live updates (task:updated). Older or repeated events are ignored by mergeTask.
  // [Sprint 2 final] New tasks (task:created) are added by the same mergeTask call, and tasks
  // deleted by someone else (task:deleted) are removed; if that task is open, its window closes.
  const editingRef = useRef(null);
  editingRef.current = editing;
  useEffect(() => {
    if (!api.subscribe) return undefined;
    return api.subscribe(
      projectId,
      (task) => {
        setTasks((old) => (old ? mergeTask(old, task, 'remote') : old));
      },
      (taskId) => {
        setTasks((old) => (old ? old.filter((task) => idOf(task) !== taskId) : old));
        const open = editingRef.current;
        if (open && open !== 'new' && idOf(open) === taskId) {
          setEditing(null);
          onCloseTask?.();
          onNotice?.('That task was deleted by another member.');
        }
      }
    );
  }, [api, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true;
    setTasks(null);
    setLoadError('');
    api.list(projectId)
      .then((result) => { if (active) setTasks(result.tasks || []); })
      .catch((error) => { if (active) setLoadError(error.message || 'Could not load tasks.'); });
    return () => { active = false; };
  }, [api, projectId, reloadKey]);

  useEffect(() => { if (tasks) onTasksChange?.(tasks); }, [tasks, onTasksChange]);

  // The page's "Add task" button bumps addSignal.
  useEffect(() => { if (addSignal && canWrite) openNew(); }, [addSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (tasks || []).filter((task) => {
      if (statusFilter !== 'All' && task.status !== statusFilter) return false;
      const assignee = idOf(task.assignee);
      if (assigneeFilter === 'me' && assignee !== currentUserId) return false;
      if (assigneeFilter === 'none' && assignee) return false;
      if (!['All', 'me', 'none'].includes(assigneeFilter) && assignee !== assigneeFilter) return false;
      if (!query) return true;
      return task.title.toLowerCase().includes(query) || (task.description || '').toLowerCase().includes(query);
    });
  }, [tasks, search, statusFilter, assigneeFilter, currentUserId]);

  const filtersOn = Boolean(search.trim()) || statusFilter !== 'All' || assigneeFilter !== 'All';
  const clearFilters = () => { setSearch(''); setStatusFilter('All'); setAssigneeFilter('All'); };
  const replaceTask = (task) => setTasks((old) => (old || []).map((item) => (idOf(item) === idOf(task) ? task : item)));

  function openNew() {
    setEditing('new'); setForm(EMPTY_FORM); setFormError('');
  }
  const openEdit = (task) => { setEditing(task); setForm(formFromTask(task)); setFormError(''); };
  // [Pair D] Card click on the board. Temporary stand-in for a task drawer: the edit modal,
  // read-only for people who cannot write tasks. Replace with the drawer when it exists.
  const openTask = useCallback((task) => { setEditing(task); setForm(formFromTask(task)); setFormError(''); }, []);
  // [Sprint 2 final] Open the task named in the link once, after the list has loaded.
  const openedFromLink = useRef('');
  const [linkError, setLinkError] = useState('');
  useEffect(() => {
    if (!openTaskId || !tasks || openedFromLink.current === openTaskId) return;
    openedFromLink.current = openTaskId;
    setLinkError('');
    const found = tasks.find((task) => idOf(task) === openTaskId);
    if (found) { openTask(found); return; }
    if (!api.get) { setLinkError('That task no longer exists.'); return; }
    api.get(projectId, openTaskId)
      .then((result) => { if (result.task) openTask(result.task); })
      .catch(() => setLinkError('That task no longer exists or you cannot open it.'));
  }, [openTaskId, tasks, api, projectId, openTask]);
  useEffect(() => { if (!openTaskId) openedFromLink.current = ''; }, [openTaskId]);

  const closeModal = () => {
    if (saving) return;
    setEditing(null);
    onCloseTask?.(); // [Sprint 2 final]
  };
  const setField = (field) => (event) => setForm((old) => ({ ...old, [field]: event.target.value }));

  const cycleStatus = async (task) => {
    if (!canWrite || busyId) return;
    const status = nextStatus(task.status);
    setBusyId(idOf(task)); setActionError('');
    replaceTask({ ...task, status }); // show the change right away, undo it if the server says no
    try {
      // [Pair D] Send the loaded version so a newer change by someone else is not overwritten.
      const result = await api.update(projectId, idOf(task), { status, version: versionOf(task) });
      replaceTask(result.task);
      onChanged?.();
      notify(`Task moved to ${status}.`);
    } catch (error) {
      if (error.status === 409 && error.response?.data?.task) {
        replaceTask(error.response.data.task);
        setActionError(CONFLICT_MESSAGE);
      } else {
        replaceTask(task);
        setActionError(error.message || 'Could not update the task status.');
      }
    } finally {
      setBusyId('');
    }
  };

  const removeTask = async (task) => {
    if (busyId || !window.confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
    setBusyId(idOf(task)); setActionError('');
    try {
      await api.remove(projectId, idOf(task));
      setTasks((old) => (old || []).filter((item) => idOf(item) !== idOf(task)));
      onChanged?.();
      notify('Task deleted.');
    } catch (error) {
      setActionError(error.message || 'Could not delete the task.');
    } finally {
      setBusyId('');
    }
  };

  const save = async (event) => {
    event.preventDefault();
    if (!canWrite) return; // [Pair D] the modal is read-only for Viewers
    const title = form.title.trim();
    if (!title) { setFormError('Task title is required.'); return; }
    const values = {
      title,
      description: form.description.trim(),
      label: form.label.trim(),
      priority: form.priority,
      status: form.status,
      assignee: form.assignee || null,
      dueDate: form.dueDate || null,
      milestone: form.milestone || null,
    };

    let payload = values;
    if (editing !== 'new') {
      // Only send what changed, so an old assignee who has left the project does not block other edits.
      const before = formFromTask(editing);
      payload = Object.fromEntries(Object.entries(values).filter(([key, value]) => (value ?? '') !== (['title', 'description', 'label'].includes(key) ? before[key].trim() : before[key])));
      if (!Object.keys(payload).length) { setEditing(null); onCloseTask?.(); return; }
      payload.version = versionOf(editing); // [Pair D] 409 instead of silently overwriting a newer change
    }

    setSaving(true); setFormError('');
    try {
      if (editing === 'new') {
        const result = await api.create(projectId, payload);
        setTasks((old) => [result.task, ...(old || [])]);
        notify('Task created.');
      } else {
        const result = await api.update(projectId, idOf(editing), payload);
        replaceTask(result.task);
        notify('Task updated.');
      }
      onChanged?.();
      setEditing(null);
      onCloseTask?.(); // [Sprint 2 final] clear ?task= from the link
    } catch (error) {
      if (error.status === 409 && error.response?.data?.task) {
        // [Pair D] Keep what the user typed, but show that the task changed and save against the latest version next time.
        const latest = error.response.data.task;
        replaceTask(latest);
        setEditing(latest);
        setFormError(`${CONFLICT_MESSAGE} The latest version has been loaded; check it, then save again to keep your changes.`);
      } else {
        setFormError(error.message || 'Could not save the task.');
      }
    } finally {
      setSaving(false);
    }
  };

  // Keep a departed assignee visible in the edit dropdown instead of silently showing "Unassigned".
  const assigneeOptions = useMemo(() => {
    const list = members.map((member) => ({ id: idOf(member.userId), name: member.name }));
    if (editing && editing !== 'new' && editing.assignee && !list.some((item) => item.id === idOf(editing.assignee))) {
      list.push({ id: idOf(editing.assignee), name: `${editing.assignee.name || 'Former member'} (no longer in project)` });
    }
    return list;
  }, [members, editing]);

  return (
    <>
      <div className="task-toolbar">
        <label className="task-search"><Search size={14} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a task..." aria-label="Search tasks" /></label>
        {view === 'list' && (
          <select className="task-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
            <option value="All">All statuses</option>
            {TASK_STATUSES.map((status) => <option key={status}>{status}</option>)}
          </select>
        )}
        <select className="task-filter" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} aria-label="Filter by assignee">
          <option value="All">Everyone</option>
          <option value="me">Assigned to me</option>
          <option value="none">Unassigned</option>
          {members.map((member) => <option key={member.userId} value={idOf(member.userId)}>{member.name}</option>)}
        </select>
        <div className="view-toggle" role="group" aria-label="Task view">
          <button type="button" className={view === 'list' ? 'active' : ''} aria-pressed={view === 'list'} onClick={() => chooseView('list')} title="List view"><List size={14} /><span>List</span></button>
          <button type="button" className={view === 'board' ? 'active' : ''} aria-pressed={view === 'board'} onClick={() => chooseView('board')} title="Board view"><Columns3 size={14} /><span>Board</span></button>
        </div>
        {canWrite && <button className="iconbtn" title="Add task" aria-label="Add task" onClick={openNew}><Plus size={16} /></button>}
      </div>

      {!canWrite && tasks && <p className="task-readonly">{myRole === 'Viewer' ? 'You are a Viewer on this project, so tasks are read-only.' : 'Join this project to add or change tasks.'}</p>}
      {linkError && <div className="form-error task-action-error" role="alert">{linkError}<button className="task-more" onClick={() => setLinkError('')} aria-label="Dismiss"><X size={13} /></button></div>}
      {actionError && <div className="form-error task-action-error" role="alert">{actionError}<button className="task-more" onClick={() => setActionError('')} aria-label="Dismiss"><X size={13} /></button></div>}

      {tasks === null && !loadError && (
        <div className="task-state" aria-busy="true"><Loader2 size={20} className="spin" /><p>Loading tasks…</p></div>
      )}

      {loadError && (
        <div className="task-state error" role="alert">
          <AlertCircle size={20} />
          <p>{loadError}</p>
          <button className="btn secondary" onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={13} /> Try again</button>
        </div>
      )}

      {tasks && tasks.length === 0 && (
        <div className="task-state">
          <ListTodo size={22} />
          <p><b>No tasks yet.</b> {canWrite ? 'Break the work into small, clear steps.' : 'Tasks will show up here once the team adds them.'}</p>
          {canWrite && <button className="btn" onClick={openNew}><Plus size={14} /> Add the first task</button>}
        </div>
      )}

      {tasks && tasks.length > 0 && view === 'board' && (
        <KanbanBoard
          projectId={projectId}
          tasks={filtered}
          api={api}
          canMove={canWrite}
          onUpdateTasks={updateTasks}
          onOpenTask={openTask}
          onMoved={onChanged}
          members={members}
        />
      )}

      {tasks && tasks.length > 0 && view === 'list' && (
        <div>
          {filtered.map((task) => {
            const id = idOf(task);
            const done = task.status === 'Done';
            const busy = busyId === id;
            const assigneeIndex = members.findIndex((member) => idOf(member.userId) === idOf(task.assignee));
            const mayDelete = canDeleteTask(myRole, idOf(task.createdBy) === currentUserId);
            return (
              <article className={`task-row ${busy ? 'busy' : ''}`} key={id}>
                <button
                  className={`task-dot ${done ? 'done' : task.status === 'In progress' ? 'working' : task.status === 'Blocked' ? 'blocked' : ''}`}
                  onClick={() => cycleStatus(task)}
                  disabled={!canWrite || Boolean(busyId)}
                  title={canWrite ? `${task.status}. Click to move to ${nextStatus(task.status)}.` : task.status}
                  aria-label={canWrite ? `Status ${task.status}. Move to ${nextStatus(task.status)}` : `Status ${task.status}`}
                >
                  {done ? <Check size={12} /> : task.status === 'In progress' ? <span /> : task.status === 'Blocked' ? <Ban size={11} /> : null}
                </button>
                <div className="task-main">
                  <b className={done ? 'crossed' : ''}>{task.title}</b>
                  <div className="task-meta">
                    <span className={`task-label priority-${(task.priority || 'Medium').toLowerCase()}`}>{task.priority}</span>
                    {task.label && <span className="task-label custom-label" title="Label">{task.label}</span>}
                    <span className={isOverdue(task) ? 'overdue' : ''}><Clock3 size={11} />{formatDue(task.dueDate)}{isOverdue(task) ? ' · overdue' : ''}</span>
                  </div>
                </div>
                <span className={`pill ${STATUS_PILL[task.status] || ''}`}>{task.status}</span>
                <span className="task-assignee" title={task.assignee ? `Assigned to ${task.assignee.name}` : 'Unassigned'}>
                  {task.assignee
                    ? <Avatar initials={initialsOf(task.assignee.name)} src={assetUrl(task.assignee.avatarUrl)} tone={AVATAR_TONES[Math.max(assigneeIndex, 0) % 4]} small />
                    : <span className="avatar small unassigned">–</span>}
                </span>
                {canWrite && <button className="task-more" onClick={() => openEdit(task)} disabled={busy} title="Edit task" aria-label={`Edit ${task.title}`}><Pencil size={14} /></button>}
                {mayDelete && <button className="task-more danger" onClick={() => removeTask(task)} disabled={busy} title="Delete task" aria-label={`Delete ${task.title}`}><Trash2 size={14} /></button>}
              </article>
            );
          })}
          {filtered.length === 0 && (
            <div className="task-empty"><Circle size={20} /><p>No tasks match your filters.</p>{filtersOn && <button className="link" onClick={clearFilters}>Clear filters</button>}</div>
          )}
        </div>
      )}

      {canWrite && tasks && tasks.length > 0 && <button className="add-task-bottom" onClick={openNew}><Plus size={14} /> Add another task</button>}

      {editing && (
        <div className="modal-back" onClick={closeModal}>
          <form className="modal task-modal" onSubmit={save} onClick={(e) => e.stopPropagation()}>
            <div className="modal-top"><span className="modal-icon"><CheckCircle2 size={19} /></span><button type="button" className="iconbtn" aria-label="Close" onClick={closeModal}><X size={17} /></button></div>
            <h2>{editing === 'new' ? 'Add a task' : canWrite ? 'Edit task' : 'Task details'}</h2>
            <p>{canWrite ? 'Keep the next step small and clear.' : 'You can view this task but not change it.'}</p>
            <fieldset className="task-fieldset" disabled={!canWrite}>
            <label>Task title
              <input className="field-input" autoFocus value={form.title} onChange={setField('title')} placeholder="What needs to get done?" required maxLength={TITLE_MAX} />
              <span className="char-count">{form.title.length}/{TITLE_MAX}</span>
            </label>
            <label>Description <span className="field-hint">optional</span>
              <textarea className="field-input" rows={3} value={form.description} onChange={setField('description')} maxLength={2000} placeholder="Any detail that helps whoever picks this up" />
            </label>
            <label>Label <span className="field-hint">optional</span>
              <input className="field-input" value={form.label} onChange={setField('label')} placeholder="e.g. Frontend, Bug, Docs" maxLength={LABEL_MAX} />
              <span className="char-count">{form.label.length}/{LABEL_MAX}</span>
            </label>
            <div className="task-form-row">
              <label>Priority
                <select className="field-input" value={form.priority} onChange={setField('priority')}>
                  {TASK_PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}
                </select>
              </label>
              {editing !== 'new' && (
                <label>Status
                  <select className="field-input" value={form.status} onChange={setField('status')}>
                    {TASK_STATUSES.map((status) => <option key={status}>{status}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div className="task-form-row">
              <label>Assignee
                <select className="field-input" value={form.assignee} onChange={setField('assignee')}>
                  <option value="">Unassigned</option>
                  {assigneeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}{option.id === currentUserId ? ' (you)' : ''}</option>)}
                </select>
              </label>
              <label>Due date
                <input className="field-input" type="date" value={form.dueDate} onChange={setField('dueDate')} />
              </label>
            </div>
            {(milestones.length > 0 || form.milestone) && (
              <label>Milestone <span className="field-hint">optional</span>
                <select className="field-input" value={form.milestone} onChange={setField('milestone')}>
                  <option value="">No milestone</option>
                  {milestones.map((m) => <option key={idOf(m)} value={idOf(m)}>{m.title}</option>)}
                  {form.milestone && !milestones.some((m) => idOf(m) === form.milestone) && <option value={form.milestone}>Current milestone</option>}
                </select>
              </label>
            )}
            </fieldset>
            {formError && <p className="form-error" role="alert">{formError}</p>}
            {canWrite && (
              <button className="btn full" type="submit" disabled={saving}>
                {saving ? <><Loader2 size={16} className="spin" /> Saving…</> : editing === 'new' ? <>Create task <Plus size={16} /></> : <>Save changes <Check size={16} /></>}
              </button>
            )}
          </form>
        </div>
      )}
    </>
  );
}

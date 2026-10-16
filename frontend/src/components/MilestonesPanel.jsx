import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Check, ChevronDown, Circle, Flag, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { milestoneApi } from '../api';
import { canManageMilestones } from '../roles';
import { Btn } from './ui';

const EMPTY_FORM = { title: '', description: '', dueDate: '' };

// "2026-10-25T00:00:00.000Z" -> "2026-10-25" for <input type="date">.
const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');
const formatDue = (value) => (value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : 'No due date');

function toneOf(milestone) {
  if (milestone.completed) return 'green';
  if (milestone.dueDate && new Date(milestone.dueDate) < new Date(new Date().toDateString())) return 'orange';
  return 'violet';
}

// The project's Milestones tab. Everyone who can see the project can read it;
// Owners and Admins also get create, edit and delete (the API enforces this too).
// Pass a changing `refreshKey` to reload after tasks change, so the progress bars stay right.
export default function MilestonesPanel({ projectId, myRole, refreshKey = 0, onChange }) {
  const [milestones, setMilestones] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(null); // null = closed, 'new' or a milestone
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [openTasks, setOpenTasks] = useState(null);

  const canManage = canManageMilestones(myRole);

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await milestoneApi.list(projectId);
      setMilestones(result.milestones || []);
    } catch (e) {
      setMilestones([]);
      setError(e.message || 'Could not load milestones.');
    }
  }, [projectId]);

  useEffect(() => { setMilestones(null); }, [projectId]);
  useEffect(() => { load(); }, [load, refreshKey]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  const openForm = (milestone) => {
    setFormError('');
    setEditing(milestone || 'new');
    setForm(milestone ? { title: milestone.title, description: milestone.description || '', dueDate: toDateInput(milestone.dueDate) } : EMPTY_FORM);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { setFormError('Give the milestone a title.'); return; }
    setBusy(true); setFormError('');
    const payload = { title: form.title.trim(), description: form.description.trim(), dueDate: form.dueDate || null };
    try {
      if (editing === 'new') await milestoneApi.create(projectId, payload);
      else await milestoneApi.update(projectId, editing._id, payload);
      setNotice(editing === 'new' ? 'Milestone created.' : 'Milestone saved.');
      setEditing(null);
      await load();
      onChange?.();
    } catch (err) {
      setFormError(err.message || 'Could not save the milestone.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (milestone) => {
    if (!window.confirm(`Delete "${milestone.title}"? Its tasks are kept and simply detached.`)) return;
    setError('');
    try {
      await milestoneApi.remove(projectId, milestone._id);
      setNotice('Milestone deleted.');
      if (openId === milestone._id) setOpenId(null);
      await load();
      onChange?.();
    } catch (err) {
      setError(err.message || 'Could not delete the milestone.');
    }
  };

  const toggleTasks = async (milestone) => {
    if (openId === milestone._id) { setOpenId(null); return; }
    setOpenId(milestone._id); setOpenTasks(null);
    try {
      const result = await milestoneApi.tasks(projectId, milestone._id);
      setOpenTasks(result.tasks || []);
    } catch {
      setOpenTasks([]);
    }
  };

  if (milestones === null) return <div className="task-empty"><Flag size={20} /><p>Loading milestones…</p></div>;

  return (
    <div>
      {canManage && (
        <div className="task-toolbar" style={{ justifyContent: 'flex-end' }}>
          <Btn className="small" icon={Plus} onClick={() => openForm(null)}>New milestone</Btn>
        </div>
      )}
      {notice && <p className="success-inline" role="status">{notice}</p>}
      {error && (
        <div className="form-error" role="alert" style={{ margin: '10px 0' }}>
          {error} <button className="link" onClick={load}><RefreshCw size={12} /> Try again</button>
        </div>
      )}

      {!error && milestones.length === 0 && (
        <div className="task-empty">
          <Flag size={20} />
          <p>{canManage ? 'No milestones yet. Create one, then attach tasks to it from the task editor.' : 'No milestones yet.'}</p>
        </div>
      )}

      <div className="milestone-list">
        {milestones.map((m) => {
          const toneName = toneOf(m);
          return (
            <div key={m._id}>
              <div className="milestone">
                <div className={`milestone-status ${toneName}`}>{m.completed ? <Check size={15} /> : <Circle size={13} />}</div>
                <div className="milestone-copy">
                  <div>
                    <b>{m.title}</b>
                    <span>{m.progress}%</span>
                  </div>
                  <p>
                    {m.description ? `${m.description} · ` : ''}
                    <CalendarDays size={10} style={{ verticalAlign: '-1px' }} /> {formatDue(m.dueDate)}
                    {toneName === 'orange' ? ' · overdue' : ''}
                  </p>
                  <div className={`progress ${toneName}`}><i style={{ width: `${m.progress}%` }} /></div>
                  <div className="task-meta" style={{ marginTop: 8, gap: 10 }}>
                    <button className="link" onClick={() => toggleTasks(m)} aria-expanded={openId === m._id}>
                      {m.doneCount} of {m.taskCount} task{m.taskCount === 1 ? '' : 's'} done
                      <ChevronDown size={12} className={openId === m._id ? 'rotate' : ''} />
                    </button>
                    {canManage && (
                      <>
                        <button className="task-more" onClick={() => openForm(m)} title="Edit milestone" aria-label={`Edit ${m.title}`}><Pencil size={13} /></button>
                        <button className="task-more" onClick={() => remove(m)} title="Delete milestone" aria-label={`Delete ${m.title}`}><Trash2 size={13} /></button>
                      </>
                    )}
                  </div>
                  {openId === m._id && (
                    <ul style={{ margin: '8px 0 0', paddingLeft: 16, fontSize: 10, lineHeight: 1.8 }}>
                      {openTasks === null && <li>Loading tasks…</li>}
                      {openTasks?.length === 0 && <li>No tasks attached yet.</li>}
                      {openTasks?.map((t) => (
                        <li key={t._id} className={t.status === 'Done' ? 'crossed' : ''}>{t.title} <small className="muted">· {t.status}</small></li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <div className="modal-back" onClick={() => setEditing(null)}>
          <form className="modal" onSubmit={save} onClick={(e) => e.stopPropagation()}>
            <div className="modal-top"><span className="modal-icon"><Flag size={19} /></span><button type="button" className="iconbtn" aria-label="Close" onClick={() => setEditing(null)}><X size={17} /></button></div>
            <h2>{editing === 'new' ? 'New milestone' : 'Edit milestone'}</h2>
            <p>A milestone groups tasks. Its progress is the share of its tasks that are Done.</p>
            <label>Title<input className="field-input" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. MVP ready for demo" maxLength={120} required /></label>
            <label>Description<textarea className="field-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What does done look like?" maxLength={1000} /></label>
            <label>Due date<input className="field-input" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></label>
            {formError && <div className="form-error" role="alert">{formError}</div>}
            <button className="btn full" type="submit" disabled={busy}>{busy ? 'Saving…' : editing === 'new' ? 'Create milestone' : 'Save changes'}</button>
          </form>
        </div>
      )}
    </div>
  );
}

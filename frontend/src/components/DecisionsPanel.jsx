import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Gavel, Link2, Pencil, Plus, RefreshCw, X } from 'lucide-react';
import { assetUrl, channelApi, decisionApi } from '../api';
import { canWriteDecisions } from '../roles';
import { AVATAR_TONES, Avatar, Btn, initialsOf } from './ui';

/*
 * [Sprint 3 · M8] The project's Decisions tab (US-35 record a decision, US-36 view and update decisions).
 *
 * Every member sees the list (title, date, participants, description, link, who recorded / last edited it).
 * Owners, Admins and Contributors also get "Record decision" and Edit. The API checks all of this again.
 *
 * Props
 *   projectId   the project
 *   myRole      'Owner' | 'Admin' | 'Contributor' | 'Viewer'
 *   members     [{ userId, name, username, avatarUrl }] current project members (from TeamPanel)
 *   tasks       [{ _id, title }] the project's tasks, for the "related task" picker
 *   api         decisionApi (tests pass a fake)
 *   chat        channelApi (list + messages), for the "related thread" picker
 *   onChange    called after a decision is saved (the page reloads the Activity tab)
 */

const EMPTY_FORM = { title: '', description: '', date: '', participants: [], linkType: '', taskId: '', channelId: '', messageId: '' };

// "2026-10-20T00:00:00.000Z" -> "2026-10-20" for <input type="date">.
const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');
// A decision date is a calendar day stored as midnight UTC, so it is shown in UTC (same day for everyone).
export const formatDecisionDate = (value) => (value
  ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  : '');

const idOf = (value) => String(value?._id || value?.userId || value || '');
const shortText = (text, max = 60) => {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

export function formFromDecision(decision) {
  if (!decision) return EMPTY_FORM;
  const link = decision.link || null;
  return {
    title: decision.title || '',
    description: decision.description || '',
    date: toDateInput(decision.date),
    participants: (decision.participants || []).map(idOf),
    linkType: link?.type || '',
    taskId: link?.type === 'task' ? link.id : '',
    channelId: link?.type === 'thread' ? (link.channelId || '') : '',
    messageId: link?.type === 'thread' ? link.id : '',
  };
}

// Same checks as the API (backend/src/lib/decisions.js), so the person sees the problem before sending.
export function validateDecisionForm(form) {
  if (!form.title.trim()) return 'Title is required.';
  if (!form.description.trim()) return 'Description is required.';
  if (form.participants.length === 0) return 'Add at least one participant.';
  if (!form.date) return 'Decision date is required.';
  if (form.linkType === 'task' && !form.taskId) return 'Choose the related task, or pick "No link".';
  if (form.linkType === 'thread' && !form.messageId) return 'Choose the related thread, or pick "No link".';
  return '';
}

const linkKey = (form) => (form.linkType === 'task' ? `task:${form.taskId}` : form.linkType === 'thread' ? `thread:${form.messageId}` : '');

// The request body. On edit the link is only sent when it was changed, so an old link to a
// deleted task does not block saving other changes.
export function decisionPayload(form, original = null) {
  const payload = {
    title: form.title.trim(),
    description: form.description.trim(),
    date: form.date,
    participants: form.participants,
  };
  const changedLink = !original || linkKey(form) !== linkKey(formFromDecision(original));
  if (changedLink) {
    if (form.linkType === 'task') payload.link = { type: 'task', id: form.taskId };
    else if (form.linkType === 'thread') payload.link = { type: 'thread', id: form.messageId };
    else if (original) payload.link = null;
  }
  return payload;
}

function DecisionLink({ link }) {
  if (!link) return null;
  const what = link.type === 'task' ? 'task' : 'thread';
  if (link.missing || !link.href) {
    // <small>, not <span>: .milestone-copy span is styled as an accent label, and this must not look clickable.
    return <small style={{ fontSize: 9, color: 'var(--muted)', fontStyle: 'italic' }}><Link2 size={10} style={{ verticalAlign: '-1px' }} /> Linked {what} no longer exists</small>;
  }
  return (
    <Link className="link" to={link.href} title={`Open the related ${what}`} style={{ marginTop: 0, padding: 0 }}>
      <Link2 size={11} style={{ verticalAlign: '-1px' }} /> {link.type === 'task' ? 'Task' : 'Thread'}: {link.label}
    </Link>
  );
}

export default function DecisionsPanel({ projectId, myRole, members = [], tasks = [], api = decisionApi, chat = channelApi, onChange }) {
  const [decisions, setDecisions] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(null); // null = closed, 'new' or a decision
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [channels, setChannels] = useState(null);
  const [threads, setThreads] = useState(null);

  const canWrite = canWriteDecisions(myRole);

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await api.list(projectId);
      setDecisions(result.decisions || []);
    } catch (e) {
      setDecisions([]);
      setError(e.message || 'Could not load decisions.');
    }
  }, [api, projectId]);

  useEffect(() => { setDecisions(null); }, [projectId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Channels for the thread picker, loaded the first time "Channel thread" is chosen.
  useEffect(() => {
    if (!editing || form.linkType !== 'thread' || channels !== null) return undefined;
    let active = true;
    chat.list(projectId)
      .then((result) => {
        if (!active) return;
        const list = result.channels || [];
        setChannels(list);
        setForm((current) => (current.channelId || !list[0] ? current : { ...current, channelId: String(list[0]._id) }));
      })
      .catch(() => { if (active) setChannels([]); });
    return () => { active = false; };
  }, [chat, channels, editing, form.linkType, projectId]);

  // Recent top-level messages (threads) of the chosen channel.
  useEffect(() => {
    if (!editing || form.linkType !== 'thread' || !form.channelId) { setThreads(null); return undefined; }
    let active = true;
    setThreads(null);
    chat.messages(projectId, form.channelId, { limit: 50 })
      .then((result) => { if (active) setThreads([...(result.messages || [])].reverse()); })
      .catch(() => { if (active) setThreads([]); });
    return () => { active = false; };
  }, [chat, editing, form.linkType, form.channelId, projectId]);

  const openForm = (decision) => {
    setFormError('');
    setEditing(decision || 'new');
    setForm(formFromDecision(decision));
  };

  const close = () => { if (!busy) setEditing(null); };

  const toggleParticipant = (userId) => {
    setForm((current) => ({
      ...current,
      participants: current.participants.includes(userId)
        ? current.participants.filter((id) => id !== userId)
        : [...current.participants, userId],
    }));
  };

  const save = async (e) => {
    e.preventDefault();
    const problem = validateDecisionForm(form);
    if (problem) { setFormError(problem); return; }
    setBusy(true); setFormError('');
    const isNew = editing === 'new';
    try {
      if (isNew) await api.create(projectId, decisionPayload(form));
      else await api.update(projectId, editing._id, decisionPayload(form, editing));
      setNotice(isNew ? 'Decision recorded.' : 'Decision saved.');
      setEditing(null);
      await load();
      onChange?.();
    } catch (err) {
      setFormError(err.message || 'Could not save the decision.');
    } finally {
      setBusy(false);
    }
  };

  if (decisions === null) return <div className="task-empty"><Gavel size={20} /><p>Loading decisions…</p></div>;

  // People on the decision who are no longer project members stay ticked so an edit keeps them.
  const memberIds = new Set(members.map(idOf));
  const formerParticipants = editing && editing !== 'new'
    ? (editing.participants || []).filter((p) => !memberIds.has(idOf(p)))
    : [];
  // An existing thread link that is not among the 50 latest messages is still offered.
  const savedThread = editing && editing !== 'new' && editing.link?.type === 'thread' && !editing.link.missing
    && editing.link.channelId === form.channelId ? editing.link : null;
  const threadOptions = threads || [];
  const showSavedThread = savedThread && !threadOptions.some((m) => idOf(m) === savedThread.id);
  const savedTaskMissing = editing && editing !== 'new' && editing.link?.type === 'task' && editing.link.missing && form.taskId === editing.link.id;

  return (
    <div>
      {canWrite && (
        <div className="task-toolbar" style={{ justifyContent: 'flex-end' }}>
          <Btn className="small" icon={Plus} onClick={() => openForm(null)}>Record decision</Btn>
        </div>
      )}
      {notice && <p className="success-inline" role="status">{notice}</p>}
      {error && (
        <div className="form-error" role="alert" style={{ margin: '10px 0' }}>
          {error} <button className="link" onClick={load}><RefreshCw size={12} /> Try again</button>
        </div>
      )}

      {!error && decisions.length === 0 && (
        <div className="task-empty">
          <Gavel size={20} />
          <p>{canWrite ? 'No decisions yet. Record one so the team remembers why a choice was made.' : 'No decisions recorded yet.'}</p>
        </div>
      )}

      <div className="milestone-list" aria-label="Decisions">
        {decisions.map((d) => {
          const edited = d.updatedBy && d.updatedAt && d.updatedAt !== d.createdAt;
          return (
            <article className="milestone" key={d._id} data-testid="decision">
              <div className="milestone-status violet"><Gavel size={13} /></div>
              <div className="milestone-copy">
                <div>
                  <b>{d.title}</b>
                  <span><CalendarDays size={10} style={{ verticalAlign: '-1px' }} /> {formatDecisionDate(d.date)}</span>
                </div>
                <p style={{ whiteSpace: 'pre-wrap' }}>{d.description}</p>
                <div className="task-meta" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <span className="stack" aria-label="Participants">
                    {(d.participants || []).map((p, i) => (
                      <Avatar key={idOf(p)} initials={initialsOf(p.name)} src={assetUrl(p.avatarUrl)} tone={AVATAR_TONES[i % 4]} small />
                    ))}
                  </span>
                  <small className="muted">{(d.participants || []).map((p) => p.name).join(', ')}</small>
                  <DecisionLink link={d.link} />
                  {canWrite && (
                    <button className="task-more" onClick={() => openForm(d)} title="Edit decision" aria-label={`Edit ${d.title}`}><Pencil size={13} /></button>
                  )}
                </div>
                <small className="muted" style={{ display: 'block', marginTop: 6 }}>
                  Recorded by {d.createdBy?.name || 'a former member'}
                  {edited ? ` · Edited by ${d.updatedBy.name || 'a former member'} on ${formatDecisionDate(d.updatedAt)}` : ''}
                </small>
              </div>
            </article>
          );
        })}
      </div>

      {editing && (
        <div className="modal-back" onClick={close}>
          <form className="modal" onSubmit={save} onClick={(e) => e.stopPropagation()} noValidate style={{ maxHeight: 'calc(100vh - 36px)', overflowY: 'auto' }}>
            <div className="modal-top"><span className="modal-icon"><Gavel size={19} /></span><button type="button" className="iconbtn" aria-label="Close" onClick={close}><X size={17} /></button></div>
            <h2>{editing === 'new' ? 'Record decision' : 'Edit decision'}</h2>
            <p>Keep the reason behind a project choice, who made it and when.</p>
            <label>Title<input className="field-input" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Use MongoDB for the task store" maxLength={120} /></label>
            <label>Description<textarea className="field-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What was decided and why?" maxLength={2000} /></label>
            <label>Date<input className="field-input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>

            <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <legend style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 600, marginBottom: 6, padding: 0 }}>Participants</legend>
              <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {members.length === 0 && formerParticipants.length === 0 && <small className="muted">Loading members…</small>}
                {members.map((m) => (
                  <label className="check" key={idOf(m)}>
                    <input type="checkbox" style={{ width: 'auto', padding: 0 }} checked={form.participants.includes(idOf(m))} onChange={() => toggleParticipant(idOf(m))} />
                    {m.name}{m.username ? <small className="muted"> @{m.username}</small> : null}
                  </label>
                ))}
                {formerParticipants.map((p) => (
                  <label className="check" key={idOf(p)}>
                    <input type="checkbox" style={{ width: 'auto', padding: 0 }} checked={form.participants.includes(idOf(p))} onChange={() => toggleParticipant(idOf(p))} />
                    {p.name}<small className="muted"> (no longer a member)</small>
                  </label>
                ))}
              </div>
            </fieldset>

            <label>Related task or thread
              <select className="field-input" value={form.linkType} onChange={(e) => setForm({ ...form, linkType: e.target.value })}>
                <option value="">No link</option>
                <option value="task">Task</option>
                <option value="thread">Channel thread</option>
              </select>
            </label>
            {form.linkType === 'task' && (
              <label>Task
                <select className="field-input" value={form.taskId} onChange={(e) => setForm({ ...form, taskId: e.target.value })}>
                  <option value="">Choose a task…</option>
                  {savedTaskMissing && <option value={form.taskId}>(deleted task)</option>}
                  {tasks.map((t) => <option key={idOf(t)} value={idOf(t)}>{t.title}</option>)}
                </select>
              </label>
            )}
            {savedTaskMissing && <small className="muted" style={{ fontSize: 9 }}>The linked task was deleted. Pick another task or "No link".</small>}
            {form.linkType === 'thread' && (
              <>
                <label>Channel
                  <select className="field-input" value={form.channelId} onChange={(e) => setForm({ ...form, channelId: e.target.value, messageId: '' })}>
                    <option value="">{channels === null ? 'Loading channels…' : channels.length ? 'Choose a channel…' : 'No channels'}</option>
                    {channels?.map((c) => <option key={idOf(c)} value={idOf(c)}>#{c.name}</option>)}
                  </select>
                </label>
                <label>Thread
                  <select className="field-input" value={form.messageId} onChange={(e) => setForm({ ...form, messageId: e.target.value })}>
                    <option value="">{threads === null ? 'Loading messages…' : 'Choose a message…'}</option>
                    {showSavedThread && <option value={savedThread.id}>{savedThread.label}</option>}
                    {threadOptions.map((m) => (
                      <option key={idOf(m)} value={idOf(m)}>{m.author?.name ? `${m.author.name}: ` : ''}{shortText(m.body)}</option>
                    ))}
                  </select>
                </label>
              </>
            )}

            {formError && <div className="form-error" role="alert">{formError}</div>}
            <button className="btn full" type="submit" disabled={busy}>{busy ? 'Saving…' : editing === 'new' ? 'Record decision' : 'Save changes'}</button>
          </form>
        </div>
      )}
    </div>
  );
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 3 · M8] What this file does
 * Decisions tab: list of the project's decisions (title, date, participants,
 * description, link to the related task or thread) and a form to record or edit
 * one. Validation errors keep the form open and nothing is sent.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, Eye, FileText, Pencil, Plus, RefreshCw } from 'lucide-react';
import { docApi } from '../api';
import { canWriteDocs } from '../roles';
import { Btn } from './ui';
import Markdown from './markdown';

/*
 * [Sprint 4 · M6] The project's Docs tab (US-38 Write a documentation page, FR-14b).
 *
 * Every member sees the list of pages and can open one; it is shown as formatted text by the
 * safe Markdown renderer (markdown.jsx). Owners, Admins and Contributors also get "New page" and
 * "Edit": a title, a Markdown box with Write / Preview, and a live "1,234 / 10,000" counter.
 * Saving is blocked over 10,000 characters here, and the API enforces the limit again.
 *
 * Props
 *   projectId   the project
 *   myRole      'Owner' | 'Admin' | 'Contributor' | 'Viewer'
 *   docId       page to open (from the URL, ?tab=docs&doc=<id>); '' shows the list
 *   onOpenDoc   (docId | '') => void   puts the open page in the URL (optional)
 *   api         docApi (tests pass a fake)
 */

export const DOC_CONTENT_MAX = 10000; // same as backend/src/lib/docs.js
export const DOC_TITLE_MAX = 120;
const EMPTY_FORM = { title: '', content: '' };

// Same counting as the API: Windows line endings count as one character.
export const docLength = (content) => String(content || '').replace(/\r\n?/g, '\n').length;
export const formatCount = (n) => `${n.toLocaleString('en-US')} / ${DOC_CONTENT_MAX.toLocaleString('en-US')}`;

// Same checks as the API (backend/src/lib/docs.js), so the person sees the problem before sending.
export function validateDocForm(form) {
  if (!form.title.trim()) return 'Title is required.';
  if (!form.content.trim()) return 'Write some content before saving.';
  if (docLength(form.content) > DOC_CONTENT_MAX) return 'Content must be 10,000 characters or fewer.';
  return '';
}

const formatWhen = (value) => (value
  ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  : '');

function byline(doc) {
  const edited = doc.updatedBy && doc.updatedAt && doc.updatedAt !== doc.createdAt;
  if (edited) return `Edited by ${doc.updatedBy.name || 'a former member'} · ${formatWhen(doc.updatedAt)}`;
  return `Created by ${doc.createdBy?.name || 'a former member'} · ${formatWhen(doc.createdAt)}`;
}

export default function DocsPanel({ projectId, myRole, docId = '', onOpenDoc, api = docApi }) {
  const [docs, setDocs] = useState(null);
  const [listError, setListError] = useState('');
  const [openId, setOpenId] = useState(docId);
  const [openDoc, setOpenDoc] = useState(null);
  const [openError, setOpenError] = useState('');
  const [editing, setEditing] = useState(null); // null, 'new' or the page being edited
  const [form, setForm] = useState(EMPTY_FORM);
  const [view, setView] = useState('write'); // 'write' | 'preview'
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const canWrite = canWriteDocs(myRole);

  // The URL can change the open page (a link, the back button).
  useEffect(() => { setOpenId(docId || ''); }, [docId]);

  const open = useCallback((id) => {
    setOpenId(id || '');
    setEditing(null);
    onOpenDoc?.(id || '');
  }, [onOpenDoc]);

  const loadList = useCallback(async () => {
    setListError('');
    try {
      const result = await api.list(projectId);
      setDocs(result.docs || []);
    } catch (e) {
      setDocs([]);
      setListError(e.message || 'Could not load the documentation.');
    }
  }, [api, projectId]);

  useEffect(() => { setDocs(null); loadList(); }, [loadList]);

  useEffect(() => {
    if (!openId) { setOpenDoc(null); setOpenError(''); return undefined; }
    let active = true;
    setOpenDoc(null); setOpenError('');
    api.get(projectId, openId)
      .then((result) => { if (active) setOpenDoc(result.doc); })
      .catch((e) => { if (active) setOpenError(e.status === 404 || e.status === 400 ? 'This page could not be found.' : (e.message || 'Could not open the page.')); });
    return () => { active = false; };
  }, [api, projectId, openId]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  const startEdit = (doc) => {
    setEditing(doc || 'new');
    setForm(doc ? { title: doc.title, content: doc.content } : EMPTY_FORM);
    setView('write');
    setFormError('');
  };

  const cancelEdit = () => { if (!busy) { setEditing(null); setFormError(''); } };

  const save = async (e) => {
    e.preventDefault();
    const problem = validateDocForm(form);
    if (problem) { setFormError(problem); return; }
    setBusy(true); setFormError('');
    const isNew = editing === 'new';
    try {
      const payload = { title: form.title.trim(), content: form.content };
      const result = isNew ? await api.create(projectId, payload) : await api.update(projectId, editing._id, payload);
      setEditing(null);
      setNotice(isNew ? 'Page created.' : 'Page saved.');
      await loadList();
      if (isNew) open(result.doc._id);
      else setOpenDoc(result.doc);
    } catch (err) {
      setFormError(err.message || 'Could not save the page.');
    } finally {
      setBusy(false);
    }
  };

  const toast = notice ? <p className="success-inline" role="status">{notice}</p> : null;

  // ---- Editor (new page or edit) ----------------------------------------------------------
  if (editing) {
    const length = docLength(form.content);
    const over = length > DOC_CONTENT_MAX;
    return (
      <form onSubmit={save} noValidate aria-label={editing === 'new' ? 'New page' : 'Edit page'} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="task-toolbar" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="link" style={{ marginTop: 0 }} onClick={cancelEdit}><ArrowLeft size={13} /> Cancel</button>
          <b style={{ fontSize: 12 }}>{editing === 'new' ? 'New documentation page' : 'Edit page'}</b>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>
          Title
          <input className="field-input" value={form.title} maxLength={DOC_TITLE_MAX} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Local setup" autoFocus />
        </label>
        <div className="switch-tabs" role="tablist" aria-label="Editor view">
          <button type="button" role="tab" aria-selected={view === 'write'} className={view === 'write' ? 'active' : ''} onClick={() => setView('write')}><Pencil size={12} /> Write</button>
          <button type="button" role="tab" aria-selected={view === 'preview'} className={view === 'preview' ? 'active' : ''} onClick={() => setView('preview')}><Eye size={12} /> Preview</button>
        </div>
        {view === 'write' ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>
            Content (Markdown)
            <textarea
              className="field-input"
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              rows={16}
              spellCheck
              placeholder={'# Heading\n\nWrite **bold**, *italic*, `code`, lists with - or 1., > quotes and [links](https://example.com).'}
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', minHeight: 260 }}
            />
          </label>
        ) : (
          <div style={{ minHeight: 260, padding: 12, border: '1px solid var(--line)', borderRadius: 10 }} data-testid="doc-preview">
            {form.content.trim() ? <Markdown text={form.content} /> : <p className="muted" style={{ fontSize: 11 }}>Nothing to preview yet.</p>}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <small data-testid="doc-counter" aria-live="polite" style={{ fontSize: 10, fontWeight: over ? 700 : 400, color: over ? 'var(--danger, #e5484d)' : 'var(--muted)' }}>
            {formatCount(length)}{over ? ' — too long' : ''}
          </small>
          <Btn type="submit" disabled={busy}>{busy ? 'Saving…' : editing === 'new' ? 'Create page' : 'Save page'}</Btn>
        </div>
        {formError && <div className="form-error" role="alert">{formError}</div>}
      </form>
    );
  }

  // ---- One page --------------------------------------------------------------------------
  if (openId) {
    return (
      <div>
        <div className="task-toolbar" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="link" style={{ marginTop: 0 }} onClick={() => open('')}><ArrowLeft size={13} /> All pages</button>
          {canWrite && openDoc && <Btn className="small" icon={Pencil} onClick={() => startEdit(openDoc)}>Edit</Btn>}
        </div>
        {toast}
        {openError && <div className="form-error" role="alert" style={{ margin: '10px 0' }}>{openError}</div>}
        {!openError && !openDoc && <div className="task-empty"><BookOpen size={20} /><p>Opening page…</p></div>}
        {openDoc && (
          <article aria-label={openDoc.title}>
            <h3 style={{ font: '700 20px Manrope, sans-serif', margin: '6px 0 4px' }}>{openDoc.title}</h3>
            <small className="muted" style={{ display: 'block', fontSize: 10, marginBottom: 14 }}>{byline(openDoc)}</small>
            <Markdown text={openDoc.content} />
          </article>
        )}
      </div>
    );
  }

  // ---- Page list -------------------------------------------------------------------------
  if (docs === null) return <div className="task-empty"><BookOpen size={20} /><p>Loading documentation…</p></div>;

  return (
    <div>
      {canWrite && (
        <div className="task-toolbar" style={{ justifyContent: 'flex-end' }}>
          <Btn className="small" icon={Plus} onClick={() => startEdit(null)}>New page</Btn>
        </div>
      )}
      {toast}
      {listError && (
        <div className="form-error" role="alert" style={{ margin: '10px 0' }}>
          {listError} <button className="link" onClick={loadList}><RefreshCw size={12} /> Try again</button>
        </div>
      )}
      {!listError && docs.length === 0 && (
        <div className="task-empty">
          <BookOpen size={20} />
          <p>{canWrite ? 'No documentation yet. Create a page for setup steps, conventions or decisions worth keeping.' : 'No documentation pages yet.'}</p>
        </div>
      )}
      <div className="milestone-list" aria-label="Documentation pages">
        {docs.map((doc) => (
          <button type="button" key={doc._id} className="milestone" data-testid="doc-row" onClick={() => open(doc._id)}
            style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 0, padding: 0, color: 'inherit', cursor: 'pointer' }}>
            <div className="milestone-status violet"><FileText size={13} /></div>
            <div className="milestone-copy">
              <div><b>{doc.title}</b></div>
              {doc.preview && <p style={{ margin: '4px 0 4px' }}>{doc.preview}</p>}
              <small className="muted" style={{ display: 'block' }}>{byline(doc)}</small>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 4 · M6] What this file does
 * Docs tab: list of the project's Markdown pages, a page view rendered safely
 * as formatted text, and an editor (title, Write/Preview, 10,000-character
 * counter) for Owners, Admins and Contributors.
 * ---------------------------------------------------------------------------
 */

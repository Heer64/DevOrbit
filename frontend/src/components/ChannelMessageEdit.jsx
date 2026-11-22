import { useCallback, useEffect, useRef, useState } from 'react';
import { Ban, Check, Loader2, Pencil, Trash2 } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';
import MentionTextarea from './MentionTextarea';
import MentionText from './MentionText';
import { CHANNEL_DELETED_TEXT, CHANNEL_MESSAGE_MAX, checkEdit, idOf } from '../channelMessages';

/*
 * [Sprint 7 · M1] Edit and delete your own channel messages and thread replies.
 * Shared by ChatPanel (channel messages) and ThreadPanel (the thread's first message and its replies).
 *
 *   const edits = useChannelMessageEdits({ api, projectId, channelId, onChanged });
 *   <ChannelMessageText message={m} />                           text, "edited", or "Message deleted"
 *   <ChannelMessageActions message={m} edits={edits} canEdit canDelete />   Edit / Delete buttons
 *   <ChannelMessageEditForm message={m} edits={edits} members currentUserId />   inline edit box
 *   <DeleteMessageDialog edits={edits} />                        "Delete this message?" confirmation
 *
 * api.edit(projectId, channelId, messageId, body) and api.remove(projectId, channelId, messageId) both answer
 * { message, changed, notice }. onChanged(message) receives the saved copy so the caller can show it at once
 * (the live 'message:updated' event brings the same copy to everyone else).
 */
export function useChannelMessageEdits({ api, projectId, channelId, onChanged }) {
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const editsOn = Boolean(api?.edit);
  const deletesOn = Boolean(api?.remove);

  const startEdit = useCallback((message) => {
    setEditingId(idOf(message));
    setDraft(message.body || '');
    setEditError('');
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId('');
    setDraft('');
    setEditError('');
  }, []);

  const saveEdit = async (message) => {
    if (editBusy) return;
    const checked = checkEdit(message, draft);
    if (!checked.ok) { setEditError(checked.message); return; }
    if (checked.unchanged) { cancelEdit(); return; } // same text: not marked "edited"
    setEditBusy(true); setEditError('');
    try {
      const result = await api.edit(projectId, channelId, idOf(message), checked.body);
      if (result?.message) onChangedRef.current?.(result.message);
      cancelEdit();
    } catch (error) {
      if (error?.status === 409) {
        // Deleted in the meantime (e.g. in another tab): show it as deleted.
        onChangedRef.current?.({ ...message, deleted: true, edited: false, body: '', mentions: [] });
        cancelEdit();
      } else {
        setEditError(error?.message || 'Could not save your changes. Please try again.');
      }
    } finally {
      setEditBusy(false);
    }
  };

  const askDelete = useCallback((message) => { setPendingDelete(message); setDeleteError(''); }, []);
  const cancelDelete = useCallback(() => { if (!deleteBusy) setPendingDelete(null); }, [deleteBusy]);

  const confirmDelete = async () => {
    if (!pendingDelete || deleteBusy) return;
    setDeleteBusy(true); setDeleteError('');
    try {
      const result = await api.remove(projectId, channelId, idOf(pendingDelete));
      if (result?.message) onChangedRef.current?.(result.message);
      if (editingId === idOf(pendingDelete)) cancelEdit();
      setPendingDelete(null);
    } catch (error) {
      setDeleteError(error?.message || 'Could not delete the message. Please try again.');
    } finally {
      setDeleteBusy(false);
    }
  };

  // A message deleted live (by me in another tab) closes its edit box and its pending confirmation.
  const forget = useCallback((message) => {
    if (!message?.deleted) return;
    const id = idOf(message);
    setEditingId((current) => (current === id ? '' : current));
    setPendingDelete((current) => (current && idOf(current) === id ? null : current));
  }, []);

  return {
    editsOn, deletesOn, editingId, draft, setDraft, editBusy, editError,
    startEdit, cancelEdit, saveEdit, pendingDelete, askDelete, cancelDelete, confirmDelete, deleteBusy, deleteError, forget,
  };
}

// The text of a message, with "edited", or the "Message deleted" placeholder.
export function ChannelMessageText({ message }) {
  if (message.deleted) {
    return (
      <p className="chat-deleted-text">
        <Ban size={12} aria-hidden="true" /> {CHANNEL_DELETED_TEXT}
      </p>
    );
  }
  return (
    <p>
      <MentionText body={message.body} mentions={message.mentions} />
      {message.edited && (
        <span className="chat-edited" title={message.editedAt ? `Edited ${new Date(message.editedAt).toLocaleString()}` : 'Edited'}> (edited)</span>
      )}
    </p>
  );
}

// Edit / Delete buttons on my own message (shown on hover or keyboard focus, always on touch screens).
export function ChannelMessageActions({ message, edits, canEdit = false, canDelete = false }) {
  const showEdit = canEdit && edits.editsOn && edits.editingId !== idOf(message);
  const showDelete = canDelete && edits.deletesOn;
  if (!showEdit && !showDelete) return null;
  return (
    <span className="chat-actions">
      {showEdit && (
        <button type="button" className="chat-action" aria-label="Edit message" title="Edit" onClick={() => edits.startEdit(message)}>
          <Pencil size={12} />
        </button>
      )}
      {showDelete && (
        <button type="button" className="chat-action danger" aria-label="Delete message" title="Delete" onClick={() => edits.askDelete(message)}>
          <Trash2 size={12} />
        </button>
      )}
    </span>
  );
}

// The inline edit box. Enter saves, Shift+Enter = new line, Escape cancels. @ suggests members, like sending.
export function ChannelMessageEditForm({ message, edits, members = [], currentUserId = '' }) {
  const boxRef = useRef(null);
  useEffect(() => {
    const box = boxRef.current?.querySelector('textarea');
    if (!box) return;
    box.focus();
    const end = box.value.length;
    box.setSelectionRange?.(end, end);
  }, []);
  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); edits.cancelEdit(); }
  };
  return (
    <form
      className="chat-edit"
      ref={boxRef}
      onKeyDown={onKeyDown}
      onSubmit={(event) => { event.preventDefault(); edits.saveEdit(message); }}
    >
      <MentionTextarea
        value={edits.draft}
        onChange={edits.setDraft}
        onSubmit={() => edits.saveEdit(message)}
        members={members}
        currentUserId={currentUserId}
        label="Edit your message"
        rows={Math.min(6, Math.max(2, String(edits.draft).split('\n').length))}
        maxLength={CHANNEL_MESSAGE_MAX}
        disabled={edits.editBusy}
      />
      <div className="chat-edit-actions">
        <small>Enter to save · Esc to cancel</small>
        <button type="button" className="btn secondary" onClick={edits.cancelEdit} disabled={edits.editBusy}>Cancel</button>
        <button type="submit" className="btn" disabled={edits.editBusy || !String(edits.draft).trim()}>
          {edits.editBusy ? <Loader2 size={13} className="spin" /> : <Check size={13} />} Save
        </button>
      </div>
      {edits.editError && <div className="form-error" role="alert">{edits.editError}</div>}
    </form>
  );
}

export function DeleteMessageDialog({ edits, isReply = false }) {
  return (
    <ConfirmDialog
      open={Boolean(edits.pendingDelete)}
      title={isReply ? 'Delete this reply?' : 'Delete this message?'}
      confirmLabel={isReply ? 'Delete reply' : 'Delete message'}
      danger
      busy={edits.deleteBusy}
      error={edits.deleteError}
      onConfirm={edits.confirmDelete}
      onCancel={edits.cancelDelete}
    >
      It will show as &ldquo;{CHANNEL_DELETED_TEXT}&rdquo; for everyone in the project.
      {isReply ? ' The rest of the thread stays.' : ' Replies in its thread stay.'} This can&rsquo;t be undone.
    </ConfirmDialog>
  );
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 7 · M1] What this file does
 * The edit / delete pieces of the project chat: the hook that saves an edit or
 * a delete, the "edited" / "Message deleted" text, the Edit and Delete buttons
 * on your own messages, the inline edit box and the delete confirmation.
 * ---------------------------------------------------------------------------
 */

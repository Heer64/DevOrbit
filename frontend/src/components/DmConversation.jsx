import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  Check,
  CheckCheck,
  Loader2,
  Lock,
  MessageCircle,
  Pencil,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react';
import { assetUrl, directMessageApi } from '../api';
import { Avatar, initialsOf } from './ui';
import { timeAgo } from './activityDisplay';
import ConfirmDialog from './ConfirmDialog';
import {
  DM_COUNTER_FROM,
  DM_DELETED_TEXT,
  DM_MAX,
  announceUnreadTotal,
  deliveryLabel,
  idOf,
  laterTime,
  mergeDirectMessages,
} from '../directMessages';

export const DM_NOT_FOUND = 'This conversation does not exist, or you are not part of it.';

/*
 * [Sprint 6 · M2] US-19 One direct conversation: history, live messages and the composer.
 *
 * - Loads the conversation header and the newest page of messages; "Show older messages" loads more.
 * - AC2: new messages from the other person arrive live ('dm:message'), and are marked read while this
 *   conversation is open and the tab is visible. Only the two participants ever receive them.
 * - Enter sends, Shift+Enter starts a new line. 1-4,000 characters (the server checks again).
 * - [Sprint 7 · M2] My own messages have Edit and Delete. An edited message shows "edited"; a deleted one stays
 *   in place as "Message deleted" for both of us. Changes arrive live ('dm:updated').
 * - [Sprint 7 · M2] My own messages show "Sent", and "Seen" once the other person has opened the conversation
 *   (otherReadAt from the API, moved forward live by 'dm:seen').
 *
 * Props
 *   conversationId   which conversation (from the URL)
 *   summary          its inbox row, if the page already has it (shows the header at once)
 *   meId             the signed-in user's ID, to tell my messages from theirs
 *   api              directMessageApi (tests pass a fake)
 *   onUpdate(conversation)          a newer inbox row (after sending, or after loading)
 *   onRead(conversationId, unreadTotal)   after the conversation was marked read
 */
export default function DmConversation({ conversationId, summary = null, meId = '', api = directMessageApi, onUpdate, onRead }) {
  const [conversation, setConversation] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [messages, setMessages] = useState(null);
  const [nextBefore, setNextBefore] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  // [Sprint 7 · M2] Sent / Seen, edit and delete
  const [otherReadAt, setOtherReadAt] = useState(null);
  const [editingId, setEditingId] = useState('');
  const [editDraft, setEditDraft] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const stickToBottom = useRef(true);
  const pendingLive = useRef([]); // live messages that arrived while the first page was loading
  const unseen = useRef(false); // a message arrived while the tab was hidden
  const onUpdateRef = useRef(onUpdate);
  const onReadRef = useRef(onRead);
  onUpdateRef.current = onUpdate;
  onReadRef.current = onRead;

  const header = summary && idOf(summary) === conversationId ? summary : conversation;
  const other = header?.otherUser || {};
  const otherName = other.name || 'this person';

  const markRead = useCallback(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      unseen.current = true;
      return;
    }
    unseen.current = false;
    Promise.resolve(api.markRead(conversationId))
      .then((result) => {
        onReadRef.current?.(conversationId, result?.unreadTotal);
        announceUnreadTotal(result?.unreadTotal);
      })
      .catch(() => {}); // the unread badge simply stays until the next visit
  }, [api, conversationId]);

  // The conversation and its newest messages.
  useEffect(() => {
    let active = true;
    setConversation(null);
    setLoadError('');
    setMessages(null);
    setNextBefore(null);
    setSendError('');
    setOtherReadAt(null);
    setEditingId('');
    setPendingDelete(null);
    stickToBottom.current = true;
    Promise.all([api.conversation(conversationId), api.messages(conversationId)])
      .then(([one, page]) => {
        if (!active) return;
        setConversation(one.conversation);
        if (one.conversation) onUpdateRef.current?.(one.conversation);
        setOtherReadAt((old) => laterTime(old, laterTime(one.conversation?.otherReadAt, page.otherReadAt)));
        setMessages(mergeDirectMessages(page.messages || [], pendingLive.current));
        pendingLive.current = [];
        setNextBefore(page.nextBefore || null);
        markRead();
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(error?.status === 404 || error?.status === 400 ? DM_NOT_FOUND : error?.message || 'Could not load this conversation.');
      });
    return () => {
      active = false;
    };
  }, [api, conversationId, reloadKey, markRead]);

  // AC2: live messages for this conversation (the other person's, and mine from another tab).
  useEffect(() => {
    if (!api.onMessage) return undefined;
    return api.onMessage((payload) => {
      if (String(payload?.conversationId) !== conversationId || !payload.message) return;
      setMessages((old) => {
        if (old) return mergeDirectMessages(old, [payload.message]);
        pendingLive.current = mergeDirectMessages(pendingLive.current, [payload.message]);
        return old;
      });
      // [Sprint 7 · M2] When the other person sends, they have read everything before it ("Seen").
      if (payload.conversation?.otherReadAt) setOtherReadAt((old) => laterTime(old, payload.conversation.otherReadAt));
      if (idOf(payload.message.sender) !== String(meId)) markRead();
    });
  }, [api, conversationId, meId, markRead]);

  // [Sprint 7 · M2] A message in this conversation was edited or deleted (by me in another tab, or by them).
  useEffect(() => {
    if (!api.onUpdated) return undefined;
    return api.onUpdated((payload) => {
      if (String(payload?.conversationId) !== conversationId || !payload.message) return;
      setMessages((old) => {
        if (old) return mergeDirectMessages(old, [payload.message]);
        pendingLive.current = mergeDirectMessages(pendingLive.current, [payload.message]);
        return old;
      });
      if (payload.conversation?.otherReadAt) setOtherReadAt((old) => laterTime(old, payload.conversation.otherReadAt));
      if (payload.message.deleted) {
        setEditingId((current) => (current === idOf(payload.message) ? '' : current));
        setPendingDelete((current) => (current && idOf(current) === idOf(payload.message) ? null : current));
      }
    });
  }, [api, conversationId]);

  // [Sprint 7 · M2] The other person opened the conversation: my messages up to readAt are "Seen".
  useEffect(() => {
    if (!api.onSeen) return undefined;
    return api.onSeen((payload) => {
      if (String(payload?.conversationId) === conversationId && payload.readAt) setOtherReadAt((old) => laterTime(old, payload.readAt));
    });
  }, [api, conversationId]);

  // A message that arrived in a background tab is marked read when the tab is shown again.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVisible = () => {
      if (document.visibilityState !== 'hidden' && unseen.current) markRead();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [markRead]);

  // Keep the newest message in view unless the reader scrolled up to read history.
  useEffect(() => {
    const box = listRef.current;
    if (box && messages && stickToBottom.current) box.scrollTop = box.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const box = listRef.current;
    if (box) stickToBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  };

  const loadOlder = async () => {
    if (!nextBefore || loadingOlder) return;
    setLoadingOlder(true);
    stickToBottom.current = false;
    try {
      const page = await api.messages(conversationId, { before: nextBefore });
      setMessages((old) => mergeDirectMessages(old || [], page.messages || []));
      setNextBefore(page.nextBefore || null);
    } catch (error) {
      setSendError(error?.message || 'Could not load older messages.');
    } finally {
      setLoadingOlder(false);
    }
  };

  const send = async (event) => {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || sending || messages === null) return;
    if (body.length > DM_MAX) {
      setSendError(`Message must be ${DM_MAX.toLocaleString('en-US')} characters or fewer.`);
      return;
    }
    setSending(true);
    setSendError('');
    stickToBottom.current = true;
    try {
      const result = await api.send(conversationId, body);
      if (result?.message) setMessages((old) => mergeDirectMessages(old || [], [result.message]));
      setDraft('');
      if (result?.conversation) onUpdateRef.current?.(result.conversation);
      if (result?.conversation?.otherReadAt) setOtherReadAt((old) => laterTime(old, result.conversation.otherReadAt));
    } catch (error) {
      setSendError(error?.message || 'Could not send the message. Please try again.');
    } finally {
      setSending(false);
      inputRef.current?.focus?.();
    }
  };

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing) send(event);
  };

  // [Sprint 7 · M2] Edit my own message in place.
  const startEdit = (message) => {
    setEditingId(idOf(message));
    setEditDraft(message.body || '');
    setEditError('');
  };
  const cancelEdit = () => {
    setEditingId('');
    setEditDraft('');
    setEditError('');
  };
  const saveEdit = async (event, message) => {
    event?.preventDefault();
    if (editBusy) return;
    const body = editDraft.trim();
    if (!body) {
      setEditError('Message cannot be empty. To remove it, use Delete.');
      return;
    }
    if (body.length > DM_MAX) {
      setEditError(`Message must be ${DM_MAX.toLocaleString('en-US')} characters or fewer.`);
      return;
    }
    if (body === message.body) {
      cancelEdit(); // nothing changed, so it is not marked "edited"
      return;
    }
    setEditBusy(true);
    setEditError('');
    try {
      const result = await api.edit(conversationId, idOf(message), body);
      if (result?.message) setMessages((old) => mergeDirectMessages(old || [], [result.message]));
      if (result?.conversation) onUpdateRef.current?.(result.conversation);
      cancelEdit();
    } catch (error) {
      if (error?.status === 409) {
        // It was deleted in the meantime (e.g. in another tab).
        setMessages((old) => mergeDirectMessages(old || [], [{ ...message, deleted: true, edited: false, body: '' }]));
        cancelEdit();
        setSendError(error.message || 'This message was deleted, so it can no longer be edited.');
      } else {
        setEditError(error?.message || 'Could not save your changes. Please try again.');
      }
    } finally {
      setEditBusy(false);
    }
  };
  const onEditKeyDown = (event, message) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing) {
      saveEdit(event, message);
    }
  };

  // [Sprint 7 · M2] Delete my own message, after confirming.
  const askDelete = (message) => {
    setPendingDelete(message);
    setDeleteError('');
  };
  const confirmDelete = async () => {
    if (!pendingDelete || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      const result = await api.remove(conversationId, idOf(pendingDelete));
      if (result?.message) setMessages((old) => mergeDirectMessages(old || [], [result.message]));
      if (result?.conversation) onUpdateRef.current?.(result.conversation);
      if (editingId === idOf(pendingDelete)) cancelEdit();
      setPendingDelete(null);
    } catch (error) {
      setDeleteError(error?.message || 'Could not delete the message. Please try again.');
    } finally {
      setDeleteBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="dm-state error" role="alert">
        <AlertCircle size={20} />
        <p>{loadError}</p>
        {loadError !== DM_NOT_FOUND && (
          <button type="button" className="btn secondary" onClick={() => setReloadKey((key) => key + 1)}>
            <RefreshCw size={13} /> Try again
          </button>
        )}
        <Link className="link" to="/messages">
          Back to all messages
        </Link>
      </div>
    );
  }

  return (
    <section className="dm-conversation" aria-label={header ? `Conversation with ${otherName}` : 'Conversation'}>
      <header className="dm-conversation-head">
        <Link to="/messages" className="iconbtn dm-back" aria-label="Back to all messages">
          <ArrowLeft size={16} />
        </Link>
        {header ? (
          <>
            <Avatar initials={initialsOf(other.name)} src={assetUrl(other.avatarUrl)} small />
            <div className="dm-conversation-who">
              {other.username ? (
                <Link to={`/people/${encodeURIComponent(other.username)}`} title={`Open ${other.name}'s profile`}>
                  <b>{other.name}</b>
                </Link>
              ) : (
                <b>{other.name}</b>
              )}
              {other.username && <small>@{other.username}</small>}
            </div>
          </>
        ) : (
          <Loader2 size={16} className="spin" aria-label="Loading conversation" />
        )}
      </header>
      <p className="dm-private-note">
        <Lock size={11} aria-hidden="true" /> Private conversation: only you and {otherName} can read it. It is not part of any project
        channel.
      </p>

      <div className="dm-messages" ref={listRef} onScroll={onScroll} role="log" aria-label="Messages" aria-busy={messages === null}>
        {nextBefore && (
          <button type="button" className="link dm-older" onClick={loadOlder} disabled={loadingOlder}>
            {loadingOlder ? 'Loading…' : 'Show older messages'}
          </button>
        )}
        {messages === null && (
          <div className="dm-state">
            <Loader2 size={18} className="spin" />
            <p>Loading messages…</p>
          </div>
        )}
        {messages && messages.length === 0 && (
          <div className="dm-empty">
            <MessageCircle size={20} />
            <p>No messages yet. Say hello to {otherName}.</p>
          </div>
        )}
        {(messages || []).map((message) => {
          const id = idOf(message);
          const mine = Boolean(meId) && idOf(message.sender) === String(meId);
          const deleted = Boolean(message.deleted);
          const editing = mine && !deleted && editingId === id;
          const status = deliveryLabel(message, meId, otherReadAt); // [Sprint 7 · M2] 'Sent' | 'Seen' | ''
          return (
            <article key={id} data-message-id={id} className={`dm-message ${mine ? 'mine' : 'theirs'}${deleted ? ' deleted' : ''}`}>
              {editing ? (
                <form className="dm-edit" onSubmit={(event) => saveEdit(event, message)}>
                  <textarea
                    value={editDraft}
                    onChange={(event) => setEditDraft(event.target.value)}
                    onKeyDown={(event) => onEditKeyDown(event, message)}
                    aria-label="Edit your message"
                    maxLength={DM_MAX}
                    rows={Math.min(6, Math.max(2, editDraft.split('\n').length))}
                    autoFocus
                  />
                  <div className="dm-edit-actions">
                    <button type="button" className="btn secondary" onClick={cancelEdit} disabled={editBusy}>
                      Cancel
                    </button>
                    <button type="submit" className="btn" disabled={editBusy || !editDraft.trim()}>
                      {editBusy ? <Loader2 size={13} className="spin" /> : <Check size={13} />} Save
                    </button>
                  </div>
                  {editError && (
                    <div className="form-error" role="alert">
                      {editError}
                    </div>
                  )}
                </form>
              ) : (
                <div className="dm-bubble">
                  {deleted ? (
                    <p className="dm-deleted-text">
                      <Ban size={12} aria-hidden="true" /> {DM_DELETED_TEXT}
                    </p>
                  ) : (
                    <p>{message.body}</p>
                  )}
                </div>
              )}
              <div className="dm-meta">
                <time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>
                  {mine ? 'You' : message.sender?.name || 'Deleted user'} · {timeAgo(message.createdAt)}
                </time>
                {message.edited && !deleted && (
                  <span className="dm-edited" title={message.editedAt ? `Edited ${new Date(message.editedAt).toLocaleString()}` : 'Edited'}>
                    · edited
                  </span>
                )}
                {status && (
                  <span className={`dm-status ${status.toLowerCase()}`} data-status={status.toLowerCase()}>
                    · {status === 'Seen' ? <CheckCheck size={12} aria-hidden="true" /> : <Check size={12} aria-hidden="true" />} {status}
                  </span>
                )}
                {mine && !deleted && !editing && (
                  <span className="dm-actions">
                    <button type="button" className="dm-action" aria-label="Edit message" title="Edit" onClick={() => startEdit(message)}>
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      className="dm-action danger"
                      aria-label="Delete message"
                      title="Delete"
                      onClick={() => askDelete(message)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <form className="dm-composer" onSubmit={send}>
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={header ? `Message ${otherName}` : 'Write a message'}
          aria-label="Write a direct message"
          maxLength={DM_MAX}
        />
        <button className="btn" type="submit" disabled={sending || !draft.trim() || messages === null} aria-label="Send message">
          {sending ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
        </button>
      </form>
      {draft.length >= DM_COUNTER_FROM && (
        <p className="dm-counter" aria-live="polite">
          {draft.length.toLocaleString('en-US')} / {DM_MAX.toLocaleString('en-US')}
        </p>
      )}
      {sendError && (
        <div className="form-error" role="alert">
          {sendError}
        </div>
      )}
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this message?"
        confirmLabel="Delete message"
        danger
        busy={deleteBusy}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => {
          if (!deleteBusy) setPendingDelete(null);
        }}
      >
        It will show as &ldquo;{DM_DELETED_TEXT}&rdquo; for both of you. This can&rsquo;t be undone.
      </ConfirmDialog>
    </section>
  );
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 6 · M2] What this file does
 * The right-hand side of the Messages page: one private conversation with its
 * history ("Show older messages"), live messages from the other person over
 * Socket.IO, and a composer (Enter sends, Shift+Enter = new line).
 * [Sprint 7 · M2] Edit / delete my own messages ("edited", "Message deleted")
 * and Sent / Seen under my messages, all kept in step live.
 * ---------------------------------------------------------------------------
 */

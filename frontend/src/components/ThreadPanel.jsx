import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MessagesSquare, RefreshCw, Send, X } from 'lucide-react';
import { assetUrl } from '../api';
import { Avatar, AVATAR_TONES, initialsOf } from './ui';
import { timeAgo } from './activityDisplay';
import MentionTextarea from './MentionTextarea'; // [Sprint 3] US-18
// [Sprint 7 · M1] Edit / delete your own messages
import { ChannelMessageActions, ChannelMessageEditForm, ChannelMessageText, DeleteMessageDialog, useChannelMessageEdits } from './ChannelMessageEdit';
import { canDeleteMessage, canEditMessage, mergeChannelMessages, newerMessageCopy, replaceChannelMessage } from '../channelMessages';

const MESSAGE_MAX = 4000;
const idOf = (value) => String(value?._id || value?.id || value || '');

export const replyCountLabel = (count) => `${count} ${count === 1 ? 'reply' : 'replies'}`;

// Adds or replaces replies by id and keeps them oldest-first.
// [Sprint 7 · M1] A deleted or later-edited copy is never replaced by an older one (channelMessages.js).
export function mergeReplies(list, incoming) {
  return mergeChannelMessages(list, (incoming || []).filter(Boolean));
}

// [Sprint 7 · M1] `edit` = { edits, canPost, currentUserId, members } turns on Edit / Delete for my own messages.
function Bubble({ message, tone, head = false, edit = null }) {
  const author = message.author || {};
  const canEdit = Boolean(edit) && canEditMessage(message, edit.currentUserId, edit.canPost);
  const canDelete = Boolean(edit) && canDeleteMessage(message, edit.currentUserId);
  const editing = canEdit && edit.edits.editingId === idOf(message);
  return (
    <article className={`chat-message ${head ? 'thread-parent' : ''}${message.deleted ? ' deleted' : ''}`} data-reply-id={head ? undefined : idOf(message)}>
      <Avatar initials={initialsOf(author.name || 'Former member')} src={assetUrl(author.avatarUrl)} tone={tone} small />
      <div>
        <div className="chat-message-head">
          <b>{author.name || 'Former member'}</b><time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>{timeAgo(message.createdAt)}</time>
          {edit && <ChannelMessageActions message={message} edits={edit.edits} canEdit={canEdit} canDelete={canDelete} />}
        </div>
        {editing
          ? <ChannelMessageEditForm message={message} edits={edit.edits} members={edit.members} currentUserId={edit.currentUserId} />
          : <ChannelMessageText message={message} />}
      </div>
    </article>
  );
}

/**
 * [Sprint 3 · US-17] The thread of one channel message, shown beside the channel in ChatPanel.
 *
 * Props
 *   projectId, channelId, channelName
 *   parent      the top-level message (as listed in the channel); replaced by the server copy once loaded
 *   api         channelApi: replies(), reply(); onReply() for live replies is optional
 *   canPost     Owner / Admin / Contributor. Viewers read only.
 *   members, currentUserId   [US-18] for @ suggestions in the reply box
 *   onReplied   ({ _id, replyCount, lastReplyAt }) => void, so the channel updates "N replies" right away
 *   onMessageChanged  [Sprint 7 · M1] (message) => void, when the thread's first message is edited or deleted here
 *   onClose     () => void
 *
 * [Sprint 7 · M1] Edit / Delete on my own replies and on the first message if I wrote it. A deleted one stays
 * in the thread as "Message deleted". Edits and deletes by others arrive live ('message:updated').
 */
export default function ThreadPanel({ projectId, channelId, channelName = '', parent, api, canPost = false, members = [], currentUserId = '', onReplied, onMessageChanged, onClose }) {
  const parentId = idOf(parent);
  const [head, setHead] = useState(parent);
  const [replies, setReplies] = useState(null);
  const [nextAfter, setNextAfter] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const listRef = useRef(null);

  // [Sprint 7 · M1] A saved edit / delete: the first message goes to the head (and the channel list), a reply to the list.
  const onMessageChangedRef = useRef(onMessageChanged);
  onMessageChangedRef.current = onMessageChanged;
  const applyChange = useCallback((message) => {
    if (!message) return;
    if (idOf(message) === parentId) {
      setHead((old) => newerMessageCopy(old, message));
      onMessageChangedRef.current?.(message);
    } else {
      setReplies((old) => replaceChannelMessage(old, message));
    }
  }, [parentId]);
  const edits = useChannelMessageEdits({ api, projectId, channelId, onChanged: applyChange });
  const { forget } = edits;
  const editProps = { edits, canPost, currentUserId, members };
  const deletingReply = Boolean(edits.pendingDelete) && idOf(edits.pendingDelete) !== parentId;

  // [Sprint 7 · M1] The channel's copy of the first message changed (e.g. edited there): show it here too.
  useEffect(() => {
    if (parent && parent.body !== undefined && idOf(parent) === parentId) setHead((old) => newerMessageCopy(old, parent));
  }, [parent, parentId]);

  useEffect(() => {
    let active = true;
    setReplies(null); setLoadError(''); setNextAfter(null); setHead(parent);
    api.replies(projectId, channelId, parentId)
      .then((result) => {
        if (!active) return;
        if (result.parent) setHead(result.parent);
        setReplies(result.replies || []);
        setNextAfter(result.nextAfter || null);
      })
      .catch((error) => { if (active) setLoadError(error.message || 'Could not load the thread.'); });
    return () => { active = false; };
  }, [api, projectId, channelId, parentId, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live replies from teammates in this thread.
  useEffect(() => {
    if (!api.onReply) return undefined;
    return api.onReply(projectId, (payload) => {
      if (String(payload?.parentId) !== parentId || !payload.reply) return;
      setReplies((old) => (old ? mergeReplies(old, [payload.reply]) : old));
    });
  }, [api, projectId, parentId]);

  // [Sprint 7 · M1] Live edits / deletes of this thread's first message or its replies.
  useEffect(() => {
    if (!api.onUpdated) return undefined;
    return api.onUpdated(projectId, (payload) => {
      const message = payload?.message;
      if (!message) return;
      const inThread = idOf(message) === parentId || String(payload.parentId || '') === parentId;
      if (!inThread) return;
      forget(message);
      if (idOf(message) === parentId) setHead((old) => newerMessageCopy(old, message)); // ChatPanel updates its own list
      else setReplies((old) => replaceChannelMessage(old, message));
    });
  }, [api, projectId, parentId, forget]);

  // Keep the newest reply in view.
  useEffect(() => {
    const box = listRef.current;
    if (box && replies) box.scrollTop = box.scrollHeight;
  }, [replies]);

  const loadMore = async () => {
    try {
      const result = await api.replies(projectId, channelId, parentId, { after: nextAfter });
      setReplies((old) => mergeReplies(old, result.replies || []));
      setNextAfter(result.nextAfter || null);
    } catch (error) {
      setSendError(error.message || 'Could not load more replies.');
    }
  };

  const send = async (event) => {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || sending || !canPost) return;
    setSending(true); setSendError('');
    try {
      const result = await api.reply(projectId, channelId, parentId, body);
      setReplies((old) => mergeReplies(old, [result.reply]));
      if (result.parent) onReplied?.(result.parent);
      setDraft('');
    } catch (error) {
      setSendError(error.message || 'Could not send the reply.');
    } finally {
      setSending(false);
    }
  };

  const authors = useMemo(() => [...new Set([idOf(head?.author), ...(replies || []).map((reply) => idOf(reply.author))])], [head, replies]);
  const toneOf = (message) => AVATAR_TONES[Math.max(authors.indexOf(idOf(message.author)), 0) % 4];
  const count = replies ? replies.length : head?.replyCount || 0;

  return (
    <aside className="chat-thread" aria-label="Thread">
      <header className="chat-thread-head">
        <b><MessagesSquare size={14} /> Thread</b>
        {channelName && <small>#{channelName}</small>}
        <button type="button" className="iconbtn" aria-label="Close thread" onClick={onClose}><X size={14} /></button>
      </header>

      <div className="chat-thread-body" ref={listRef}>
        {head && head.body !== undefined && <Bubble message={head} tone={toneOf(head)} head edit={editProps} />}
        <div className="chat-thread-divider"><span>{replyCountLabel(nextAfter ? Math.max(count, head?.replyCount || 0) : count)}</span></div>

        {loadError && (
          <div className="form-error" role="alert">
            {loadError}
            <button type="button" className="link" onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={11} /> Try again</button>
          </div>
        )}
        {!loadError && replies === null && <div className="task-state" aria-busy="true"><Loader2 size={16} className="spin" /><p>Loading replies…</p></div>}
        {replies && replies.length === 0 && <p className="chat-thread-empty">No replies yet.{canPost ? ' Start the side discussion here.' : ''}</p>}
        {(replies || []).map((reply) => <Bubble key={idOf(reply)} message={reply} tone={toneOf(reply)} edit={editProps} />)}
        {nextAfter && <button type="button" className="link chat-older" onClick={loadMore}>Show more replies</button>}
      </div>

      {canPost ? (
        <form className="chat-composer" onSubmit={send}>
          <MentionTextarea
            value={draft}
            onChange={setDraft}
            onSubmit={send}
            members={members}
            currentUserId={currentUserId}
            placeholder="Reply in thread… use @ to mention"
            label="Reply"
            rows={1}
            maxLength={MESSAGE_MAX}
          />
          <button className="btn" type="submit" disabled={sending || !draft.trim()} aria-label="Send reply">{sending ? <Loader2 size={15} className="spin" /> : <Send size={15} />}</button>
        </form>
      ) : (
        <p className="task-readonly chat-readonly">Viewers can read threads but not reply.</p>
      )}
      {sendError && <div className="form-error" role="alert">{sendError}</div>}
      <DeleteMessageDialog edits={edits} isReply={deletingReply} />
    </aside>
  );
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 3 · US-17] What this file does
 * Side panel of the Chat tab showing one message's thread: the original
 * message, its replies (live), and a reply box. Sending a reply updates the
 * "N replies" count on the message in the channel.
 * [Sprint 7 · M1] Edit / Delete on your own replies (and on the first message
 * if you wrote it): "(edited)" / "Message deleted", live for everyone.
 * ---------------------------------------------------------------------------
 */

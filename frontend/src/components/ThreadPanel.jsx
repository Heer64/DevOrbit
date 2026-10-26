import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MessagesSquare, RefreshCw, Send, X } from 'lucide-react';
import { assetUrl } from '../api';
import { Avatar, AVATAR_TONES, initialsOf } from './ui';
import { timeAgo } from './activityDisplay';
import MentionTextarea from './MentionTextarea'; // [Sprint 3] US-18
import MentionText from './MentionText'; // [Sprint 3] US-18

const MESSAGE_MAX = 4000;
const idOf = (value) => String(value?._id || value?.id || value || '');

export const replyCountLabel = (count) => `${count} ${count === 1 ? 'reply' : 'replies'}`;

// Adds or replaces replies by id and keeps them oldest-first.
export function mergeReplies(list, incoming) {
  const byId = new Map((list || []).map((reply) => [idOf(reply), reply]));
  for (const reply of incoming) if (reply) byId.set(idOf(reply), reply);
  return [...byId.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || idOf(a).localeCompare(idOf(b)));
}

function Bubble({ message, tone, head = false }) {
  const author = message.author || {};
  return (
    <article className={`chat-message ${head ? 'thread-parent' : ''}`} data-reply-id={head ? undefined : idOf(message)}>
      <Avatar initials={initialsOf(author.name || 'Former member')} src={assetUrl(author.avatarUrl)} tone={tone} small />
      <div>
        <div className="chat-message-head"><b>{author.name || 'Former member'}</b><time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>{timeAgo(message.createdAt)}</time></div>
        <p><MentionText body={message.body} mentions={message.mentions} /></p>
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
 *   onClose     () => void
 */
export default function ThreadPanel({ projectId, channelId, channelName = '', parent, api, canPost = false, members = [], currentUserId = '', onReplied, onClose }) {
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
        {head && head.body !== undefined && <Bubble message={head} tone={toneOf(head)} head />}
        <div className="chat-thread-divider"><span>{replyCountLabel(nextAfter ? Math.max(count, head?.replyCount || 0) : count)}</span></div>

        {loadError && (
          <div className="form-error" role="alert">
            {loadError}
            <button type="button" className="link" onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={11} /> Try again</button>
          </div>
        )}
        {!loadError && replies === null && <div className="task-state" aria-busy="true"><Loader2 size={16} className="spin" /><p>Loading replies…</p></div>}
        {replies && replies.length === 0 && <p className="chat-thread-empty">No replies yet.{canPost ? ' Start the side discussion here.' : ''}</p>}
        {(replies || []).map((reply) => <Bubble key={idOf(reply)} message={reply} tone={toneOf(reply)} />)}
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
    </aside>
  );
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 3 · US-17] What this file does
 * Side panel of the Chat tab showing one message's thread: the original
 * message, its replies (live), and a reply box. Sending a reply updates the
 * "N replies" count on the message in the channel.
 * ---------------------------------------------------------------------------
 */

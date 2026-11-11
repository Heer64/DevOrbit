import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Loader2, Lock, MessageCircle, RefreshCw, Send } from 'lucide-react';
import { assetUrl, directMessageApi } from '../api';
import { Avatar, initialsOf } from './ui';
import { timeAgo } from './activityDisplay';
import { DM_COUNTER_FROM, DM_MAX, announceUnreadTotal, idOf, mergeDirectMessages } from '../directMessages';

export const DM_NOT_FOUND = 'This conversation does not exist, or you are not part of it.';

/*
 * [Sprint 6 · M2] US-19 One direct conversation: history, live messages and the composer.
 *
 * - Loads the conversation header and the newest page of messages; "Show older messages" loads more.
 * - AC2: new messages from the other person arrive live ('dm:message'), and are marked read while this
 *   conversation is open and the tab is visible. Only the two participants ever receive them.
 * - Enter sends, Shift+Enter starts a new line. 1-4,000 characters (the server checks again).
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
    stickToBottom.current = true;
    Promise.all([api.conversation(conversationId), api.messages(conversationId)])
      .then(([one, page]) => {
        if (!active) return;
        setConversation(one.conversation);
        if (one.conversation) onUpdateRef.current?.(one.conversation);
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
      if (idOf(payload.message.sender) !== String(meId)) markRead();
    });
  }, [api, conversationId, meId, markRead]);

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
          return (
            <article key={id} data-message-id={id} className={`dm-message ${mine ? 'mine' : 'theirs'}`}>
              <div className="dm-bubble">
                <p>{message.body}</p>
              </div>
              <time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>
                {mine ? 'You' : message.sender?.name || 'Deleted user'} · {timeAgo(message.createdAt)}
              </time>
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
    </section>
  );
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 6 · M2] What this file does
 * The right-hand side of the Messages page: one private conversation with its
 * history ("Show older messages"), live messages from the other person over
 * Socket.IO, and a composer (Enter sends, Shift+Enter = new line).
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Hash, Loader2, MessageSquare, Plus, RefreshCw, Send, X } from 'lucide-react';
import { assetUrl, channelApi } from '../api';
import { canManageChannels, canPostMessages } from '../roles';
import { Avatar, AVATAR_TONES, initialsOf } from './ui';
import { timeAgo } from './activityDisplay';

const MESSAGE_MAX = 4000;
const idOf = (value) => String(value?._id || value?.id || value || '');

// Adds or replaces messages by id and keeps the list oldest-first.
export function mergeMessages(list, incoming) {
  const byId = new Map(list.map((message) => [idOf(message), message]));
  for (const message of incoming) byId.set(idOf(message), message);
  return [...byId.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || idOf(a).localeCompare(idOf(b)));
}

/**
 * The Chat tab of a project (US-16).
 *
 * Props
 *   projectId          project whose channels are shown
 *   myRole             caller's role; Viewers read only
 *   api                channelApi (default) or a fake in tests
 *   channelId          channel to open (from the URL); falls back to #general
 *   highlightMessageId message to scroll to and highlight (from a link)
 *   onChannelChange    (channelId) => void, so the page can keep the URL in sync
 */
export default function ChatPanel({ projectId, myRole, api = channelApi, channelId: wantedChannel = '', highlightMessageId = '', onChannelChange }) {
  const [channels, setChannels] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [activeId, setActiveId] = useState('');
  const [messages, setMessages] = useState(null);
  const [nextBefore, setNextBefore] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState('');
  const listRef = useRef(null);
  const stickToBottom = useRef(true);

  const canPost = canPostMessages(myRole);
  const canCreate = canManageChannels(myRole);

  // Channels.
  useEffect(() => {
    let active = true;
    setChannels(null); setLoadError('');
    api.list(projectId)
      .then((result) => { if (active) setChannels(result.channels || []); })
      .catch((error) => { if (active) setLoadError(error.message || 'Could not load channels.'); });
    return () => { active = false; };
  }, [api, projectId, reloadKey]);

  // Pick the channel from the URL, else the current one, else #general.
  useEffect(() => {
    if (!channels?.length) return;
    const wanted = channels.find((channel) => idOf(channel) === wantedChannel);
    const current = channels.find((channel) => idOf(channel) === activeId);
    const next = idOf(wanted || current || channels.find((channel) => channel.isDefault) || channels[0]);
    if (next !== activeId) setActiveId(next);
  }, [channels, wantedChannel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Messages of the open channel.
  useEffect(() => {
    if (!activeId) return undefined;
    let active = true;
    setMessages(null); setNextBefore(null); stickToBottom.current = true;
    api.messages(projectId, activeId)
      .then((result) => { if (active) { setMessages(result.messages || []); setNextBefore(result.nextBefore || null); } })
      .catch((error) => { if (active) { setMessages([]); setSendError(error.message || 'Could not load messages.'); } });
    return () => { active = false; };
  }, [api, projectId, activeId]);

  // Live messages for this project; only the open channel's are shown.
  useEffect(() => {
    if (!api.onMessage) return undefined;
    return api.onMessage(projectId, (payload) => {
      if (payload.channelId !== activeId || !payload.message) return;
      setMessages((old) => (old ? mergeMessages(old, [payload.message]) : old));
    });
  }, [api, projectId, activeId]);

  // Keep the newest message in view unless the reader scrolled up to read history.
  useEffect(() => {
    const box = listRef.current;
    if (!box || !messages) return;
    const target = highlightMessageId && box.querySelector?.(`[data-message-id="${highlightMessageId}"]`);
    if (target) { target.scrollIntoView?.({ block: 'center' }); return; }
    if (stickToBottom.current) box.scrollTop = box.scrollHeight;
  }, [messages, highlightMessageId]);

  const onScroll = () => {
    const box = listRef.current;
    if (box) stickToBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  };

  const choose = (channel) => {
    const id = idOf(channel);
    setActiveId(id); setSendError('');
    onChannelChange?.(id);
  };

  const loadOlder = async () => {
    if (!nextBefore || loadingOlder) return;
    setLoadingOlder(true); stickToBottom.current = false;
    try {
      const result = await api.messages(projectId, activeId, { before: nextBefore });
      setMessages((old) => mergeMessages(old || [], result.messages || []));
      setNextBefore(result.nextBefore || null);
    } catch (error) {
      setSendError(error.message || 'Could not load older messages.');
    } finally {
      setLoadingOlder(false);
    }
  };

  const send = async (event) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending || !canPost) return;
    setSending(true); setSendError(''); stickToBottom.current = true;
    try {
      const result = await api.send(projectId, activeId, body);
      setMessages((old) => mergeMessages(old || [], [result.message]));
      setDraft('');
    } catch (error) {
      setSendError(error.message || 'Could not send the message.');
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event) => {
    // Enter sends, Shift+Enter adds a new line.
    if (event.key === 'Enter' && !event.shiftKey) send(event);
  };

  const createChannel = async (event) => {
    event.preventDefault();
    if (!newName.trim()) return;
    setCreateError('');
    try {
      const result = await api.create(projectId, { name: newName.trim() });
      setChannels((old) => [...(old || []), result.channel]);
      setNewName(''); setCreating(false);
      choose(result.channel);
    } catch (error) {
      setCreateError(error.message || 'Could not create the channel.');
    }
  };

  const active = useMemo(() => (channels || []).find((channel) => idOf(channel) === activeId), [channels, activeId]);
  const authors = useMemo(() => [...new Set((messages || []).map((message) => idOf(message.author)))], [messages]);

  if (loadError) {
    return (
      <div className="task-state error" role="alert">
        <AlertCircle size={20} /><p>{loadError}</p>
        <button className="btn secondary" onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={13} /> Try again</button>
      </div>
    );
  }
  if (channels === null) return <div className="task-state" aria-busy="true"><Loader2 size={20} className="spin" /><p>Loading channels…</p></div>;

  return (
    <div className="chat">
      <nav className="chat-channels" aria-label="Channels">
        {channels.map((channel) => (
          <button key={idOf(channel)} className={idOf(channel) === activeId ? 'active' : ''} aria-current={idOf(channel) === activeId ? 'true' : undefined} onClick={() => choose(channel)}>
            <Hash size={13} /><span>{channel.name}</span>
          </button>
        ))}
        {canCreate && !creating && <button className="chat-new" onClick={() => setCreating(true)}><Plus size={13} /><span>New channel</span></button>}
        {canCreate && creating && (
          <form className="chat-new-form" onSubmit={createChannel}>
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="channel-name" aria-label="New channel name" maxLength={30} />
            <button type="submit" className="iconbtn" aria-label="Create channel" disabled={!newName.trim()}><Plus size={14} /></button>
            <button type="button" className="iconbtn" aria-label="Cancel" onClick={() => { setCreating(false); setCreateError(''); }}><X size={14} /></button>
            {createError && <p className="form-error" role="alert">{createError}</p>}
          </form>
        )}
      </nav>

      <section className="chat-room" aria-label={active ? `#${active.name}` : 'Channel'}>
        <header className="chat-room-head"><b><Hash size={14} />{active?.name}</b>{active?.description && <small>{active.description}</small>}</header>

        <div className="chat-messages" ref={listRef} onScroll={onScroll} aria-live="polite">
          {nextBefore && <button className="link chat-older" onClick={loadOlder} disabled={loadingOlder}>{loadingOlder ? 'Loading…' : 'Show older messages'}</button>}
          {messages === null && <div className="task-state" aria-busy="true"><Loader2 size={18} className="spin" /><p>Loading messages…</p></div>}
          {messages && messages.length === 0 && (
            <div className="task-empty"><MessageSquare size={20} /><p>No messages in #{active?.name} yet.{canPost ? ' Say hello to your team.' : ''}</p></div>
          )}
          {(messages || []).map((message) => {
            const id = idOf(message);
            const author = message.author || {};
            return (
              <article key={id} data-message-id={id} className={`chat-message ${id === highlightMessageId ? 'highlight' : ''}`}>
                <Avatar initials={initialsOf(author.name)} src={assetUrl(author.avatarUrl)} tone={AVATAR_TONES[Math.max(authors.indexOf(idOf(author)), 0) % 4]} small />
                <div>
                  <div className="chat-message-head"><b>{author.name || 'Former member'}</b><time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>{timeAgo(message.createdAt)}</time></div>
                  <p>{message.body}</p>
                </div>
              </article>
            );
          })}
        </div>

        {canPost ? (
          <form className="chat-composer" onSubmit={send}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={`Message #${active?.name || 'general'}`}
              aria-label="Message"
              rows={1}
              maxLength={MESSAGE_MAX}
            />
            <button className="btn" type="submit" disabled={sending || !draft.trim()} aria-label="Send message">{sending ? <Loader2 size={15} className="spin" /> : <Send size={15} />}</button>
          </form>
        ) : (
          <p className="task-readonly chat-readonly">You are a Viewer on this project, so you can read channels but not send messages.</p>
        )}
        {sendError && <div className="form-error" role="alert">{sendError}</div>}
      </section>
    </div>
  );
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 2 final] What this file does
 * The project "Chat" tab (US-16): channel list (+ "New channel" for Owners and
 * Admins), message history with "Show older messages", a composer (Enter sends,
 * Shift+Enter = new line) and live messages from teammates over Socket.IO.
 * Viewers see a read-only note instead of the composer.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Lock, MessageCircle } from 'lucide-react';
import { directMessageApi } from '../api';
import { useAuth } from '../context/AuthContext';
import DmInbox from '../components/DmInbox';
import DmConversation from '../components/DmConversation';
import { announceUnreadTotal, idOf, setUnread, upsertConversation } from '../directMessages';

/*
 * [Sprint 6 · M2] US-19 Send direct messages (FR-6, NFR-1b). /messages and /messages/:conversationId, login required.
 *
 * Left: the inbox (DmInbox). Right: the open conversation (DmConversation), or a short explanation.
 * AC1: "Message" on a profile (MessageUserButton) lands here with the conversation open. It has nothing
 * to do with any project: no channel list, no project name.
 * AC2: the inbox follows live messages ('dm:message') and reads in my other tabs ('dm:read'), so a new
 * message moves its conversation to the top within a second. Only the two participants receive them.
 * Contract: backend/src/routes/directMessages.js.
 *
 * Props (for tests): api = directMessageApi, currentUser = the signed-in user from AuthContext.
 */
export default function MessagesPage({ api = directMessageApi, currentUser }) {
  const { conversationId = '' } = useParams();
  const auth = useAuth();
  const user = currentUser !== undefined ? currentUser : auth?.user;
  const meId = idOf(user);
  const demo = Boolean(user?.isDemo);
  const [conversations, setConversations] = useState(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  // Conversations marked read on this page: an inbox answer that left before the read cannot bring the count back.
  const readHere = useRef(new Set());

  // The inbox. Live updates that arrive while it loads are kept (the newer copy of a row wins).
  useEffect(() => {
    if (demo) return undefined;
    let active = true;
    setError('');
    api
      .inbox()
      .then((result) => {
        if (!active) return;
        const rows = (result.conversations || []).map((item) => (readHere.current.has(idOf(item)) ? { ...item, unreadCount: 0 } : item));
        setConversations((old) => rows.reduce((list, item) => upsertConversation(list, item), old || []));
        announceUnreadTotal(result.unreadTotal);
      })
      .catch((failure) => {
        if (active) setError(failure?.message || 'Could not load your messages.');
      });
    return () => {
      active = false;
    };
  }, [api, demo, reloadKey]);

  useEffect(() => {
    if (demo) return undefined;
    const stops = [
      api.onMessage?.((payload) => {
        if (payload?.conversation) setConversations((old) => upsertConversation(old || [], payload.conversation));
      }),
      api.onRead?.((payload) => {
        if (payload?.conversationId) setConversations((old) => setUnread(old, payload.conversationId, 0));
      }),
    ];
    return () => stops.forEach((stop) => stop?.());
  }, [api, demo]);

  const handleUpdate = useCallback((conversation) => setConversations((old) => upsertConversation(old || [], conversation)), []);
  const handleRead = useCallback((id) => {
    readHere.current.add(String(id));
    setConversations((old) => setUnread(old, id, 0));
  }, []);

  if (demo) {
    return (
      <section className="panel dm-demo">
        <div className="eyebrow">MESSAGES</div>
        <h2>
          <Lock size={16} /> Direct messages need a real account
        </h2>
        <p className="team-note">The demo workspace has no other people to talk to. Sign up or log in to message other DevOrbit users.</p>
      </section>
    );
  }

  const summary = (conversations || []).find((item) => idOf(item) === conversationId) || null;

  return (
    <div className={`panel dm-page ${conversationId ? 'has-open' : ''}`}>
      <DmInbox
        conversations={conversations}
        activeId={conversationId}
        error={error}
        onRetry={() => {
          setConversations(null);
          setReloadKey((key) => key + 1);
        }}
      />
      <div className="dm-main">
        {conversationId ? (
          <DmConversation
            key={conversationId}
            conversationId={conversationId}
            summary={summary}
            meId={meId}
            api={api}
            onUpdate={handleUpdate}
            onRead={handleRead}
          />
        ) : (
          <div className="dm-placeholder">
            <MessageCircle size={26} />
            <h2>Your direct messages</h2>
            <p>
              Choose a conversation on the left, or open someone&rsquo;s profile and choose <b>Message</b> to start one. Only the two of you
              can read it.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 6 · M2] What this file does
 * The Messages page (US-19): inbox on the left, the open private conversation
 * on the right, both updated live. Demo users see a note, since the demo has
 * no real people to message.
 * ---------------------------------------------------------------------------
 */

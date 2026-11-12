import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, MessageCircle } from 'lucide-react';
import { directMessageApi } from '../api';

/*
 * [Sprint 6 · M2] US-19 AC1: the "Message" button on another user's profile (/people/:username).
 * Opens the direct conversation with that user (the server creates it the first time) and goes to it
 * at /messages/:conversationId, separate from every project channel.
 *
 * Props
 *   username, name   whose profile this is
 *   api              directMessageApi (tests pass a fake)
 */
export default function MessageUserButton({ username, name, api = directMessageApi }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.open(username);
      const id = result?.conversation?._id;
      if (!id) throw new Error('Could not open the conversation. Please try again.');
      navigate(`/messages/${encodeURIComponent(id)}`);
    } catch (failure) {
      setError(failure?.message || `Could not start a conversation with ${name || username}. Please try again.`);
      setBusy(false);
    }
  };

  return (
    <div className="dm-message-control">
      <button
        type="button"
        className="btn secondary dm-message-button"
        onClick={start}
        disabled={busy}
        aria-label={`Message ${name || username}`}
      >
        {busy ? <Loader2 size={13} className="spin" aria-hidden="true" /> : <MessageCircle size={13} aria-hidden="true" />}
        {busy ? 'Opening…' : 'Message'}
      </button>
      {error && (
        <p className="form-error dm-message-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

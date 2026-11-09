import { useEffect, useRef, useState } from 'react';
import { postApi } from '../api';
import { VOTE_DOWN, VOTE_NONE, VOTE_UP, nextVote, voteErrorMessage, voteSummary, withVote } from '../votes';

/*
 * [Sprint 5 · M7] Up/down vote buttons and the score of one public post (US-52, FR-24).
 *   AC1 first upvote or downvote -> the score moves by one at once, then the server's numbers show
 *   AC2 the server counts a repeated vote once; here, clicking the active arrow removes the vote
 *   FR-24 click the other arrow to change the vote, the active one to retract it
 *   NFR-16 after 30 votes in a minute the server answers 429 and its message is shown
 *
 * The new score shows straight away (optimistic). If the server refuses, the old score comes
 * back and the reason is shown. While one vote is being saved, more clicks are ignored.
 *
 * Props: post (API shape with upvotes, downvotes, score, myVote), api (postApi; tests pass a fake),
 *        onVoted(post) gets the post as the server returned it.
 *
 * [Sprint 5 · M8] The buttons show 👍 (upvote) and 👎 (downvote) instead of arrows (team request).
 * Only the symbol changed: names, behaviour and the score are as before, and the screen-reader
 * names stay "Upvote" / "Downvote" (never "like", NFR-27).
 */
export default function PostVotes({ post, api = postApi, onVoted }) {
  const [optimistic, setOptimistic] = useState(null);
  const [latest, setLatest] = useState(null);
  const [error, setError] = useState('');
  const busy = useRef(false);

  // A new post object from the parent (refresh, edit, our own onVoted) replaces our local copy.
  useEffect(() => { setLatest(null); }, [post]);

  const shown = optimistic || latest || post;
  const myVote = shown.myVote || VOTE_NONE;

  const click = async (clicked) => {
    if (busy.current) return;
    busy.current = true;
    const value = nextVote(myVote, clicked);
    setError('');
    setOptimistic(withVote(shown, value));
    try {
      const result = value === VOTE_NONE ? await api.unvote(post._id) : await api.vote(post._id, value);
      setLatest(result.post);
      onVoted?.(result.post);
    } catch (failure) {
      setError(voteErrorMessage(failure));
    } finally {
      setOptimistic(null);
      busy.current = false;
    }
  };

  const upOn = myVote === VOTE_UP;
  const downOn = myVote === VOTE_DOWN;
  const tone = shown.score > 0 ? 'positive' : shown.score < 0 ? 'negative' : '';

  return (
    <div className="post-votes-wrap">
      <div className="post-votes" role="group" aria-label="Vote on this post" aria-busy={optimistic ? true : undefined}>
        <button
          type="button"
          className={`vote-btn up ${upOn ? 'on' : ''}`}
          aria-pressed={upOn}
          aria-label={upOn ? 'Remove upvote' : 'Upvote'}
          title={upOn ? 'Remove upvote' : 'Upvote'}
          onClick={() => click(VOTE_UP)}
        >
          <span className="vote-emoji" aria-hidden="true">👍</span>
        </button>
        <span className={`vote-score ${tone}`} title={voteSummary(shown)} aria-live="polite" aria-label={`Score ${shown.score}`}>
          {shown.score}
        </span>
        <button
          type="button"
          className={`vote-btn down ${downOn ? 'on' : ''}`}
          aria-pressed={downOn}
          aria-label={downOn ? 'Remove downvote' : 'Downvote'}
          title={downOn ? 'Remove downvote' : 'Downvote'}
          onClick={() => click(VOTE_DOWN)}
        >
          <span className="vote-emoji" aria-hidden="true">👎</span>
        </button>
      </div>
      {error && <p className="form-error vote-error" role="alert">{error}</p>}
    </div>
  );
}

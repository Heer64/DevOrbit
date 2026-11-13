import { useEffect, useId, useRef, useState } from 'react';
import { Flag, X } from 'lucide-react';
import { postApi } from '../api';
import {
  REPORT_ALREADY_MESSAGE,
  REPORT_DETAILS_MAX,
  REPORT_REASONS,
  REPORT_REASON_OTHER,
  checkReport,
  isAlreadyReported,
  reportDetailsLength,
  reportErrorMessage,
} from '../reports';

/*
 * [Sprint 6 · M6] "Report this post" dialog (US-55 Report a public post, FR-27, NFR-26, NFR-28).
 *   AC1 choose a reason (+ optional details), Send report -> the server stores an open report, which is
 *       what the moderator queue (US-56) lists; the card then shows "Thanks. Your report was sent…"
 *   AC2 already reported -> "You have already reported this post." The dialog asks the server first
 *       (GET), so the user is told before filling in the form; a 409 from Send says the same.
 *
 * Phases: checking (asking the server) -> form | already.
 * Props: open, postId, authorName, api (postApi; tests pass a fake), knownReported (the card already
 *        knows it was reported), onClose(), onReported({ report, message }), onAlreadyReported().
 */
export default function ReportPostDialog({
  open,
  postId,
  authorName = 'this user',
  api = postApi,
  knownReported = false,
  onClose,
  onReported,
  onAlreadyReported,
}) {
  const [phase, setPhase] = useState('checking');
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const titleId = useId();
  const firstReason = useRef(null);
  const okButton = useRef(null);

  // Callbacks from the parent may be new functions on every render; keep the latest without
  // re-running the status check (which would ask the server again and again).
  const callbacks = useRef({});
  callbacks.current = { onClose, onReported, onAlreadyReported };

  useEffect(() => {
    // Closed: start from "checking" next time, so an old form or message never flashes on reopening.
    if (!open) {
      setPhase('checking');
      return undefined;
    }
    let live = true;
    setReason('');
    setDetails('');
    setError('');
    setSending(false);

    if (knownReported) {
      setPhase('already');
      return undefined;
    }
    if (typeof api.reportStatus !== 'function') {
      setPhase('form');
      return undefined;
    }

    setPhase('checking');
    api
      .reportStatus(postId)
      .then((result) => {
        if (!live) return;
        if (result?.reported) {
          setPhase('already');
          callbacks.current.onAlreadyReported?.();
        } else {
          setPhase('form');
        }
      })
      .catch((failure) => {
        if (!live) return;
        // A failed check never blocks reporting: Send is checked by the server again.
        setPhase('form');
        if (failure?.status === 404) setError(reportErrorMessage(failure));
      });
    return () => {
      live = false;
    };
  }, [open, postId, knownReported, api]);

  // A card that already knows it was reported shows the message straight away (no server check).
  const view = knownReported ? 'already' : phase;

  // Focus: the first reason when the form appears, OK when already reported.
  useEffect(() => {
    if (!open) return;
    if (view === 'form') firstReason.current?.focus();
    if (view === 'already') okButton.current?.focus();
  }, [open, view]);

  // Escape closes (not while the report is being sent).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape' && !sending) callbacks.current.onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, sending]);

  if (!open) return null;

  const close = () => {
    if (!sending) onClose?.();
  };
  const length = reportDetailsLength(details);
  const over = length > REPORT_DETAILS_MAX;
  const needsDetails = reason === REPORT_REASON_OTHER;

  const submit = async (event) => {
    event.preventDefault();
    if (sending) return;
    const problem = checkReport({ reason, details });
    if (problem) {
      setError(problem);
      return;
    }
    setSending(true);
    setError('');
    try {
      const result = await api.report(postId, { reason, details });
      onReported?.(result);
    } catch (failure) {
      if (isAlreadyReported(failure)) {
        setPhase('already');
        onAlreadyReported?.();
      } else {
        setError(reportErrorMessage(failure));
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="modal-back" onClick={close}>
      <div
        className="modal report-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-top">
          <span className="modal-icon danger">
            <Flag size={18} />
          </span>
          <button type="button" className="iconbtn" aria-label="Close" disabled={sending} onClick={close}>
            <X size={17} />
          </button>
        </div>
        <h2 id={titleId}>Report this post</h2>

        {view === 'checking' && (
          <p className="report-note" role="status">
            Checking…
          </p>
        )}

        {view === 'already' && (
          <>
            <p className="report-note report-already" role="status">
              <b>{REPORT_ALREADY_MESSAGE}</b> Moderators will review it. You don’t need to report it again.
            </p>
            <div className="modal-actions">
              <button ref={okButton} type="button" className="btn" onClick={close}>
                OK
              </button>
            </div>
          </>
        )}

        {view === 'form' && (
          <form className="report-form" onSubmit={submit} noValidate>
            <p className="report-note">Why should a moderator review this post by {authorName}? Only moderators see your report.</p>
            <fieldset className="report-reasons" disabled={sending}>
              <legend>Reason</legend>
              {REPORT_REASONS.map((item, index) => (
                <label key={item.value} className={`report-reason ${reason === item.value ? 'on' : ''}`}>
                  <input
                    ref={index === 0 ? firstReason : undefined}
                    type="radio"
                    name={`report-reason-${postId}`}
                    value={item.value}
                    checked={reason === item.value}
                    onChange={() => {
                      setReason(item.value);
                      setError('');
                    }}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </fieldset>
            <div className="field-wrap report-details">
              <span className="report-details-label">{needsDetails ? 'What is wrong? (required)' : 'Details (optional)'}</span>
              <textarea
                className="field-input"
                rows={3}
                value={details}
                onChange={(event) => {
                  setDetails(event.target.value);
                  if (error) setError('');
                }}
                placeholder={needsDetails ? 'Tell the moderators what is wrong with this post.' : 'Anything that helps a moderator decide'}
                aria-label="Report details"
                aria-invalid={over || undefined}
                disabled={sending}
              />
              <span className={`char-count ${over ? 'over' : ''}`} aria-live="polite">
                {length}/{REPORT_DETAILS_MAX}
              </span>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={close} disabled={sending}>
                Cancel
              </button>
              <button type="submit" className="btn danger" disabled={sending}>
                {sending ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

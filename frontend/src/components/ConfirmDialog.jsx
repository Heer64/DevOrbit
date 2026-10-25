import { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Btn } from './ui';

/*
 * [Sprint 3 · M3] A small in-app confirmation dialog (used for Remove member and Leave project, US-13/US-14).
 * Uses the same modal styles as "Create a project". Escape or the backdrop cancels.
 *
 *   <ConfirmDialog open title="Leave this project?" confirmLabel="Leave project" danger
 *                  onConfirm={...} onCancel={...}>Explanation</ConfirmDialog>
 *
 * hideCancel turns it into a plain notice with one button (confirmLabel, default "OK").
 */
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  hideCancel = false,
  error = '',
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    confirmRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div className="modal-back" onClick={() => { if (!busy) onCancel?.(); }}>
      <div className="modal confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-top">
          <span className={`modal-icon ${danger ? 'danger' : ''}`}><AlertTriangle size={19} /></span>
          <button type="button" className="iconbtn" aria-label="Close" disabled={busy} onClick={onCancel}><X size={17} /></button>
        </div>
        <h2 id="confirm-dialog-title">{title}</h2>
        <div className="confirm-body">{children}</div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="modal-actions">
          {!hideCancel && <Btn secondary disabled={busy} onClick={onCancel}>{cancelLabel}</Btn>}
          <button ref={confirmRef} type="button" className={`btn ${danger ? 'danger' : ''}`} disabled={busy} onClick={onConfirm}>
            {busy ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

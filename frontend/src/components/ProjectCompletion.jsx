import { useState } from 'react';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { projectCompletionApi } from '../api';
import { canChangeCompletion } from '../roles';
import { Btn } from './ui';
import ConfirmDialog from './ConfirmDialog';

/*
 * [Sprint 4 · M8] Mark the project Completed / reopen it (US-15, FR-3, FR-21).
 * Only the Owner sees the button; the server still checks the role (403 otherwise).
 *
 * Props
 *   projectId      real project id
 *   status         current project status ('Planning' | 'In progress' | 'Completed')
 *   myRole         caller's role in the project
 *   onChanged(p)   called with the updated project from the API
 *   onNotice(msg)  short success message for the page toast
 */
export function formatCompletedOn(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ProjectCompletion({ projectId, status, myRole, onChanged, onNotice }) {
  const [confirming, setConfirming] = useState(null); // 'complete' | 'reopen' | null
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!canChangeCompletion(myRole)) return null;

  const completed = status === 'Completed';
  const close = () => { if (!busy) { setConfirming(null); setError(''); } };

  async function run() {
    setBusy(true);
    setError('');
    try {
      const result = confirming === 'complete'
        ? await projectCompletionApi.complete(projectId)
        : await projectCompletionApi.reopen(projectId);
      onChanged?.(result.project);
      onNotice?.(confirming === 'complete' ? 'Project marked as Completed.' : 'Project reopened.');
      window.dispatchEvent(new Event('devorbit:projects-updated'));
      setConfirming(null);
    } catch (err) {
      setError(err.message || 'Could not update the project status.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {completed ? (
        <Btn secondary icon={RotateCcw} onClick={() => setConfirming('reopen')}>Reopen project</Btn>
      ) : (
        <Btn secondary icon={CheckCircle2} onClick={() => setConfirming('complete')}>Mark as completed</Btn>
      )}
      <ConfirmDialog
        open={confirming === 'complete'}
        title="Mark this project as Completed?"
        confirmLabel="Mark as completed"
        busy={busy}
        error={error}
        onConfirm={run}
        onCancel={close}
      >
        <p>The project will show as Completed for every member and can appear as finished work in their portfolios. You can reopen it at any time.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirming === 'reopen'}
        title="Reopen this project?"
        confirmLabel="Reopen project"
        busy={busy}
        error={error}
        onConfirm={run}
        onCancel={close}
      >
        <p>The project goes back to its earlier active status and is no longer listed as finished work.</p>
      </ConfirmDialog>
    </>
  );
}

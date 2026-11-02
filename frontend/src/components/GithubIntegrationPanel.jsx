import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Github, Lock, RefreshCw, Unlink } from 'lucide-react';
import { githubApi } from '../api';
import { Btn } from './ui';
import GithubRepositoryPicker from './GithubRepositoryPicker'; // [Sprint 4 · M2] US-32
import GithubWebhookStatus from './GithubWebhookStatus'; // [Sprint 4 · M4] US-34
import ConfirmDialog from './ConfirmDialog'; // [Sprint 4 · M3] US-33 (shared dialog from Sprint 3 · M3)

/*
 * [Sprint 4 · M1] US-31 Authorize GitHub. Project integration settings for the Owner and Admins.
 *
 * "Connect GitHub" (Owner only) asks the API for a GitHub authorize URL and sends the browser there.
 * GitHub sends the Owner back to /project/<id>?github=<result>; this panel shows what happened and
 * removes ?github from the URL. The access token never reaches the browser: the API only says
 * which GitHub account was authorized, by whom and when.
 *
 * [Sprint 4 · M2] US-32: once GitHub is authorized, the Owner picks one repository
 * (GithubRepositoryPicker) and the panel shows it with an "Active" badge. Admins see the
 * repository and the state but cannot change it.
 *
 * [Sprint 4 · M4] US-34: with an Active repository the panel also shows whether the webhook that
 * sends commits, issues and pull requests to the Activity feed is set up (GithubWebhookStatus).
 *
 * [Sprint 4 · M3] US-33 Manage the GitHub connection: the Owner and Admins see the repository name
 * and the connection status, and can
 *   - Check connection: the server checks the token AND that the repository can still be read;
 *   - Disconnect (after confirming): no new GitHub events reach the Activity Feed, earlier ones stay;
 *   - Re-authorize: the same GitHub flow as Connect (connected, expired or disconnected); GitHub
 *     sends them back with ?github=reauthorized and the connection returns to Active.
 * What each person may do comes from the API (canDisconnect, canReauthorize, canVerify).
 *
 * onChange() is called after a repository is connected or GitHub is disconnected, so the page can
 * reload the project (the project header shows the repository name).
 */

const NOT_SAVED = 'Nothing was saved.';
export const GITHUB_RESULTS = {
  connected: { ok: true, text: 'GitHub is connected. DevOrbit can now read your repositories.' },
  denied: { ok: false, text: `The GitHub connection was not made because access was denied on GitHub. ${NOT_SAVED}` },
  expired: { ok: false, text: `The GitHub connection was not made because the request expired or was already used. ${NOT_SAVED} Try Connect GitHub again.` },
  invalid: { ok: false, text: `The GitHub connection was not made because the request could not be verified. ${NOT_SAVED} Start again from this page.` },
  // [Sprint 4 · M3] US-33: Admins may re-authorize now, so the reason no longer names the Owner only.
  forbidden: { ok: false, text: `The GitHub connection was not made because you are no longer allowed to manage this project's GitHub connection. ${NOT_SAVED}` },
  error: { ok: false, text: `The GitHub connection was not made because something went wrong. ${NOT_SAVED} Please try again.` },
};

// [Sprint 4 · M3] US-33: kept apart from GITHUB_RESULTS, whose failure entries all end in "Nothing was saved."
export const REAUTHORIZED_RESULT = { ok: true, text: 'GitHub was re-authorized for this project.' };

export function githubResult(value) {
  if (value === 'reauthorized') return REAUTHORIZED_RESULT; // [Sprint 4 · M3]
  return GITHUB_RESULTS[value] || GITHUB_RESULTS.error;
}

export function formatAuthorizedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// [Sprint 4 · M3] US-33: how each connectionState reads in the panel.
export const CONNECTION_STATE_LABELS = {
  not_connected: 'Not connected',
  unavailable: 'Unavailable',
  needs_repository: 'Authorized, no repository chosen',
  needs_reauthorization: 'Re-authorization needed',
  repository_unavailable: 'Repository unavailable',
  unverified: 'Not verified',
  disconnected: 'Disconnected',
  active: 'Active',
};

export function connectionStateLabel(state) {
  return CONNECTION_STATE_LABELS[state] || CONNECTION_STATE_LABELS.not_connected;
}

// [Sprint 4 · M3] US-33: what "Check connection" found, in words. { ok, text }
export function checkResultText(check, repositoryName = 'the repository') {
  if (!check) return { ok: false, text: 'The connection could not be checked. Please try again.' };
  if (check.token === 'unreadable') return { ok: false, text: 'The stored GitHub authorization can no longer be read on this server. Re-authorize GitHub.' };
  if (check.token === 'rejected') return { ok: false, text: 'GitHub no longer accepts this project\'s authorization (it may have expired or been revoked). Re-authorize GitHub.' };
  if (check.repository === 'not_accessible') return { ok: false, text: `The authorization works, but the GitHub account can no longer read ${repositoryName}.` };
  if (check.repository === 'none') return { ok: true, text: 'The authorization works. No repository is chosen yet.' };
  return { ok: true, text: `Connection checked: the authorization works and ${repositoryName} can be read.` };
}

const DISCONNECTED_TEXT = 'No new GitHub events are added to the Activity Feed. Earlier entries stay.';

export default function GithubIntegrationPanel({
  projectId,
  api = githubApi,
  navigateTo = (url) => window.location.assign(url),
  onChange,
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [result, setResult] = useState(null);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false); // [Sprint 4 · M2] repository picker open
  // [Sprint 4 · M3] US-33
  const [checking, setChecking] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState('');

  // Coming back from GitHub: show the outcome once, then drop ?github so a refresh does not repeat it.
  const returned = searchParams.get('github');
  useEffect(() => {
    if (!returned) return;
    setResult(githubResult(returned));
    const next = new URLSearchParams(searchParams);
    next.delete('github');
    setSearchParams(next, { replace: true });
  }, [returned, searchParams, setSearchParams]);

  const load = useCallback(() => {
    let active = true;
    setLoadError('');
    api.status(projectId)
      .then((data) => { if (active) setStatus(data); })
      .catch((e) => { if (active) { setStatus(null); setLoadError(e.message || 'Could not load the GitHub connection.'); } });
    return () => { active = false; };
  }, [projectId, api]);

  useEffect(() => load(), [load]);

  // Connect (US-31) and Re-authorize (US-33) are the same GitHub flow; the server tells them apart.
  const connect = async () => {
    setActionError('');
    setResult(null);
    setBusy(true);
    try {
      const { url } = await api.authorize(projectId);
      if (!url || !url.startsWith('https://github.com/')) throw new Error('GitHub did not return a valid sign-in link.');
      navigateTo(url);
    } catch (e) {
      setActionError(e.message || 'Could not start the GitHub connection.');
      setBusy(false);
    }
  };

  // [Sprint 4 · M3] US-33: Check connection (token + repository access, on the server).
  const checkConnection = async () => {
    setActionError('');
    setResult(null);
    setChecking(true);
    try {
      const { check, ...next } = await api.verify(projectId);
      setStatus(next);
      setResult(checkResultText(check, next?.repository?.fullName));
    } catch (e) {
      setActionError(e.message || 'Could not check the GitHub connection.');
    } finally {
      setChecking(false);
    }
  };

  // [Sprint 4 · M3] US-33: Disconnect, after the confirmation dialog.
  const disconnect = async () => {
    setDisconnectError('');
    setDisconnecting(true);
    try {
      const { revokedOnGithub: _revoked, ...next } = await api.disconnect(projectId);
      setStatus(next);
      setConfirmingDisconnect(false);
      setPicking(false);
      setActionError('');
      setResult({ ok: true, text: `GitHub was disconnected from this project. ${DISCONNECTED_TEXT}` });
      onChange?.();
    } catch (e) {
      setDisconnectError(e.message || 'Could not disconnect GitHub.');
    } finally {
      setDisconnecting(false);
    }
  };

  const connection = status?.connection || null;
  const loading = !status && !loadError;
  // [Sprint 4 · M2] US-32. The API decides the state; the fallback covers an older API without these fields.
  const state = status?.connectionState || (connection ? 'needs_repository' : 'not_connected');
  const disconnected = state === 'disconnected';
  // [Sprint 4 · M3] US-33: the repository is shown for every state that has one, not only Active.
  const repository = state === 'needs_repository' || state === 'not_connected' || state === 'unavailable'
    ? null
    : status?.repository || null;
  const canSelectRepository = Boolean(status?.canSelectRepository);
  const canReauthorize = Boolean(connection && status?.canReauthorize && status?.configured);
  const canDisconnect = Boolean(connection && status?.canDisconnect);
  const canVerify = Boolean(connection && status?.canVerify);
  const actionsBusy = busy || checking || disconnecting;

  const repositorySelected = (next) => {
    setStatus(next);
    setPicking(false);
    setActionError('');
    setResult({ ok: true, text: `${next?.repository?.fullName || 'The repository'} is connected. The GitHub connection is Active.` });
    onChange?.();
  };

  return (
    <section className="panel github-panel" aria-label="GitHub integration">
      <div className="panel-head">
        <div><div className="eyebrow">INTEGRATIONS</div><h2 className="with-icon" style={{ marginTop: 6 }}><Github size={17} /> GitHub</h2></div>
        {state === 'active' && <span className="pill green">Active</span>}
        {connection && state === 'needs_repository' && <span className="pill purple">Authorized</span>}
        {connection && state === 'unavailable' && <span className="pill orange">Unavailable</span>}
        {/* [Sprint 4 · M3] US-33 */}
        {connection && state === 'needs_reauthorization' && <span className="pill orange">Re-authorization needed</span>}
        {connection && state === 'repository_unavailable' && <span className="pill orange">Repository unavailable</span>}
        {connection && state === 'unverified' && <span className="pill purple">Not verified</span>}
        {connection && disconnected && <span className="pill">Disconnected</span>}
        {status && !connection && <span className="pill">Not connected</span>}
      </div>

      {result && <p className={result.ok ? 'success-inline' : 'form-error'} role={result.ok ? 'status' : 'alert'}>{result.text}</p>}

      {loading && <p className="team-note">Loading GitHub status…</p>}
      {loadError && <div className="form-error" role="alert">{loadError}</div>}

      {/* [Sprint 4 · M3] US-33 AC1: the connection status in words, next to the repository name.
          One text node on purpose: the badge above stays the only element whose text is exactly "Active". */}
      {connection && (
        <p className="github-status-line" data-testid="github-connection-status">
          {`Connection status: ${connectionStateLabel(state)}`}
        </p>
      )}

      {connection && !disconnected && (
        <div className="github-account">
          <p><b>Authorized as @{connection.githubLogin}</b></p>
          <small>
            {connection.authorizedBy?.name ? `By ${connection.authorizedBy.name}` : 'Authorized'}
            {formatAuthorizedAt(connection.authorizedAt) ? ` · ${formatAuthorizedAt(connection.authorizedAt)}` : ''}
          </small>
        </div>
      )}
      {/* [Sprint 4 · M3] US-33: disconnected. The account and repository are kept for Re-authorize. */}
      {connection && disconnected && (
        <div className="github-account github-disconnected">
          <p><b>{`Was authorized as @${connection.githubLogin}`}</b></p>
          <small>
            {status?.disconnectedBy?.name ? `By ${status.disconnectedBy.name}` : 'Disconnected'}
            {formatAuthorizedAt(status?.disconnectedAt) ? ` · ${formatAuthorizedAt(status.disconnectedAt)}` : ''}
          </small>
        </div>
      )}

      {/* [Sprint 4 · M2] US-32: the connected repository, or choosing one. */}
      {repository && (
        <div className="github-account github-repo-connected">
          <p>
            {disconnected && <span className="github-repo-prefix">Last repository: </span>}
            <a href={repository.htmlUrl} target="_blank" rel="noopener noreferrer"><b>{repository.fullName}</b></a>
          </p>
          <small>
            {repository.private ? <><Lock size={9} aria-hidden="true" /> Private</> : 'Public'} repository
            {repository.connectedBy?.name ? ` · Connected by ${repository.connectedBy.name}` : ''}
            {formatAuthorizedAt(repository.connectedAt) ? ` · ${formatAuthorizedAt(repository.connectedAt)}` : ''}
          </small>
        </div>
      )}
      {/* [Sprint 4 · M4] US-34: webhook status + recent deliveries.
          [Sprint 4 · M3] US-33: not after a disconnect (the hook was removed; nothing to set up). */}
      {repository && !disconnected && <GithubWebhookStatus projectId={projectId} webhook={status?.webhook} api={api} />}
      {state === 'active' && canSelectRepository && !picking && (
        <button type="button" className="link github-change-repo" onClick={() => { setResult(null); setPicking(true); }}>Change repository</button>
      )}
      {state === 'needs_repository' && canSelectRepository && !picking && (
        <>
          <p className="team-note github-next-step">Next, choose the one repository whose activity should flow into this project.</p>
          <Btn icon={Github} onClick={() => { setResult(null); setPicking(true); }}>Choose repository</Btn>
        </>
      )}
      {state === 'needs_repository' && connection && !canSelectRepository && (
        <p className="team-note github-next-step">Waiting for the project Owner to choose a repository.</p>
      )}
      {state === 'unavailable' && (
        <p className="team-note github-next-step">GitHub is not set up on this server right now, so this connection cannot be used. The GitHub OAuth settings need to be added to backend/.env.</p>
      )}

      {/* [Sprint 4 · M3] US-33: what each state means and what fixes it. */}
      {state === 'needs_reauthorization' && (
        <p className="team-note github-next-step">
          {status?.reauthorizationReason === 'token_unreadable'
            ? 'The stored GitHub authorization can no longer be read on this server.'
            : 'GitHub no longer accepts this project\'s authorization (it may have expired or been revoked).'}
          {' '}Re-authorize GitHub to make the connection Active again.
        </p>
      )}
      {state === 'repository_unavailable' && (
        <p className="team-note github-next-step">
          The authorized GitHub account can no longer read this repository. Re-authorize with an account that can
          {canSelectRepository ? ', or choose another repository.' : '.'}
        </p>
      )}
      {state === 'repository_unavailable' && canSelectRepository && !picking && (
        <button type="button" className="link github-change-repo" onClick={() => { setResult(null); setPicking(true); }}>Choose another repository</button>
      )}
      {state === 'unverified' && (
        <p className="team-note github-next-step">GitHub was re-authorized, but access to the repository could not be confirmed yet. Use Check connection.</p>
      )}
      {disconnected && (
        <p className="team-note github-next-step">{DISCONNECTED_TEXT}{canReauthorize ? ' Re-authorize GitHub to connect it again.' : ''}</p>
      )}

      {picking && canSelectRepository && (
        <GithubRepositoryPicker
          projectId={projectId}
          api={api}
          onSelected={repositorySelected}
          onCancel={state === 'active' || state === 'repository_unavailable' ? () => setPicking(false) : undefined}
        />
      )}

      {status && !connection && status.canAuthorize && status.configured && (
        <>
          <p className="team-note">Connect GitHub so DevOrbit can read your repositories. You will approve access on GitHub and come straight back here.</p>
          <Btn icon={Github} onClick={connect} disabled={busy}>{busy ? 'Opening GitHub…' : 'Connect GitHub'}</Btn>
        </>
      )}
      {status && !connection && status.canAuthorize && !status.configured && (
        <p className="team-note">GitHub is not set up on this server yet. The GitHub OAuth settings need to be added to backend/.env before you can connect.</p>
      )}
      {status && !connection && !status.canAuthorize && (
        <p className="team-note">Only the project Owner can connect GitHub.</p>
      )}

      {/* [Sprint 4 · M3] US-33: Owner and Admin actions. */}
      {connection && !picking && (canVerify || canReauthorize || canDisconnect) && (
        <div className="github-actions" role="group" aria-label="Manage the GitHub connection">
          {canVerify && (
            <Btn secondary icon={RefreshCw} onClick={checkConnection} disabled={actionsBusy}>{checking ? 'Checking…' : 'Check connection'}</Btn>
          )}
          {canReauthorize && (
            <Btn secondary={state === 'active'} icon={Github} onClick={connect} disabled={actionsBusy}>{busy ? 'Opening GitHub…' : 'Re-authorize GitHub'}</Btn>
          )}
          {canDisconnect && (
            <Btn secondary icon={Unlink} className="github-disconnect" onClick={() => { setDisconnectError(''); setConfirmingDisconnect(true); }} disabled={actionsBusy}>Disconnect</Btn>
          )}
        </div>
      )}

      {actionError && <div className="form-error" role="alert">{actionError}</div>}

      <ConfirmDialog
        open={confirmingDisconnect}
        title="Disconnect GitHub?"
        confirmLabel="Disconnect"
        danger
        busy={disconnecting}
        error={disconnectError}
        onConfirm={disconnect}
        onCancel={() => setConfirmingDisconnect(false)}
      >
        <p>
          {repository?.fullName ? <><b>{repository.fullName}</b> will be disconnected from this project. </> : 'GitHub will be disconnected from this project. '}
          {DISCONNECTED_TEXT} The stored GitHub authorization is removed; the Owner or an Admin can re-authorize later.
        </p>
      </ConfirmDialog>
    </section>
  );
}

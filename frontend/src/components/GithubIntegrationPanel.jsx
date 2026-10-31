import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Github } from 'lucide-react';
import { githubApi } from '../api';
import { Btn } from './ui';

/*
 * [Sprint 4 · M1] US-31 Authorize GitHub. Project integration settings for the Owner and Admins.
 *
 * "Connect GitHub" (Owner only) asks the API for a GitHub authorize URL and sends the browser there.
 * GitHub sends the Owner back to /project/<id>?github=<result>; this panel shows what happened and
 * removes ?github from the URL. The access token never reaches the browser: the API only says
 * which GitHub account was authorized, by whom and when.
 *
 * Picking a repository (US-32) and disconnect / re-authorize (US-33) come later.
 */

const NOT_SAVED = 'Nothing was saved.';
export const GITHUB_RESULTS = {
  connected: { ok: true, text: 'GitHub is connected. FORGE can now read your repositories.' },
  denied: { ok: false, text: `The GitHub connection was not made because access was denied on GitHub. ${NOT_SAVED}` },
  expired: { ok: false, text: `The GitHub connection was not made because the request expired or was already used. ${NOT_SAVED} Try Connect GitHub again.` },
  invalid: { ok: false, text: `The GitHub connection was not made because the request could not be verified. ${NOT_SAVED} Start again from this page.` },
  forbidden: { ok: false, text: `The GitHub connection was not made because only the project Owner can connect GitHub. ${NOT_SAVED}` },
  error: { ok: false, text: `The GitHub connection was not made because something went wrong. ${NOT_SAVED} Please try again.` },
};

export function githubResult(value) {
  return GITHUB_RESULTS[value] || GITHUB_RESULTS.error;
}

export function formatAuthorizedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function GithubIntegrationPanel({
  projectId,
  api = githubApi,
  navigateTo = (url) => window.location.assign(url),
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [result, setResult] = useState(null);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

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

  const connection = status?.connection || null;
  const loading = !status && !loadError;

  return (
    <section className="panel github-panel" aria-label="GitHub integration">
      <div className="panel-head">
        <div><div className="eyebrow">INTEGRATIONS</div><h2 className="with-icon" style={{ marginTop: 6 }}><Github size={17} /> GitHub</h2></div>
        {connection && <span className="pill green">Authorized</span>}
        {status && !connection && <span className="pill">Not connected</span>}
      </div>

      {result && <p className={result.ok ? 'success-inline' : 'form-error'} role={result.ok ? 'status' : 'alert'}>{result.text}</p>}

      {loading && <p className="team-note">Loading GitHub status…</p>}
      {loadError && <div className="form-error" role="alert">{loadError}</div>}

      {connection && (
        <div className="github-account">
          <p><b>Authorized as @{connection.githubLogin}</b></p>
          <small>
            {connection.authorizedBy?.name ? `By ${connection.authorizedBy.name}` : 'Authorized'}
            {formatAuthorizedAt(connection.authorizedAt) ? ` · ${formatAuthorizedAt(connection.authorizedAt)}` : ''}
          </small>
        </div>
      )}

      {status && !connection && status.canAuthorize && status.configured && (
        <>
          <p className="team-note">Connect GitHub so FORGE can read your repositories. You will approve access on GitHub and come straight back here.</p>
          <Btn icon={Github} onClick={connect} disabled={busy}>{busy ? 'Opening GitHub…' : 'Connect GitHub'}</Btn>
        </>
      )}
      {status && !connection && status.canAuthorize && !status.configured && (
        <p className="team-note">GitHub is not set up on this server yet. The GitHub OAuth settings need to be added to backend/.env before you can connect.</p>
      )}
      {status && !connection && !status.canAuthorize && (
        <p className="team-note">Only the project Owner can connect GitHub.</p>
      )}

      {actionError && <div className="form-error" role="alert">{actionError}</div>}
    </section>
  );
}

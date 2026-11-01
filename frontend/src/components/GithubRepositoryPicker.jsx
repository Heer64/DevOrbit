import { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock, RefreshCw, Search } from 'lucide-react';
import { githubApi } from '../api';
import { Btn } from './ui';

/*
 * [Sprint 4 · M2] US-32 Connect a repository: the Owner picks one repository from the GitHub
 * account authorized in US-31. The list comes from the API (GET /api/projects/:id/github/repositories);
 * the server checks the choice again before saving it, so this list is only a convenience.
 *
 * Props
 *   projectId
 *   api            githubApi (tests pass a fake)
 *   onSelected(s)  called with the new GitHub status after the repository is saved (it is Active then)
 *   onCancel()     optional; shows a Cancel button (used when changing an existing repository)
 */

// Friendly text for the error codes of backend/src/routes/githubRepository.js.
export const REPOSITORY_ERRORS = {
  github_reauthorize: 'GitHub no longer accepts this project\'s authorization. Re-authorize GitHub, then choose a repository.',
  github_not_authorized: 'Connect GitHub first, then choose a repository.',
  github_not_configured: 'GitHub is not set up on this server yet, so repositories cannot be listed.',
  github_rate_limited: 'GitHub\'s rate limit has been reached. Please try again in a few minutes.',
  github_changed: 'The GitHub authorization changed while you were choosing. Reload the list and try again.',
  repository_not_available: 'That repository is no longer available to the authorized GitHub account. Reload the list and choose another.',
  owner_only: 'Only the project Owner can choose the GitHub repository.',
};

export function repositoryErrorText(error, fallback) {
  const code = error?.response?.data?.code;
  return REPOSITORY_ERRORS[code] || error?.message || fallback;
}

const FILTER_FROM = 8; // show the search box once the list is longer than this

export default function GithubRepositoryPicker({ projectId, api = githubApi, onSelected, onCancel }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('');
  const [choice, setChoice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const load = useCallback(() => {
    let active = true;
    setData(null);
    setLoadError('');
    setSaveError('');
    api.repositories(projectId)
      .then((result) => {
        if (!active) return;
        setData(result);
        setChoice(result.selectedId ?? null);
      })
      .catch((e) => { if (active) setLoadError(repositoryErrorText(e, 'Could not load your GitHub repositories.')); });
    return () => { active = false; };
  }, [projectId, api]);

  useEffect(() => load(), [load]);

  const repositories = data?.repositories || [];
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return repositories;
    return repositories.filter((repo) => repo.fullName.toLowerCase().includes(needle));
  }, [repositories, filter]);

  const save = async (event) => {
    event.preventDefault();
    if (!choice) { setSaveError('Choose a repository first.'); return; }
    setSaving(true);
    setSaveError('');
    try {
      const status = await api.selectRepository(projectId, choice);
      onSelected?.(status);
    } catch (e) {
      setSaveError(repositoryErrorText(e, 'Could not connect the repository.'));
      setSaving(false);
    }
  };

  if (!data && !loadError) return <p className="team-note" role="status">Loading your GitHub repositories…</p>;

  if (loadError) {
    return (
      <div className="form-error" role="alert">
        {loadError}{' '}
        <button type="button" className="link" onClick={load}><RefreshCw size={12} /> Try again</button>
        {onCancel && <button type="button" className="link" onClick={onCancel}>Cancel</button>}
      </div>
    );
  }

  if (repositories.length === 0) {
    return (
      <div className="github-repo-empty">
        <p className="team-note">No repositories were found for @{data.githubLogin}. Create one on GitHub (or ask to be added to one), then reload the list.</p>
        <Btn secondary icon={RefreshCw} onClick={load}>Reload list</Btn>
        {onCancel && <button type="button" className="link" onClick={onCancel}>Cancel</button>}
      </div>
    );
  }

  const selectedChanged = choice !== null && choice !== (data.selectedId ?? null);

  return (
    <form className="github-repo-picker" onSubmit={save} aria-label="Choose a GitHub repository">
      <p className="team-note">Choose the one repository from @{data.githubLogin} whose activity belongs to this project.</p>
      {repositories.length > FILTER_FROM && (
        <label className="github-repo-filter">
          <Search size={13} aria-hidden="true" />
          <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter repositories" aria-label="Filter repositories" />
        </label>
      )}
      <div className="github-repo-list" role="radiogroup" aria-label="Your GitHub repositories">
        {shown.length === 0 && <p className="team-note">No repository matches “{filter}”.</p>}
        {shown.map((repo) => (
          <label key={repo.id} className={`github-repo-option ${choice === repo.id ? 'chosen' : ''}`}>
            <input type="radio" name={`github-repo-${projectId}`} value={repo.id} checked={choice === repo.id} onChange={() => { setChoice(repo.id); setSaveError(''); }} />
            <span className="github-repo-copy">
              <b>{repo.fullName}</b>
              <small>
                {repo.private ? <><Lock size={10} aria-hidden="true" /> Private</> : 'Public'}
                {repo.archived ? ' · Archived' : ''}
                {repo.id === data.selectedId ? ' · Connected now' : ''}
              </small>
            </span>
          </label>
        ))}
      </div>
      {data.truncated && <p className="team-note">Showing the {repositories.length} most recently updated repositories.</p>}
      {saveError && <div className="form-error" role="alert">{saveError}</div>}
      <div className="github-repo-actions">
        <Btn type="submit" disabled={saving || !selectedChanged}>{saving ? 'Connecting…' : 'Connect repository'}</Btn>
        {onCancel && <Btn secondary onClick={onCancel} disabled={saving}>Cancel</Btn>}
      </div>
    </form>
  );
}

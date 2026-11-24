import { useEffect, useState } from 'react';
import {
  Code2,
  ExternalLink,
  File,
  FileCode2,
  FileText,
  Folder,
  GitBranch,
  GitFork,
  GitPullRequest,
  Github,
  Lock,
  RefreshCw,
  Star,
} from 'lucide-react';
import { githubApi } from '../api';
import { timeAgo } from './activityDisplay';
import './ProjectCodePanel.css';

/*
 * [Sprint 7 · M8] D3 fix (Sprint 4 re-test): the "Code & files" panel of a REAL project.
 *
 * Before: every project showed the visual prototype's sample data ("12 forks · 4 open PRs · 128 commits",
 * files src / server / README.md "Updated 2h ago"), even with no repository connected.
 * Now it shows only what GitHub says about the project's connected repository
 * (GET /api/projects/:id/github/code, backend/src/routes/githubCode.js):
 *   - the repository name (opens on GitHub), its default branch, Private/Public
 *   - stars, forks, open issues & pull requests (GitHub counts them together), last push
 *   - the top-level files and folders of the default branch, each opening on GitHub in a new tab
 * No repository -> "No repository connected" (Owner/Admin are pointed to the GitHub panel; others are told
 * to ask the Owner). GitHub unreachable or authorization expired -> a short message, never made-up numbers.
 * Demo / sample projects keep the sample panel in ProjectPage.jsx, marked SAMPLE.
 */

const FILE_TONES = { md: 'purple', json: 'orange', js: 'green', jsx: 'green', ts: 'blue', tsx: 'blue' };

function fileIcon(file) {
  if (file.type === 'dir') return { Icon: Folder, tone: 'blue' };
  const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
  if (ext === 'md') return { Icon: FileText, tone: FILE_TONES.md };
  if (['json', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'yml', 'yaml'].includes(ext)) return { Icon: FileCode2, tone: FILE_TONES[ext] || 'orange' };
  return { Icon: File, tone: 'gray' };
}

// Only github.com links are ever rendered (the API checks this too).
export function safeGithubHref(value) {
  return typeof value === 'string' && /^https:\/\/github\.com\/[^\s"'<>]+$/.test(value) ? value : null;
}

export const CODE_PANEL_TEXT = {
  loading: 'Loading the repository…',
  loadFailed: 'Could not load the repository. Please try again.',
  noRepository: 'No repository connected.',
  ownerHint: 'Connect GitHub and choose a repository in the GitHub panel on this page.',
  memberHint: 'Ask the project Owner to connect a repository.',
  needsRepository: 'GitHub is authorized, but no repository is chosen yet.',
  disconnected: 'GitHub was disconnected from this project.',
  empty: 'This repository is empty. Push a first commit to see its files here.',
};

const count = (value, one, many) => `${value} ${value === 1 ? one : many}`;

export default function ProjectCodePanel({ projectId, canManage = false, api = githubApi }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setError('');
    api.code(projectId)
      .then((body) => { if (active) setData(body); })
      .catch((e) => { if (active) { setData(null); setError(e?.message || CODE_PANEL_TEXT.loadFailed); } });
    return () => { active = false; };
  }, [projectId, api, version]);

  const loading = !data && !error;
  const state = data?.state;
  const repository = data?.repository || null;
  const repoHref = safeGithubHref(repository?.htmlUrl);
  const hint = canManage ? CODE_PANEL_TEXT.ownerHint : CODE_PANEL_TEXT.memberHint;

  return (
    <section className="panel project-code-panel" aria-label="Code and files">
      <div className="panel-head">
        <div><div className="eyebrow">DEVELOPMENT</div><h2 className="with-icon" style={{ marginTop: 6 }}><Code2 size={17} /> Code &amp; files</h2></div>
        {(state === 'unavailable' || error) && (
          <button className="iconbtn" onClick={() => setVersion((n) => n + 1)} title="Try again" aria-label="Reload repository"><RefreshCw size={15} /></button>
        )}
      </div>

      {loading && <p className="team-note" role="status">{CODE_PANEL_TEXT.loading}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      {(state === 'not_connected' || state === 'needs_repository' || state === 'disconnected') && (
        <div className="code-empty" data-testid="code-empty">
          <Github size={22} aria-hidden="true" />
          <p><b>{CODE_PANEL_TEXT.noRepository}</b></p>
          <small>
            {state === 'needs_repository' && `${CODE_PANEL_TEXT.needsRepository} `}
            {state === 'disconnected' && `${CODE_PANEL_TEXT.disconnected} `}
            {hint}
          </small>
        </div>
      )}

      {repository && (
        <div className="repo-box">
          <Github size={19} />
          <div>
            {repoHref
              ? <a href={repoHref} target="_blank" rel="noopener noreferrer"><b>{repository.fullName}</b></a>
              : <b>{repository.fullName}</b>}
            <small>{repository.private ? <><Lock size={9} aria-hidden="true" /> Private repository</> : 'Public repository'}</small>
          </div>
          {repository.defaultBranch && <span className="pill"><GitBranch size={11} /> {repository.defaultBranch}</span>}
        </div>
      )}

      {state === 'unavailable' && (
        <p className="team-note code-unavailable" role="status">{data?.message || CODE_PANEL_TEXT.loadFailed}</p>
      )}

      {state === 'active' && data.stats && (
        <div className="repo-stats" aria-label="Repository numbers">
          <span><Star size={13} /> {count(data.stats.stars, 'star', 'stars')}</span>
          <span><GitFork size={13} /> {count(data.stats.forks, 'fork', 'forks')}</span>
          <span><GitPullRequest size={13} /> {count(data.stats.openIssuesAndPrs, 'open issue or PR', 'open issues & PRs')}</span>
          {data.stats.pushedAt && <span>Last push: {timeAgo(data.stats.pushedAt)}</span>}
        </div>
      )}

      {state === 'active' && data.empty && <p className="team-note">{CODE_PANEL_TEXT.empty}</p>}

      {state === 'active' && data.files?.length > 0 && (
        <ul className="code-files" aria-label="Files at the top of the repository">
          {data.files.map((file) => {
            const { Icon, tone } = fileIcon(file);
            const href = safeGithubHref(file.htmlUrl);
            const body = (
              <>
                <span className={`file-icon ${tone}`}><Icon size={16} /></span>
                <span className="file-copy"><b>{file.name}</b><small>{file.type === 'dir' ? 'Folder' : 'File'}</small></span>
                {href && <ExternalLink size={14} className="file-open" aria-hidden="true" />}
              </>
            );
            return (
              <li key={`${file.type}:${file.name}`}>
                {href
                  ? <a className="file-row" href={href} target="_blank" rel="noopener noreferrer">{body}</a>
                  : <span className="file-row">{body}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {state === 'active' && data.moreFiles && (
        <p className="team-note code-more">{`Showing ${data.files.length} of ${data.filesTotal}. Open the repository to see the rest.`}</p>
      )}

      {state === 'active' && repoHref && (
        <a className="btn secondary repo-link-btn" href={repoHref} target="_blank" rel="noopener noreferrer">
          Open on GitHub <ExternalLink size={14} />
        </a>
      )}
    </section>
  );
}

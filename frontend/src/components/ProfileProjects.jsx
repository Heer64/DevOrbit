import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Globe2, Lock } from 'lucide-react';
import { profileApi } from '../api';
import { tone } from './ui';

/*
 * [Sprint 7 · M4] A user's projects on their profile (/people/:username).
 * The server decides what is shown: Public projects, plus Private ones only when you are a
 * member of them too. Each one links to its project page: the workspace (/project/:id) when you
 * are a member, otherwise the read-only public project page (/discover/:id).
 * Contract: GET /api/profile/users/:username/projects (backend/src/routes/profile.js)
 *   -> { projects: [{ _id, name, description, domain, status, visibility, tags, color, role,
 *                     memberCount, viewerIsMember, path }] }
 */
export default function ProfileProjects({ username, name, isMe = false, api = profileApi }) {
  const [state, setState] = useState({ loading: true, projects: [], error: '' });
  const canLoad = typeof api?.projects === 'function';

  useEffect(() => {
    if (!canLoad || !username) return undefined;
    let active = true;
    setState({ loading: true, projects: [], error: '' });
    api
      .projects(username)
      .then((result) => {
        if (active) setState({ loading: false, projects: result.projects || [], error: '' });
      })
      .catch((error) => {
        if (active) setState({ loading: false, projects: [], error: error?.message || 'Could not load projects.' });
      });
    return () => {
      active = false;
    };
  }, [api, username, canLoad]);

  if (!canLoad || !username) return null;
  const owner = isMe ? 'your' : `${name || username}’s`;

  return (
    <section className="panel" aria-label="Projects">
      <div className="panel-head">
        <div>
          <div className="eyebrow">PROJECTS</div>
          <h2 style={{ marginTop: 6 }}>
            Projects{' '}
            <span className="pill" style={{ marginLeft: 6 }}>
              {state.projects.length}
            </span>
          </h2>
          <p>Public projects, plus private ones you are a member of too.</p>
        </div>
      </div>
      {state.loading && <p className="team-note">Loading projects…</p>}
      {state.error && (
        <div className="form-error" role="alert">
          {state.error}
        </div>
      )}
      {!state.loading && !state.error && state.projects.length === 0 && (
        <p className="empty-inline">No projects to show on {owner} profile yet.</p>
      )}
      {state.projects.map((project) => (
        <Link className="profile-project" key={project._id} to={project.path} aria-label={`Open ${project.name}`}>
          <span className={`project-avatar ${tone(project.color)}`}>{(project.name || '?')[0]}</span>
          <span>
            <b>
              {project.name}{' '}
              <span className={`pill ${project.status === 'Completed' ? 'green' : 'purple'}`} style={{ marginLeft: 4 }}>
                {project.status}
              </span>{' '}
              <span className="pill" title={project.visibility === 'Private' ? 'Private: you are a member' : 'Public'}>
                {project.visibility === 'Private' ? <Lock size={10} /> : <Globe2 size={10} />} {project.visibility}
              </span>
            </b>
            <small>
              {[project.role, project.domain, `${project.memberCount} ${project.memberCount === 1 ? 'member' : 'members'}`]
                .filter(Boolean)
                .join(' · ')}
            </small>
            {project.description && <small>{project.description}</small>}
            {project.tags?.length > 0 && (
              <span className="tags">
                {project.tags.map((tag) => (
                  <i key={tag}>{tag}</i>
                ))}
              </span>
            )}
          </span>
          <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      ))}
    </section>
  );
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 7 · M4] What this file does
 * Lists the projects you may see on someone's profile (Public, or Private when you are in it
 * too), with their role, status and size, each linking to the right project page.
 * ---------------------------------------------------------------------------
 */

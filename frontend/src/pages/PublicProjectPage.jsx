import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Lock, LogIn, UserPlus, Users } from 'lucide-react';
import { publicApi } from '../api';
import { useAuth } from '../context/AuthContext';
import { Avatar, AVATAR_TONES, initialsOf } from '../components/ui';
import JoinRequestCard from '../components/JoinRequestCard';
import { workspacePath } from '../lib/publicLinks';

/*
 * [Sprint 5 · M2] US-46 View a public project page (Actor: Visitor) at /discover/:projectId.
 *   AC1: shows the project's name, description, domain, status and member names. Nothing here can be edited.
 *   AC2: channels, messages, tasks and files are never shown (the API does not even send them).
 * Opens without logging in (PublicShell) and inside the app for logged-in users (AppShell).
 *
 * [Sprint 5 · M2] US-47 Request to join, on the same page:
 *   - not logged in: "Request to join" takes them to the login page first, then back here (AC3);
 *   - logged in, not a member: the Sprint 3 JoinRequestCard (one pending request, optional message) (AC1, AC2);
 *   - a member: a link into the project workspace instead.
 * A Private or missing project shows "This project is not available." and nothing else.
 */
export const NOT_AVAILABLE = 'This project is not available.';

export default function PublicProjectPage({ api = publicApi, joinApi }) {
  const { projectId } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const [state, setState] = useState({ loading: true, project: null, error: '' });
  const [isMember, setIsMember] = useState(false);

  useEffect(() => {
    let active = true;
    setState({ loading: true, project: null, error: '' });
    setIsMember(false);
    api
      .project(projectId)
      .then((result) => {
        if (active) setState({ loading: false, project: result.project, error: '' });
      })
      .catch((error) => {
        if (!active) return;
        const message = error?.status === 404 || error?.status === 400 ? NOT_AVAILABLE : error?.message || 'Could not load this project.';
        setState({ loading: false, project: null, error: message });
      });
    return () => {
      active = false;
    };
  }, [api, projectId]);

  const backLink = (
    <Link to="/discover" className="back-link">
      <ArrowLeft size={16} /> Back to Discover
    </Link>
  );

  if (state.loading)
    return (
      <>
        {backLink}
        <section className="panel">
          <p className="team-note">Loading project…</p>
        </section>
      </>
    );
  if (state.error) {
    return (
      <>
        {backLink}
        <section className="panel portfolio-unavailable">
          <div className="eyebrow">PUBLIC PROJECT</div>
          <h2 role="alert">{state.error}</h2>
          {state.error === NOT_AVAILABLE && <p className="team-note">It may be private, or the link may be wrong.</p>}
        </section>
      </>
    );
  }

  const project = state.project;
  const names = Array.isArray(project.memberNames) ? project.memberNames : [];
  const loggedInReal = Boolean(user && !user.isDemo);

  return (
    <>
      {backLink}
      <div className="project-heading">
        <div className="project-avatar huge violet" aria-hidden="true">
          {initialsOf(project.name)}
        </div>
        <div className="project-title">
          <div className="kicker">
            <span className="eyebrow">PUBLIC PROJECT</span>
            <span className="pill" title="Domain">
              {project.domain}
            </span>
            <span className="pill" title="Project status">
              {project.status}
            </span>
          </div>
          <h1>{project.name}</h1>
          {project.description ? <p>{project.description}</p> : <p className="team-note">No description yet.</p>}
          <div className="meta">
            <span>
              <Users size={12} /> {names.length} member{names.length === 1 ? '' : 's'}
            </span>
            <span>
              <Lock size={12} /> Read-only page
            </span>
          </div>
        </div>
      </div>

      <div className="project-body">
        <section className="panel" aria-label="Members">
          <div className="panel-head">
            <div>
              <div className="eyebrow">TEAM</div>
              <h2 className="with-icon" style={{ marginTop: 6 }}>
                <Users size={17} /> Members
              </h2>
            </div>
          </div>
          {names.length === 0 && <p className="team-note">No members to show.</p>}
          {names.length > 0 && (
            <ul className="public-members" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
              {names.map((name, i) => (
                <li key={`${name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <Avatar initials={initialsOf(name)} tone={AVATAR_TONES[i % AVATAR_TONES.length]} small />
                  <span>{name}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="team-note" style={{ marginTop: 14 }}>
            Channels, messages, tasks and files are visible to project members only.
          </p>
        </section>

        <aside className="stack-right">
          {!user && <VisitorJoinPrompt from={{ pathname: location.pathname, search: location.search }} />}
          {user?.isDemo && (
            <section className="panel join-card" aria-label="Join this project">
              <div className="panel-head">
                <div>
                  <div className="eyebrow">JOIN</div>
                  <h2 className="with-icon" style={{ marginTop: 6 }}>
                    <UserPlus size={17} /> Request to join
                  </h2>
                </div>
              </div>
              <p className="team-note">Join requests need a real account. Log out of the demo and sign up or log in to ask to join.</p>
            </section>
          )}
          {loggedInReal && isMember && (
            <section className="panel" aria-label="Your project">
              <div className="panel-head">
                <div>
                  <div className="eyebrow">MEMBER</div>
                  <h2 style={{ marginTop: 6 }}>You are a member</h2>
                </div>
              </div>
              <p className="team-note">Open the workspace to see tasks, chat, files and docs.</p>
              <Link to={workspacePath(project._id || projectId)} className="btn">
                Open workspace <ArrowUpRight size={14} />
              </Link>
            </section>
          )}
          {loggedInReal && (
            <JoinRequestCard
              projectId={project._id || projectId}
              onStatus={(status) => setIsMember(Boolean(status?.isMember))}
              {...(joinApi ? { api: joinApi } : {})}
            />
          )}
        </aside>
      </div>
    </>
  );
}

// US-47 AC3: a visitor who is not logged in is asked to log in first, then comes back to this page.
function VisitorJoinPrompt({ from }) {
  return (
    <section className="panel join-card" aria-label="Join this project">
      <div className="panel-head">
        <div>
          <div className="eyebrow">JOIN</div>
          <h2 className="with-icon" style={{ marginTop: 6 }}>
            <UserPlus size={17} /> Want to help build this?
          </h2>
        </div>
      </div>
      <p className="team-note">You need to log in before you can ask to join. You will come back here afterwards.</p>
      <Link to="/login" state={{ from }} className="btn">
        <LogIn size={14} /> Request to join
      </Link>
      <p className="team-note" style={{ marginTop: 10 }}>
        New to DevOrbit?{' '}
        <Link to="/signup" state={{ from }} className="link">
          Create an account
        </Link>
      </p>
    </section>
  );
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 5 · M2] What this file does
 * The public read-only page of one Public project (US-46): name, description,
 * domain, status and member names only. Visitors are asked to log in to request
 * to join; logged-in non-members get the join request card (US-47); members get
 * a link to the workspace.
 * ---------------------------------------------------------------------------
 */

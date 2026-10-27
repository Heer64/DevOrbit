import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowUpRight, Bell, Check, CheckCircle2, ChevronDown, Circle, Code2, ExternalLink, File, FileCode2, FileText, Folder, GitBranch, GitCommitHorizontal, GitFork, GitPullRequest, Github, MoreHorizontal, Plus, Settings, Sparkles, Users, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { assetUrl, liveApi, milestoneApi, projectApi, taskApi, toWorkspaceProject } from '../api';
import { AVATAR_TONES, Avatar, Btn, initialsOf, tone } from '../components/ui';
import TeamPanel from '../components/TeamPanel';
import TasksPanel from '../components/TasksPanel';
import { MOCK_MEMBERS, MOCK_USER_ID, mockTaskApi } from '../taskMock';
import { canManageMembers, canWriteTasks } from '../roles';
import MilestonesPanel from '../components/MilestonesPanel';
import ActivityPanel from '../components/ActivityPanel';
import ChatPanel from '../components/ChatPanel'; // [Sprint 2 final] US-16
import JoinRequestCard from '../components/JoinRequestCard'; // [Sprint 3 · M2] US-47
import JoinRequestsPanel from '../components/JoinRequestsPanel'; // [Sprint 3 · M2] US-12
import InvitationsPanel from '../components/InvitationsPanel'; // [Sprint 3 · M1] US-10, US-11

const projects = {
  'orbit-dashboard': { name: 'Orbit dashboard', description: 'A shared home for project progress and team momentum.', domain: 'Developer tools', repo: 'devorbit/orbit-dashboard', color: 'violet', members: ['AM', 'RK', 'JS', 'NK', '+1'], health: 'On track', goal: 'Make team work feel clear, connected, and calm.', progress: 72 },
  'pulse-api': { name: 'Pulse API', description: 'Reliable, thoughtful APIs for the next generation.', domain: 'Backend', repo: 'devorbit/pulse-api', color: 'orange', members: ['AM', 'NK', 'MP'], health: 'On track', goal: 'Build a simple, dependable API foundation.', progress: 46 },
  greenlight: { name: 'Greenlight', description: 'A greener way to track everyday impact.', domain: 'Community', repo: 'devorbit/greenlight', color: 'teal', members: ['RK', 'AM', 'JS', 'DM'], health: 'Ahead of schedule', goal: 'Make everyday environmental impact more visible.', progress: 88 },
  'campus-connect': { name: 'CampusConnect', description: 'Helping students find teammates and build beyond the classroom.', domain: 'Education', repo: 'community/campus-connect', color: 'orange', members: ['RK', 'JS', 'DM', '+5'], health: 'Needs attention', goal: 'Help students find the right collaborators for their next idea.', progress: 58 },
  papertrail: { name: 'Papertrail', description: 'Turn research notes into searchable team knowledge.', domain: 'Research', repo: 'miralabs/papertrail', color: 'pink', members: ['MP', 'AM', '+4'], health: 'On track', goal: 'Keep research context easy to find and maintain.', progress: 39 },
  launchpad: { name: 'Launchpad UI', description: 'Accessible components for fast-moving teams.', domain: 'Design systems', repo: 'devmalhotra/launchpad-ui', color: 'yellow', members: ['DM', 'RK', '+5'], health: 'On track', goal: 'Make good interface patterns accessible to every team.', progress: 63 },
};
const files = [
  { name: 'src', type: 'folder', meta: 'Frontend source', tone: 'blue' },
  { name: 'server', type: 'folder', meta: 'API & services', tone: 'green' },
  { name: 'README.md', type: 'md', meta: 'Updated 2h ago', tone: 'purple' },
  { name: 'package.json', type: 'json', meta: 'Updated yesterday', tone: 'orange' },
  { name: '.env.example', type: 'env', meta: 'Updated yesterday', tone: 'gray' },
];
const commitGroups = [
  { range: 'COMMITS 18–14 · TODAY', title: 'Foundation and auth flow', count: 5, color: 'violet', dot: '', text: 'Registration and sign-in forms are wired, validation is clearer, and the protected route flow is in place.', tags: ['Auth', 'Frontend'], author: 'Aarav + Riya' },
  { range: 'COMMITS 13–10 · YESTERDAY', title: 'Dashboard structure', count: 4, color: 'blue', dot: 'c1', text: 'Project cards, progress indicators, empty states, and responsive spacing were introduced across the workspace.', tags: ['Dashboard', 'UI'], author: 'Riya Kapoor' },
  { range: 'COMMITS 9–5 · OCT 08', title: 'Task and activity groundwork', count: 5, color: 'green', dot: 'c2', text: 'Task status helpers and activity event shapes were added; API errors now return a consistent response format.', tags: ['Tasks', 'API'], author: 'Nikhil Rao' },
  { range: 'COMMITS 4–1 · OCT 07', title: 'Repository setup', count: 4, color: 'orange', dot: 'c3', text: 'Starter structure, lint rules, environment example, and CI checks were added to make local development predictable.', tags: ['Setup', 'CI'], author: 'Team' },
];
const activityIcon = { violet: 'purple', green: 'green', blue: 'blue', orange: 'orange' };

// [Sprint 2 final] Workspace tabs. The open tab (and what is open inside it) lives in the URL,
// e.g. /project/<id>?tab=tasks&task=<taskId> or ?tab=chat&channel=<channelId>&message=<messageId>,
// so notifications, the activity feed and decisions can link straight to a task or a message.
export const PROJECT_TABS = ['Tasks', 'Chat', 'Milestones', 'Activity'];
export function tabFromParam(value) {
  return PROJECT_TABS.find((tab) => tab.toLowerCase() === String(value || '').toLowerCase()) || 'Tasks';
}

export default function ProjectPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [liveProject, setLiveProject] = useState(null);
  const [projectLoadError, setProjectLoadError] = useState('');
  const [membershipRole, setMembershipRole] = useState(null);
  const [team, setTeam] = useState(null);
  // [Sprint 3 · M3] Bumped when the server says I was removed from (or left) this project, to reload it.
  const [accessVersion, setAccessVersion] = useState(0);
  // [Sprint 3 · M2] Bumped after a join request is approved so the team list reloads.
  const [teamVersion, setTeamVersion] = useState(0);
  let localProjects = [];
  try { localProjects = JSON.parse(localStorage.getItem('devorbit_local_projects') || '[]'); } catch { localProjects = []; }
  const localProject = localProjects.find((p) => p.id === id);

  useEffect(() => {
    let active = true;
    if (!user || user.isDemo || !/^[a-f0-9]{24}$/i.test(id || '')) {
      setLiveProject(null);
      setMembershipRole(null);
      setTeam(null);
      setProjectLoadError('');
      return () => { active = false; };
    }
    projectApi.get(id)
      .then((result) => { if (active) { setLiveProject(toWorkspaceProject(result.project || result, user)); setMembershipRole(result.membershipRole || null); setTeam(null); setProjectLoadError(''); } })
      .catch((error) => { if (active) { setLiveProject(null); setMembershipRole(null); setProjectLoadError(error.message || 'Could not load project details.'); } });
    return () => { active = false; };
  }, [id, user, accessVersion]);

  const project = liveProject || projects[id] || (localProject
    ? { ...localProject, domain: localProject.domain || 'Developer tools', repo: localProject.repo || 'your-team/new-repo', members: ['AM'], health: 'Just getting started', goal: 'Bring your project idea to life.' }
    : { name: 'Project workspace', description: 'Your project details and team workspace.', domain: 'New project', repo: 'your-team/new-repo', color: 'violet', members: ['AM'], health: 'Just getting started', goal: 'Bring your project idea to life.', progress: 0 });

  // Real projects (24-char Mongo ID, signed-in user) use the tasks API; demo/sample projects use the in-memory mock.
  const isLive = Boolean(user && !user.isDemo && /^[a-f0-9]{24}$/i.test(id || ''));
  const taskRole = isLive ? membershipRole : 'Owner';
  const [taskList, setTaskList] = useState([]);
  const [addTaskSignal, setAddTaskSignal] = useState(0);
  // [Sprint 2 final] Tab and deep-link targets come from the URL (see PROJECT_TABS above).
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = tabFromParam(searchParams.get('tab'));
  const openTaskId = searchParams.get('task') || '';
  const openChannelId = searchParams.get('channel') || '';
  const openMessageId = searchParams.get('message') || '';
  const openThreadId = searchParams.get('thread') || ''; // [Sprint 3] US-17/US-18: from a mention notification
  const setActiveTab = useCallback((tab, extra = {}) => {
    const next = new URLSearchParams({ tab: tab.toLowerCase() });
    for (const [key, value] of Object.entries(extra)) if (value) next.set(key, value);
    setSearchParams(next, { replace: true });
  }, [setSearchParams]);
  const [showAllCommits, setShowAllCommits] = useState(false);
  const [notice, setNotice] = useState('');

  // [Sprint 3 · M3] US-13: if an Owner/Admin removes me while this page is open, say so and reload the
  // project at once (a Private project then shows "no access", a Public one the visitor view).
  useEffect(() => {
    if (!isLive || !membershipRole) return undefined;
    return liveApi.onProject(id, 'project:access-removed', (payload) => {
      setNotice(payload?.reason === 'left' ? 'You left this project.' : 'You were removed from this project.');
      window.dispatchEvent(new Event('devorbit:projects-updated'));
      setAccessVersion((n) => n + 1);
    });
  }, [id, isLive, membershipRole]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 3200);
    return () => clearTimeout(timer);
  }, [notice]);

  // The server recalculates project.progress after every task change, so fetch the project again to show it.
  // Bumped after every task change so the Milestones and Activity tabs reload fresh numbers.
  const [workVersion, setWorkVersion] = useState(0);
  // Milestone choices for the task form. Reloaded when tasks or milestones change.
  const [milestoneOptions, setMilestoneOptions] = useState([]);
  useEffect(() => {
    let active = true;
    if (!isLive) { setMilestoneOptions([]); return () => { active = false; }; }
    milestoneApi.list(id)
      .then((result) => { if (active) setMilestoneOptions(result.milestones || []); })
      .catch(() => { if (active) setMilestoneOptions([]); });
    return () => { active = false; };
  }, [id, isLive, workVersion]);
  const refreshProgress = useCallback(() => {
    if (!isLive) return;
    setWorkVersion((n) => n + 1);
    projectApi.get(id)
      .then((result) => setLiveProject(toWorkspaceProject(result.project || result, user)))
      .catch(() => {});
  }, [id, isLive, user]);
  const openAddTask = () => { setActiveTab('Tasks'); setAddTaskSignal((n) => n + 1); };

  const color = tone(project.color);
  // Once the real team is loaded, show real members; until then fall back to what the project record gave us.
  const shownMembers = team ? team.map((member) => initialsOf(member.name)) : project.members;
  const memberCount = shownMembers.length > 1 ? shownMembers.length : 1;
  const repoLabel = project.repo || 'Repository not connected';

  return (
    <>
      <button className="back-link" onClick={() => navigate('/dashboard')}><ArrowLeft size={16} /> Back to workspace</button>
      {projectLoadError && <div className="form-error" role="alert" style={{ marginBottom: 14 }}>{projectLoadError}</div>}

      <div className="project-heading">
        <div className={`project-avatar huge ${color}`}>{project.name.slice(0, 1)}</div>
        <div className="project-title">
          <div className="kicker"><span className="eyebrow">PROJECT WORKSPACE</span><span className="pill">{project.domain}</span><span className="health"><i /> {project.health}</span></div>
          <h1>{project.name}</h1>
          <p>{project.description}</p>
          <div className="meta"><span><Github size={13} />{repoLabel}</span><span><Users size={13} />{memberCount} members</span><span><GitBranch size={13} /> main</span></div>
        </div>
        <div className="project-actions">
          {canWriteTasks(taskRole) && <Btn icon={Plus} onClick={openAddTask}>Add task</Btn>}
          <button className="iconbtn" onClick={() => setNotice('Project notification preferences are a UI prototype.')} title="Project notifications" aria-label="Project notifications"><Bell size={16} /></button>
          <button className="iconbtn" onClick={() => setNotice('Project settings will be connected to the API later.')} title="Project settings" aria-label="Project settings"><Settings size={16} /></button>
        </div>
      </div>

      <div className="project-summary">
        <section className="panel">
          <div className="panel-head"><div><h2>Project progress</h2><p>Keep the work visible and the next step clear.</p></div><span className="pill green">{project.progress >= 100 ? 'Completed' : 'In progress'}</span></div>
          <div className="big-progress">{project.progress}% <small>overall completion</small></div>
          <div className="progress"><i className={color} style={{ width: `${project.progress}%` }} /></div>
          <div className="stats"><div><small>Members</small><b>{memberCount}</b></div><div><small>Open tasks</small><b>{taskList.filter((t) => t.status !== 'Done').length}</b></div><div><small>Health</small><b style={{ fontSize: 13 }}>{project.health}</b></div></div>
        </section>
        <section className="panel north-star">
          <div className="panel-head"><div><div className="eyebrow">PROJECT NORTH STAR</div></div></div>
          <h2>{project.goal}</h2>
          <p>Keep the work visible, the context connected, and the next step clear.</p>
          <div className="about-row" style={{ marginBottom: 0 }}><small>TEAM</small></div>
          <div className="team-row">
            <div className="stack">{shownMembers.map((m, i) => <Avatar key={m + i} initials={m} src={team ? assetUrl(team[i].avatarUrl) : ''} tone={AVATAR_TONES[i % 4]} small />)}</div>
            <button className="link" onClick={() => navigate('/discover')}>Find people <ArrowUpRight size={13} /></button>
          </div>
        </section>
      </div>

      <div className="project-body">
        <section className="panel work-panel">
          <div className="panel-head"><div><h2>Project workspace</h2><p>Make it happen.</p></div><MoreHorizontal size={18} /></div>
          <div className="project-tabs">
            {PROJECT_TABS.map((t) => <button key={t} className={activeTab === t ? 'active' : ''} aria-pressed={activeTab === t} onClick={() => setActiveTab(t)}>{t}</button>)}
          </div>
          {/* Kept mounted (just hidden) so tasks are not re-fetched on every tab switch. */}
          <div hidden={activeTab !== 'Tasks'}>
            <TasksPanel
              projectId={id}
              myRole={taskRole}
              currentUserId={isLive ? user.id : MOCK_USER_ID}
              members={isLive ? (team || []) : MOCK_MEMBERS}
              api={isLive ? taskApi : mockTaskApi}
              addSignal={addTaskSignal}
              onTasksChange={setTaskList}
              onChanged={refreshProgress}
              onNotice={setNotice}
              milestones={milestoneOptions}
              openTaskId={activeTab === 'Tasks' ? openTaskId : ''}
              onCloseTask={() => { if (openTaskId) setActiveTab('Tasks'); }}
            />
          </div>
          {/* [Sprint 2 final] Project channels (US-16). Members only. */}
          {activeTab === 'Chat' && isLive && membershipRole && (
            <ChatPanel
              projectId={id}
              myRole={membershipRole}
              channelId={openChannelId}
              highlightMessageId={openMessageId}
              onChannelChange={(channelId) => setActiveTab('Chat', { channel: channelId })}
              members={team || []}
              currentUserId={user?.id}
              threadId={openThreadId}
            />
          )}
          {activeTab === 'Chat' && isLive && liveProject && !membershipRole && (
            <div className="task-empty"><Circle size={20} /><p>Project channels are visible to members only.</p></div>
          )}
          {activeTab === 'Chat' && !isLive && (
            <div className="task-empty"><Circle size={20} /><p>Channels are available in real projects. Sign in and open one of your projects to chat with your team.</p></div>
          )}
          {activeTab === 'Milestones' && isLive && (
            <MilestonesPanel projectId={id} myRole={membershipRole} refreshKey={workVersion} onChange={() => setWorkVersion((n) => n + 1)} />
          )}
          {activeTab === 'Milestones' && !isLive && (
            <div className="milestone-list">
              <Milestone title="Project foundation" detail="Repository, auth and project setup" progress={100} tone="green" />
              <Milestone title="Collaboration core" detail="Tasks, messages and team workflow" progress={65} tone="violet" />
              <Milestone title="Public launch" detail="Discovery, profiles and community feed" progress={25} tone="orange" />
            </div>
          )}
          {activeTab === 'Activity' && isLive && membershipRole && (
            <ActivityPanel projectId={id} refreshKey={workVersion} />
          )}
          {activeTab === 'Activity' && isLive && liveProject && !membershipRole && (
            <div className="task-empty"><Circle size={20} /><p>Project activity is visible to members only.</p></div>
          )}
          {activeTab === 'Activity' && !isLive && (
            <div>
              {commitGroups.map((g) => (
                <div className="event" key={g.title}>
                  <span className={`event-icon ${activityIcon[g.color]}`}><GitCommitHorizontal size={15} /></span>
                  <div><b>{g.title}</b><p>{g.text}</p><small>{g.author} · {g.range.toLowerCase()}</small></div>
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="stack-right">
          {/* [Sprint 3 · M2] Visitors of a Public project can ask to join (US-47). */}
          {liveProject && !membershipRole && liveProject.visibility === 'Public' && (
            <JoinRequestCard projectId={id} />
          )}
          {liveProject && membershipRole && (
            <TeamPanel key={teamVersion} projectId={id} projectName={liveProject.name} myRole={membershipRole} currentUserId={user.id} onMembers={setTeam} onLeft={() => navigate('/dashboard')} />
          )}
          {/* [Sprint 3 · M1] Owners and Admins invite people and see accepted / declined invitations (US-10, US-11). */}
          {liveProject && canManageMembers(membershipRole) && (
            <InvitationsPanel projectId={id} myRole={membershipRole} />
          )}
          {/* [Sprint 3 · M2] Owners and Admins review join requests (US-12). */}
          {liveProject && canManageMembers(membershipRole) && (
            <JoinRequestsPanel projectId={id} myRole={membershipRole} onApproved={() => setTeamVersion((n) => n + 1)} />
          )}
          <section className="panel">
            <div className="panel-head"><div><div className="eyebrow">DEVELOPMENT</div><h2 className="with-icon" style={{ marginTop: 6 }}><Code2 size={17} /> Code &amp; files</h2></div><button className="iconbtn" onClick={() => setNotice('Repository actions are demo-only until GitHub OAuth is configured.')} aria-label="Repository actions"><MoreHorizontal size={17} /></button></div>
            <div className="repo-box"><Github size={19} /><div><b>{repoLabel}</b><small>Repository reference</small></div><span className="pill"><GitBranch size={11} /> main</span></div>
            <div className="repo-stats"><span><GitFork size={13} /> 12 forks</span><span><GitPullRequest size={13} /> 4 open PRs</span><span><GitCommitHorizontal size={13} /> 128 commits</span></div>
            <div>
              {files.map((f) => (
                <button className="file-row" key={f.name} onClick={() => setNotice(`${f.name}: file preview is a placeholder in this visual prototype.`)}>
                  <span className={`file-icon ${f.tone}`}>{f.type === 'folder' ? <Folder size={16} /> : f.type === 'md' ? <FileText size={16} /> : f.type === 'json' ? <FileCode2 size={16} /> : <File size={16} />}</span>
                  <span className="file-copy"><b>{f.name}</b><small>{f.meta}</small></span>
                  <ArrowUpRight size={14} className="file-open" />
                </button>
              ))}
            </div>
            <Btn secondary className="repo-link-btn" onClick={() => setNotice('Connect GitHub OAuth and configure a repository to open live code here.')}>Connect / open repository <ExternalLink size={14} /></Btn>
          </section>

          <section className="panel copilot-panel">
            <div className="panel-head"><div><div className="eyebrow">AI PROJECT MEMORY</div><h2 className="with-icon" style={{ marginTop: 6 }}><Sparkles size={17} /> Commit recap</h2></div><span className="ai-chip">DEMO</span></div>
            <div className="ai-summary"><span><Sparkles size={14} /></span><p>Here's the story behind the <strong>last 18 commits</strong> — grouped into the changes that matter.</p></div>
            <div className="commit-list">
              {(showAllCommits ? commitGroups : commitGroups.slice(0, 3)).map((g) => (
                <article className="commit" key={g.title}>
                  <i className={`commit-dot ${g.dot}`} />
                  <div>
                    <span className="range">{g.range}</span>
                    <div className="title-row"><b>{g.title}</b><span>{g.count} commits</span></div>
                    <p>{g.text}</p>
                    <div className="tags">{g.tags.map((t) => <span key={t}>{t}</span>)}</div>
                  </div>
                </article>
              ))}
            </div>
            <Btn secondary className="recap-toggle" onClick={() => setShowAllCommits(!showAllCommits)}>{showAllCommits ? 'Show less' : 'View all 18 commits'} <ChevronDown size={14} className={showAllCommits ? 'rotate' : ''} /></Btn>
            <p className="disclaimer">Sample summary for layout preview. Live summaries require GitHub events and a configured AI provider.</p>
          </section>
        </aside>
      </div>

      {notice && <div className="toast" role="status"><CheckCircle2 size={16} />{notice}<button className="task-more" onClick={() => setNotice('')} aria-label="Dismiss"><X size={14} /></button></div>}

    </>
  );
}

function Milestone({ title, detail, progress, tone: toneName }) {
  return (
    <div className="milestone">
      <div className={`milestone-status ${toneName}`}>{progress === 100 ? <Check size={15} /> : <Circle size={13} />}</div>
      <div className="milestone-copy">
        <div><b>{title}</b><span>{progress}%</span></div>
        <p>{detail}</p>
        <div className={`progress ${toneName}`}><i style={{ width: `${progress}%` }} /></div>
      </div>
    </div>
  );
}

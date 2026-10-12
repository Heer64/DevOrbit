import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowUpRight, Bell, Check, CheckCircle2, ChevronDown, Circle, Clock3, Code2, ExternalLink, File, FileCode2, FileText, Folder, GitBranch, GitCommitHorizontal, GitFork, GitPullRequest, Github, MoreHorizontal, Plus, Search, Settings, Sparkles, Users, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { assetUrl, projectApi, toWorkspaceProject } from '../api';
import { AVATAR_TONES, Avatar, Btn, initialsOf, tone } from '../components/ui';
import TeamPanel from '../components/TeamPanel';

const projects = {
  'orbit-dashboard': { name: 'Orbit dashboard', description: 'A shared home for project progress and team momentum.', domain: 'Developer tools', repo: 'devorbit/orbit-dashboard', color: 'violet', members: ['AM', 'RK', 'JS', 'NK', '+1'], health: 'On track', goal: 'Make team work feel clear, connected, and calm.', progress: 72 },
  'pulse-api': { name: 'Pulse API', description: 'Reliable, thoughtful APIs for the next generation.', domain: 'Backend', repo: 'devorbit/pulse-api', color: 'orange', members: ['AM', 'NK', 'MP'], health: 'On track', goal: 'Build a simple, dependable API foundation.', progress: 46 },
  greenlight: { name: 'Greenlight', description: 'A greener way to track everyday impact.', domain: 'Community', repo: 'devorbit/greenlight', color: 'teal', members: ['RK', 'AM', 'JS', 'DM'], health: 'Ahead of schedule', goal: 'Make everyday environmental impact more visible.', progress: 88 },
  'campus-connect': { name: 'CampusConnect', description: 'Helping students find teammates and build beyond the classroom.', domain: 'Education', repo: 'community/campus-connect', color: 'orange', members: ['RK', 'JS', 'DM', '+5'], health: 'Needs attention', goal: 'Help students find the right collaborators for their next idea.', progress: 58 },
  papertrail: { name: 'Papertrail', description: 'Turn research notes into searchable team knowledge.', domain: 'Research', repo: 'miralabs/papertrail', color: 'pink', members: ['MP', 'AM', '+4'], health: 'On track', goal: 'Keep research context easy to find and maintain.', progress: 39 },
  launchpad: { name: 'Launchpad UI', description: 'Accessible components for fast-moving teams.', domain: 'Design systems', repo: 'devmalhotra/launchpad-ui', color: 'yellow', members: ['DM', 'RK', '+5'], health: 'On track', goal: 'Make good interface patterns accessible to every team.', progress: 63 },
};
const initialTasks = [
  { id: 1, title: 'Finalize dashboard information hierarchy', label: 'Design', status: 'Done', assignee: 'RK', due: 'Oct 09' },
  { id: 2, title: 'Build project overview cards', label: 'Frontend', status: 'In progress', assignee: 'AM', due: 'Oct 13' },
  { id: 3, title: 'Connect activity feed endpoint', label: 'Backend', status: 'In progress', assignee: 'NK', due: 'Oct 14' },
  { id: 4, title: 'Add loading and empty states', label: 'Polish', status: 'To do', assignee: 'JS', due: 'Oct 16' },
  { id: 5, title: 'Run responsive layout checks', label: 'Quality', status: 'To do', assignee: 'AM', due: 'Oct 18' },
];
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

export default function ProjectPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [liveProject, setLiveProject] = useState(null);
  const [projectLoadError, setProjectLoadError] = useState('');
  const [membershipRole, setMembershipRole] = useState(null);
  const [team, setTeam] = useState(null);
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
  }, [id, user]);

  const project = liveProject || projects[id] || (localProject
    ? { ...localProject, domain: localProject.domain || 'Developer tools', repo: localProject.repo || 'your-team/new-repo', members: ['AM'], health: 'Just getting started', goal: 'Bring your project idea to life.' }
    : { name: 'Project workspace', description: 'Your project details and team workspace.', domain: 'New project', repo: 'your-team/new-repo', color: 'violet', members: ['AM'], health: 'Just getting started', goal: 'Bring your project idea to life.', progress: 0 });

  const [tasks, setTasks] = useState(initialTasks);
  const [taskFilter, setTaskFilter] = useState('All');
  const [taskSearch, setTaskSearch] = useState('');
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [newTask, setNewTask] = useState('');
  const [activeTab, setActiveTab] = useState('Tasks');
  const [showAllCommits, setShowAllCommits] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 3200);
    return () => clearTimeout(timer);
  }, [notice]);

  const filteredTasks = useMemo(() => tasks.filter((t) => (taskFilter === 'All' || t.status === taskFilter) && t.title.toLowerCase().includes(taskSearch.toLowerCase())), [tasks, taskFilter, taskSearch]);
  const cycleStatus = (task) => {
    const states = ['To do', 'In progress', 'Done'];
    const status = states[(states.indexOf(task.status) + 1) % states.length];
    setTasks((old) => old.map((t) => (t.id === task.id ? { ...t, status } : t)));
    setNotice(`Task moved to ${status}.`);
  };
  const addTask = (e) => {
    e.preventDefault();
    if (!newTask.trim()) return;
    setTasks((old) => [{ id: Date.now(), title: newTask.trim(), label: 'New', status: 'To do', assignee: 'AM', due: 'Not set' }, ...old]);
    setNewTask(''); setShowTaskModal(false); setNotice('Task created in this demo.');
  };

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
          <Btn icon={Plus} onClick={() => { setShowTaskModal(true); setActiveTab('Tasks'); }}>Add task</Btn>
          <button className="iconbtn" onClick={() => setNotice('Project notification preferences are a UI prototype.')} title="Project notifications" aria-label="Project notifications"><Bell size={16} /></button>
          <button className="iconbtn" onClick={() => setNotice('Project settings will be connected to the API later.')} title="Project settings" aria-label="Project settings"><Settings size={16} /></button>
        </div>
      </div>

      <div className="project-summary">
        <section className="panel">
          <div className="panel-head"><div><h2>Project progress</h2><p>Keep the work visible and the next step clear.</p></div><span className="pill green">{project.progress >= 100 ? 'Completed' : 'In progress'}</span></div>
          <div className="big-progress">{project.progress}% <small>overall completion</small></div>
          <div className="progress"><i className={color} style={{ width: `${project.progress}%` }} /></div>
          <div className="stats"><div><small>Members</small><b>{memberCount}</b></div><div><small>Open tasks</small><b>{tasks.filter((t) => t.status !== 'Done').length}</b></div><div><small>Health</small><b style={{ fontSize: 13 }}>{project.health}</b></div></div>
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
            {['Tasks', 'Milestones', 'Activity'].map((t) => <button key={t} className={activeTab === t ? 'active' : ''} onClick={() => setActiveTab(t)}>{t}</button>)}
          </div>
          {activeTab === 'Tasks' && (
            <>
              <div className="task-toolbar">
                <label className="task-search"><Search size={14} /><input value={taskSearch} onChange={(e) => setTaskSearch(e.target.value)} placeholder="Find a task..." /></label>
                <select className="task-filter" value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)} aria-label="Filter tasks"><option>All</option><option>To do</option><option>In progress</option><option>Done</option></select>
                <button className="iconbtn" title="Add task" aria-label="Add task" onClick={() => setShowTaskModal(true)}><Plus size={16} /></button>
              </div>
              <div>
                {filteredTasks.map((t) => (
                  <article className="task-row" key={t.id}>
                    <button className={`task-dot ${t.status === 'Done' ? 'done' : t.status === 'In progress' ? 'working' : ''}`} onClick={() => cycleStatus(t)} title="Click to cycle task status" aria-label={`Task status: ${t.status}`}>{t.status === 'Done' ? <Check size={12} /> : t.status === 'In progress' ? <span /> : null}</button>
                    <div className="task-main">
                      <b className={t.status === 'Done' ? 'crossed' : ''}>{t.title}</b>
                      <div className="task-meta"><span className={`task-label ${t.label.toLowerCase()}`}>{t.label}</span><span><Clock3 size={11} />{t.due}</span></div>
                    </div>
                    <span className={`pill ${t.status === 'Done' ? 'green' : t.status === 'In progress' ? 'purple' : 'orange'}`}>{t.status}</span>
                    <Avatar initials={t.assignee} small />
                    <button className="task-more" onClick={() => cycleStatus(t)} title="Move to next status" aria-label="Move to next status"><MoreHorizontal size={17} /></button>
                  </article>
                ))}
                {filteredTasks.length === 0 && <div className="task-empty"><Circle size={20} /><p>No tasks match your filters.</p></div>}
              </div>
              <button className="add-task-bottom" onClick={() => setShowTaskModal(true)}><Plus size={14} /> Add another task</button>
            </>
          )}
          {activeTab === 'Milestones' && (
            <div className="milestone-list">
              <Milestone title="Project foundation" detail="Repository, auth and project setup" progress={100} tone="green" />
              <Milestone title="Collaboration core" detail="Tasks, messages and team workflow" progress={65} tone="violet" />
              <Milestone title="Public launch" detail="Discovery, profiles and community feed" progress={25} tone="orange" />
            </div>
          )}
          {activeTab === 'Activity' && (
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
          {liveProject && membershipRole && (
            <TeamPanel projectId={id} myRole={membershipRole} currentUserId={user.id} onMembers={setTeam} onLeft={() => navigate('/dashboard')} />
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

      {showTaskModal && (
        <div className="modal-back" onClick={() => setShowTaskModal(false)}>
          <form className="modal" onSubmit={addTask} onClick={(e) => e.stopPropagation()}>
            <div className="modal-top"><span className="modal-icon"><CheckCircle2 size={19} /></span><button type="button" className="iconbtn" aria-label="Close" onClick={() => setShowTaskModal(false)}><X size={17} /></button></div>
            <h2>Add a task</h2>
            <p>Keep the next step small and clear.</p>
            <label>Task title<input className="field-input" autoFocus value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="What needs to get done?" required maxLength={120} /></label>
            <button className="btn full" type="submit">Create task <Plus size={16} /></button>
            <p className="tiny-note">Demo mode keeps new tasks in this page state.</p>
          </form>
        </div>
      )}
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

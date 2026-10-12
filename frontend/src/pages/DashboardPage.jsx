import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Clock3, Code2, Compass, FolderKanban, GitPullRequest, MoreHorizontal, Plus, Sparkles, Users, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { projectApi, toProjectCard } from '../api';
import { AVATAR_TONES, Avatar, Btn, Heading, tone } from '../components/ui';

const baseProjects = [
  { id: 'orbit-dashboard', name: 'Orbit dashboard', description: 'A shared home for project progress and team momentum.', tag: 'Product', color: 'violet', progress: 72, members: 5, due: 'Oct 18', initials: ['AM', 'RK', 'JS', '+2'] },
  { id: 'pulse-api', name: 'Pulse API', description: 'Reliable, thoughtful APIs for the next generation.', tag: 'Backend', color: 'orange', progress: 46, members: 3, due: 'Oct 22', initials: ['AM', 'NK', '+1'] },
  { id: 'greenlight', name: 'Greenlight', description: 'A greener way to track everyday impact.', tag: 'Community', color: 'teal', progress: 88, members: 4, due: 'Oct 15', initials: ['RK', 'AM', 'JS', '+1'] },
];
const activities = [
  { icon: GitPullRequest, color: 'purple', title: 'Pull request merged', detail: 'Aarav merged “Update project cards”', time: '12 min ago', project: 'Orbit dashboard' },
  { icon: CheckCircle2, color: 'green', title: 'Task completed', detail: 'Riya finished “Add empty state”', time: '48 min ago', project: 'Orbit dashboard' },
  { icon: Users, color: 'blue', title: 'New collaborator', detail: 'Karan joined the Pulse API project', time: '2 hours ago', project: 'Pulse API' },
  { icon: Code2, color: 'orange', title: '3 commits pushed', detail: 'API validation and error handling', time: 'Yesterday', project: 'Pulse API' },
];

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}
function todayLabel() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { openCreate } = useOutletContext();
  const navigate = useNavigate();
  const [view, setView] = useState('all');
  const [projects, setProjects] = useState(() => (user?.isDemo ? baseProjects : []));
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState('');

  useEffect(() => {
    let active = true;
    const loadProjects = async () => {
      if (!user) { setProjects([]); setProjectsLoading(false); return; }
      if (user.isDemo) {
        let localProjects = [];
        try { localProjects = JSON.parse(localStorage.getItem('devorbit_local_projects') || '[]'); } catch { localProjects = []; }
        if (active) { setProjects([...localProjects, ...baseProjects]); setProjectsError(''); setProjectsLoading(false); }
        return;
      }
      setProjectsLoading(true);
      try {
        const result = await projectApi.list();
        if (active) { setProjects((result.projects || []).map((project) => toProjectCard(project, user))); setProjectsError(''); }
      } catch (error) {
        if (active) { setProjects([]); setProjectsError(error.message || 'Could not load your projects.'); }
      } finally {
        if (active) setProjectsLoading(false);
      }
    };
    loadProjects();
    const refresh = () => loadProjects();
    window.addEventListener('devorbit:projects-updated', refresh);
    return () => { active = false; window.removeEventListener('devorbit:projects-updated', refresh); };
  }, [user]);

  const visibleProjects = view === 'all' ? projects : projects.filter((p) => !['Completed', 'Archived'].includes(p.status) && p.progress < 100);
  const first = user?.name?.split(' ')[0] || 'Aarav';
  const firstProjectId = projects[0]?.id || 'orbit-dashboard';
  const activeCount = projects.filter((p) => !['Completed', 'Archived'].includes(p.status)).length;

  return (
    <>
      <Heading eyebrow={`${todayLabel()} · YOUR WORKSPACE`} title={<>{greeting()}, {first} <em>✳</em></>} subtitle="A little progress each day adds up to big results." action={openCreate} />

      <section className="welcome">
        <div className="welcome-copy">
          <div className="eyebrow"><Sparkles size={13} /> YOUR IDEAS, IN MOTION</div>
          <h2>Keep your team in the loop.</h2>
          <p>All your people, projects and progress — finally on the same page.</p>
          <button onClick={() => navigate('/discover')}>Find your next collaborator <ArrowRight size={15} /></button>
        </div>
        <div className="welcome-stat">
          <small>YOUR PROJECTS</small>
          <b>{projects.length} <span>projects</span></b>
          <div className="bars">{[28, 44, 33, 57, 42, 72, 55, 86, 60, 70, 45, 95].map((height, i) => <i key={i} style={{ height: `${height}%` }} />)}</div>
          <small>{user?.isDemo ? 'Sample workspace data' : 'Updates from your workspace'}</small>
        </div>
      </section>

      <section className="stat-grid">
        <StatCard icon={FolderKanban} title="Active projects" value={user?.isDemo ? '8' : String(activeCount)} trend={user?.isDemo ? '2 this month' : 'in your workspace'} tint="purple" />
        <StatCard icon={CheckCircle2} title="Tasks completed" value={user?.isDemo ? '24' : '—'} trend={user?.isDemo ? '↑ 18% this week' : 'Task tracking not connected yet'} tint="green" />
        <StatCard icon={Users} title="Collaborators" value={user?.isDemo ? '12' : String(new Set(projects.flatMap((p) => p.initials || [])).size)} trend={user?.isDemo ? '3 new connections' : 'across your projects'} tint="blue" />
        <StatCard icon={Zap} title="Your momentum" value={user?.isDemo ? '86%' : '—'} trend={user?.isDemo ? "You're on a roll" : 'Calculated when task data is connected'} tint="orange" />
      </section>

      <div className="section-head">
        <div><h2>Current projects <span>{projects.length}</span></h2><p>Pick up where you left off.</p></div>
        <div className="filters">
          <button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>All projects</button>
          <button className={view === 'active' ? 'active' : ''} onClick={() => setView('active')}>In progress</button>
        </div>
        <button className="link" onClick={() => navigate('/discover')}>View all <ArrowRight size={14} /></button>
      </div>

      {projectsLoading ? <section className="panel placeholder"><h2>Loading projects…</h2></section>
        : projectsError ? <div className="form-error" role="alert">{projectsError}</div>
        : visibleProjects.length ? (
          <div className="project-grid">
            {visibleProjects.map((p) => <ProjectCard key={p.id} project={p} onOpen={() => navigate(`/project/${p.id}`)} />)}
            <button className="new-card" onClick={openCreate}><span><Plus size={21} /></span><b>Have a new idea?</b><small>Start a new project and bring your people in.</small><strong>Create project <ArrowRight size={14} /></strong></button>
          </div>
        ) : (
          <section className="panel placeholder"><span><FolderKanban size={25} /></span><h2>Your first project starts here</h2><p>No projects yet. Create your first project to get started, or discover what the community is building.</p><div className="modal-actions"><Btn onClick={openCreate} icon={Plus}>Create a project</Btn><Btn secondary onClick={() => navigate('/discover')} icon={Compass}>Discover projects</Btn></div></section>
        )}

      <div className="lower-grid">
        <section className="panel">
          <div className="panel-head"><div><h2>Project pulse</h2><p>The latest from your workspace.</p></div><MoreHorizontal size={18} /></div>
          {activities.map((a, i) => (
            <div className="event" key={a.title + i}>
              <span className={`event-icon ${a.color}`}><a.icon size={16} /></span>
              <div><b>{a.title}</b><p>{a.detail}</p><small>{a.project} · {a.time}</small></div>
            </div>
          ))}
          {!user?.isDemo && <p className="preview-note">Preview activity — live activity will appear when task and GitHub integrations are connected.</p>}
          <button className="link" onClick={() => navigate(`/project/${firstProjectId}`)}>Open project activity <ArrowRight size={14} /></button>
        </section>
        <section className="panel focus-panel">
          <div className="panel-head"><div><h2>Your next step</h2><p>One clear push at a time.</p></div><Zap size={18} /></div>
          <h3>Ship the small things.</h3>
          <p>{user?.isDemo ? "You're close to the finish line on Orbit dashboard. One good push can get you there." : 'Choose one clear next step and keep your team moving forward.'}</p>
          <div className="focus-meter"><span>Weekly project goal</span><b>4 of 5</b></div>
          <div className="progress"><i style={{ width: '80%' }} /></div>
          <button className="link" onClick={() => navigate(`/project/${firstProjectId}`)}>Open my task board <ArrowRight size={14} /></button>
        </section>
      </div>

      <div className="bottom-cta"><Users size={19} /><div><b>Good work grows together.</b><small>Meet people building what you love.</small></div><Btn secondary onClick={() => navigate('/discover')}>Find your people <ArrowRight size={14} /></Btn></div>
    </>
  );
}

function StatCard({ icon: Icon, title, value, trend, tint }) {
  return (
    <div className="stat-card">
      <span className={`event-icon ${tint}`}><Icon size={18} /></span>
      <p>{title}</p>
      <div className="stat-value"><b>{value}</b><span>{trend}</span></div>
    </div>
  );
}

function ProjectCard({ project, onOpen }) {
  const color = tone(project.color);
  const tags = project.tags?.length ? project.tags : project.tag ? [project.tag] : [];
  const progress = project.progress || 0;
  const people = project.initials || ['ME'];
  return (
    <button className="project-card" onClick={onOpen} aria-label={`Open ${project.name}`}>
      <div className="project-top">
        <span className={`project-avatar ${color}`}>{(project.name || 'N')[0].toUpperCase()}</span>
        <span className={`pill ${progress >= 80 ? 'green' : 'purple'}`}>{progress >= 100 ? 'Complete' : 'In progress'}</span>
      </div>
      <h3>{project.name}</h3>
      <p>{project.description}</p>
      <div className="tags">{tags.slice(0, 3).map((t) => <span key={t}>{t}</span>)}</div>
      <div className="metric"><span>Progress</span><b>{progress}%</b></div>
      <div className="progress"><i className={color} style={{ width: `${progress}%` }} /></div>
      <div className="project-foot">
        <div className="stack">{people.slice(0, 4).map((person, i) => <Avatar key={person + i} initials={person} tone={AVATAR_TONES[i % 4]} />)}<small>{project.members} member{project.members === 1 ? '' : 's'}</small></div>
        <span className="due"><Clock3 size={11} /> Due {project.due || 'Not set'}</span>
      </div>
    </button>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Clock3, Code2, Compass, FolderKanban, GitPullRequest, ListTodo, Plus, Search, Users, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { projectApi, toProjectCard } from '../api';
import { AVATAR_TONES, Avatar, Btn, tone } from '../components/ui';
import ProjectPulse from '../components/ProjectPulse';
import { MyTasks, UpcomingDeadlines, useTaskStats } from '../components/DashboardTasks';
import MyInvitations from '../components/MyInvitations'; // [Sprint 3 · M1] US-10, US-11

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

// Sample tasks for the demo workspace only (real users load theirs from /api/tasks).
const demoDay = (days) => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + days)).toISOString(); };
const demoUpcoming = [
  { _id: 'demo-up-1', title: 'Add loading and empty states', status: 'To do', dueDate: demoDay(1), project: { _id: 'orbit-dashboard', name: 'Orbit dashboard', color: 'violet' } },
  { _id: 'demo-up-2', title: 'Connect activity feed endpoint', status: 'In progress', dueDate: demoDay(3), project: { _id: 'pulse-api', name: 'Pulse API', color: 'orange' } },
  { _id: 'demo-up-3', title: 'Run responsive layout checks', status: 'To do', dueDate: demoDay(6), project: { _id: 'greenlight', name: 'Greenlight', color: 'teal' } },
];
const demoMine = [
  { _id: 'demo-me-1', title: 'Build project overview cards', status: 'In progress', dueDate: demoDay(2), project: { _id: 'orbit-dashboard', name: 'Orbit dashboard', color: 'violet' } },
  { _id: 'demo-me-2', title: 'Write API validation tests', status: 'To do', dueDate: null, project: { _id: 'pulse-api', name: 'Pulse API', color: 'orange' } },
];

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}
function todayLabel() {
  return new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { openCreate, openPalette } = useOutletContext() || {};
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
  const taskStats = useTaskStats(user);
  const statValue = (key) => (taskStats ? String(taskStats[key]) : '—');

  const avgProgress = projects.length ? Math.round(projects.reduce((sum, p) => sum + (p.progress || 0), 0) / projects.length) : 0;
  const ringPct = user?.isDemo ? 80 : avgProgress;

  return (
    <>
      <div className="page-head dash-head">
        <div className="page-title">
          <span className="eyebrow mono">{todayLabel()}</span>
          <h1>{greeting()}, {first}</h1>
          <p>A little progress each day adds up to big results.</p>
        </div>
        <div className="page-actions">
          {openPalette && <Btn secondary icon={Search} onClick={openPalette}>Jump to…</Btn>}
          <Btn icon={Plus} onClick={openCreate}>Create project</Btn>
        </div>
      </div>

      {/* [Sprint 3 · M1] Pending project invitations with Accept / Decline (US-11). Hidden when there are none. */}
      <MyInvitations user={user} onOpenProject={(projectId) => navigate(`/project/${projectId}`)} />

      <div className="bento dash-bento">
        {/* Catch me up: the latest across all of my projects (Project pulse, GET /api/activity/me). */}
        <ProjectPulse user={user} demoActivities={activities} fallbackProjectId={firstProjectId} variant="catchup" />
        <section className="stat-grid">
          <StatCard icon={FolderKanban} title="Active projects" value={user?.isDemo ? '8' : String(activeCount)} trend={user?.isDemo ? '2 this month' : 'in your workspace'} tint="purple" onClick={() => document.getElementById('dash-projects')?.scrollIntoView({ behavior: 'smooth' })} />
          <StatCard icon={CheckCircle2} title="Tasks completed" value={user?.isDemo ? '24' : statValue('completedLast7Days')} trend={user?.isDemo ? '↑ 18% this week' : 'in the last 7 days'} tint="green" />
          <StatCard icon={Users} title="Collaborators" value={user?.isDemo ? '12' : String(new Set(projects.flatMap((p) => p.initials || [])).size)} trend={user?.isDemo ? '3 new connections' : 'across your projects'} tint="blue" onClick={() => navigate('/discover')} />
          {user?.isDemo
            ? <StatCard icon={Zap} title="Your momentum" value="86%" trend="You're on a roll" tint="orange" />
            : <StatCard icon={ListTodo} title="Assigned to me" value={statValue('openAssignedToMe')} trend="open tasks" tint="orange" />}
        </section>
        <section className="panel ring-card" aria-label="Project progress">
          <svg width="84" height="84" viewBox="0 0 64 64" role="img" aria-label={`${ringPct} percent`}>
            <circle cx="32" cy="32" r="26" fill="none" stroke="var(--ring-track)" strokeWidth="7" />
            <circle cx="32" cy="32" r="26" fill="none" stroke="#ff8a3d" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(ringPct / 100) * 163.4} 164`} transform="rotate(-90 32 32)" className="ring-arc" />
            <text x="32" y="37" textAnchor="middle" fontFamily="Manrope, ui-sans-serif, system-ui, sans-serif" fontWeight="800" fontSize="14" fill="currentColor">{ringPct}%</text>
          </svg>
          <div className="ring-copy">
            <span>{user?.isDemo ? 'Weekly project goal' : 'Average project progress'}</span>
            <b>{user?.isDemo ? '4 of 5 done' : `${activeCount} active project${activeCount === 1 ? '' : 's'}`}</b>
            <small>{user?.isDemo ? "You're close to the finish line on Orbit dashboard." : 'Choose one clear next step and keep your team moving.'}</small>
            <button className="link" onClick={() => navigate(`/project/${firstProjectId}`)}>Open my task board <ArrowRight size={14} /></button>
          </div>
        </section>
      </div>

      <div className="bento wide dash-task-grid">
        <UpcomingDeadlines user={user} demoTasks={demoUpcoming} />
        <MyTasks user={user} demoTasks={demoMine} />
      </div>

      <section className="dash-projects" id="dash-projects">
        <div className="section-head">
          <div><h2>Your projects <span>{projects.length}</span></h2><p>Pick up where you left off.</p></div>
          <div className="filters seg">
            <button className={view === 'all' ? 'active on' : ''} onClick={() => setView('all')}>All projects</button>
            <button className={view === 'active' ? 'active on' : ''} onClick={() => setView('active')}>In progress</button>
          </div>
          <button className="link" onClick={() => navigate('/discover')}>Discover public projects <ArrowRight size={14} /></button>
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
      </section>

      <div className="bottom-cta"><Users size={19} /><div><b>Good work grows together.</b><small>Meet people building what you love.</small></div><Btn secondary onClick={() => navigate('/discover')}>Find your people <ArrowRight size={14} /></Btn></div>
    </>
  );
}

function StatCard({ icon: Icon, title, value, trend, tint, onClick }) {
  return (
    <div className={`stat-card ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      <span className={`event-icon ${tint}`}><Icon size={16} /></span>
      <p>{title}</p>
      <div className="stat-value"><b data-count={/^\d+$/.test(value) ? value : undefined}>{value}</b><span>{trend}</span></div>
    </div>
  );
}

function ProjectCard({ project, onOpen }) {
  const color = tone(project.color);
  const tags = project.tags?.length ? project.tags : project.tag ? [project.tag] : [];
  const progress = project.progress || 0;
  const people = project.initials || ['ME'];
  const state = progress >= 100 ? ['Complete', 'green'] : progress >= 80 ? ['On track', 'green'] : progress > 0 ? ['In progress', 'purple'] : ['Just started', 'orange'];
  return (
    <button className="project-card" onClick={onOpen} aria-label={`Open ${project.name}`}>
      <div className="project-top">
        <i className={`sq ${color}`} aria-hidden="true" />
        <h3>{project.name}</h3>
        <span className={`pill ${state[1]}`}>{state[0]}</span>
      </div>
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

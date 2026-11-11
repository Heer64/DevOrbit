import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, Compass, FolderKanban, Globe2, LayoutDashboard, Lock, LogOut, Menu, MessageCircle, MessagesSquare, Moon, Plus, Search, Sun, UserPlus, UserRound, X } from 'lucide-react';
import Logo from './Logo';
import { Avatar, initialsOf, tone } from './ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { projectApi, toProjectCard } from '../api';
import NotificationBell from './NotificationBell'; // [Sprint 3 · M7 Part 2] US-30
import DmUnreadBadge from './DmUnreadBadge'; // [Sprint 6 · M2] US-19
import { MAX_STARTING_MEMBERS, PROJECT_DOMAINS as DOMAINS, STARTING_MEMBER_ROLES, startingMembersPayload } from '../domains'; // [Sprint 1 · gaps]
import { ROLE_HELP } from '../roles';

const VISIBILITIES = [
  { value: 'Private', label: 'Private', hint: 'Only members can open it', icon: Lock },
  { value: 'Public', label: 'Public', hint: 'Anyone signed in can find it', icon: Globe2 },
];

export default function AppShell() {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const [workspaceProjects, setWorkspaceProjects] = useState([]);
  const [globalSearch, setGlobalSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectDomain, setProjectDomain] = useState(DOMAINS[0]);
  const [projectVisibility, setProjectVisibility] = useState('Private');
  const [startingMembers, setStartingMembers] = useState([]); // [Sprint 1 · gaps] [{ key, identifier, role }]
  const [creating, setCreating] = useState(false);
  const [projectCreated, setProjectCreated] = useState(false);
  const [createError, setCreateError] = useState('');
  const [mobile, setMobile] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => { setMobile(false); }, [location.pathname]);

  useEffect(() => {
    let active = true;
    const loadProjects = async () => {
      if (!user) { setWorkspaceProjects([]); return; }
      if (user.isDemo) {
        let saved = [];
        try { saved = JSON.parse(localStorage.getItem('devorbit_local_projects') || '[]'); } catch { saved = []; }
        setWorkspaceProjects([...saved, { id: 'orbit-dashboard', name: 'Orbit dashboard', color: 'violet' }, { id: 'pulse-api', name: 'Pulse API', color: 'orange' }, { id: 'greenlight', name: 'Greenlight', color: 'teal' }]);
        return;
      }
      try {
        const result = await projectApi.list();
        if (active) setWorkspaceProjects((result.projects || []).map((project) => toProjectCard(project, user)));
      } catch {
        if (active) setWorkspaceProjects([]);
      }
    };
    loadProjects();
    const reload = () => loadProjects();
    window.addEventListener('devorbit:projects-updated', reload);
    return () => { active = false; window.removeEventListener('devorbit:projects-updated', reload); };
  }, [user, location.pathname]);

  const createProject = async (e) => {
    e.preventDefault();
    const name = projectName.trim();
    if (!name || creating) return;
    setCreateError('');
    setCreating(true);
    const details = { name, description: projectDescription.trim(), domain: projectDomain, visibility: projectVisibility };
    const members = startingMembersPayload(startingMembers);
    const draft = { id: `local-${Date.now()}`, ...details, members: 1, progress: 0, color: 'violet', tag: details.domain };
    try {
      if (user && !user.isDemo) {
        const result = await projectApi.create(members.length ? { ...details, members } : details);
        const created = result.project || result;
        const mapped = toProjectCard(created, user);
        setWorkspaceProjects((current) => [mapped, ...current.filter((item) => item.id !== mapped.id)]);
      } else {
        const existing = JSON.parse(localStorage.getItem('devorbit_local_projects') || '[]');
        localStorage.setItem('devorbit_local_projects', JSON.stringify([draft, ...existing]));
        setWorkspaceProjects((current) => [draft, ...current]);
      }
      window.dispatchEvent(new Event('devorbit:projects-updated'));
      setProjectCreated(true);
      setProjectName('');
      setProjectDescription('');
      setProjectDomain(DOMAINS[0]);
      setProjectVisibility('Private');
      setStartingMembers([]);
      setTimeout(() => { setShowCreate(false); setProjectCreated(false); navigate('/dashboard'); }, 800);
    } catch (error) {
      setCreateError(error?.message || 'Could not reach the backend. Check your server and database, or use demo mode.');
    } finally {
      setCreating(false);
    }
  };

  const openCreate = () => { setCreateError(''); setShowCreate(true); };

  // [Sprint 1 · gaps] Optional starting members on the create form.
  const addStartingMember = () => setStartingMembers((rows) => (rows.length >= MAX_STARTING_MEMBERS ? rows : [...rows, { key: `${Date.now()}-${rows.length}`, identifier: '', role: 'Contributor' }]));
  const updateStartingMember = (key, field, value) => setStartingMembers((rows) => rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  const removeStartingMember = (key) => setStartingMembers((rows) => rows.filter((row) => row.key !== key));

  const navItems = [
    { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
    { to: '/discover', label: 'Find projects & people', icon: Compass },
    { to: '/feed', label: 'Community feed', icon: MessagesSquare }, // [Sprint 5 · M6] US-50/US-51
    { to: '/messages', label: 'Messages', icon: MessageCircle }, // [Sprint 6 · M2] US-19 direct messages
    { to: '/profile', label: 'My profile', icon: UserRound },
  ];
  const displayName = user?.name || 'Demo user';
  const avatarText = user?.avatar || initialsOf(user?.name);
  const workspaceName = user?.name ? `${user.name.split(' ')[0]}'s workspace` : 'My workspace';

  return (
    <div className="shell">
      <aside className={`sidebar ${mobile ? 'show' : ''}`}>
        <div className="sidebar-head"><Logo /><button className="mobile-close" aria-label="Close menu" onClick={() => setMobile(false)}><X size={18} /></button></div>
        <div className="workspace"><span className="workspace-icon">{avatarText[0]}</span><span><b>{workspaceName}</b><small>Personal workspace</small></span><ChevronDown size={15} /></div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'selected' : '')}>
              <Icon size={17} /> {label} {to === '/discover' && <span className="new">NEW</span>}
              {/* [Sprint 6 · M2] US-19: unread direct messages (real accounts only, like the notification bell) */}
              {to === '/messages' && user && !user.isDemo && <DmUnreadBadge />}
            </NavLink>
          ))}
        </nav>
        <div className="nav-label flex">YOUR PROJECTS <button aria-label="Create project" onClick={openCreate}><Plus size={14} /></button></div>
        <nav>
          {workspaceProjects.slice(0, 5).map((project) => (
            <button key={project.id} onClick={() => navigate(`/project/${project.id}`)} className={location.pathname === `/project/${project.id}` ? 'selected' : ''}>
              <i className={`dot ${tone(project.color)}`} /><span className="label-ellipsis">{project.name}</span>
            </button>
          ))}
          {workspaceProjects.length === 0 && <span className="side-empty">No projects yet</span>}
        </nav>
        <button className="create-side" onClick={openCreate}><Plus size={16} /> Create a project</button>
        <div className="grow" />
        <div className="sidebar-bottom">
          <button onClick={toggle}>{dark ? <Sun size={16} /> : <Moon size={16} />} {dark ? 'Light mode' : 'Dark mode'}</button>
          <div className="mini-user">
            <Avatar initials={avatarText} src={user?.avatarSrc} />
            <div><b>{displayName}</b><small>{user?.email || 'demo@devorbit.app'}</small></div>
            <button className="iconbtn" aria-label="Log out" title="Log out" onClick={logout}><LogOut size={15} /></button>
          </div>
        </div>
      </aside>
      {mobile && <div className="scrim" onClick={() => setMobile(false)} />}

      <main className="main">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Open menu" onClick={() => setMobile(true)}><Menu size={19} /></button>
          <div className="crumb">Workspace <span>/</span> <b>{pageTitle(location.pathname)}</b></div>
          <div className="top-actions">
            <label className="top-search">
              <Search size={15} />
              <input aria-label="Search DevOrbit" value={globalSearch} onChange={(e) => setGlobalSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/discover?q=${encodeURIComponent(globalSearch)}`); if (e.key === 'Escape') setGlobalSearch(''); }} placeholder="Search people & projects..." />
              {globalSearch && <button type="button" className="clear" aria-label="Clear search" onClick={() => setGlobalSearch('')}><X size={13} /></button>}
              <kbd>⌘ K</kbd>
            </label>
            {/* [Sprint 3 · M7 Part 2] Real notifications for signed-in users; the demo keeps the static bell. */}
            {user && !user.isDemo
              ? <NotificationBell />
              : <button className="iconbtn bell" aria-label="Notifications" title="Notifications"><Bell size={17} /><i /></button>}
            <button className="profile-button" onClick={() => navigate('/profile')} aria-label="Open profile"><Avatar initials={avatarText} src={user?.avatarSrc} /><ChevronDown size={13} /></button>
          </div>
        </header>
        <div className="content"><Outlet context={{ openCreate }} /></div>
        <footer className="main-footer"><span>© 2026 DevOrbit</span><span><i /> {user?.isDemo ? 'Interactive demo workspace' : 'API-connected workspace'}</span><span className="spacer" /></footer>
      </main>

      {showCreate && (
        <div className="modal-back" onClick={() => setShowCreate(false)}>
          <form className="modal create-modal" onSubmit={createProject} onClick={(e) => e.stopPropagation()}>
            <div className="modal-top"><span className="modal-icon"><FolderKanban size={19} /></span><button type="button" className="iconbtn" aria-label="Close" onClick={() => setShowCreate(false)}><X size={17} /></button></div>
            <h2>Create a project</h2>
            <p>Give your next idea a home. You will be its Owner. Add teammates and their roles now, or later from the Team panel.</p>
            <label>Project name<input className="field-input" autoFocus value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="e.g. CampusConnect" required maxLength={80} /></label>
            <label>Description
              <textarea className="field-input" rows={3} value={projectDescription} onChange={(e) => setProjectDescription(e.target.value)} placeholder="What are you building, and who is it for?" maxLength={2000} />
              <span className="char-count">{projectDescription.length}/2000</span>
            </label>
            <label>Domain
              <select className="field-input" value={projectDomain} onChange={(e) => setProjectDomain(e.target.value)}>
                {DOMAINS.map((domain) => <option key={domain}>{domain}</option>)}
              </select>
            </label>
            <div className="field-wrap" role="radiogroup" aria-label="Visibility">
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>Visibility</span>
              <div className="segmented">
                {VISIBILITIES.map(({ value, label, hint, icon: Icon }) => (
                  <label key={value} className={projectVisibility === value ? 'on' : ''}>
                    <input type="radio" name="visibility" value={value} checked={projectVisibility === value} onChange={() => setProjectVisibility(value)} />
                    <Icon size={14} /><span>{label}<small>{hint}</small></span>
                  </label>
                ))}
              </div>
            </div>
            <div className="starting-members" role="group" aria-label="Starting members">
              <div className="starting-members-head">
                <span>Starting members <small>optional</small></span>
                {startingMembers.length < MAX_STARTING_MEMBERS && (
                  <button type="button" className="link" onClick={addStartingMember}><UserPlus size={14} /> Add a member</button>
                )}
              </div>
              {startingMembers.length === 0 && <p className="tiny-note">Add people who already have a DevOrbit account, by email or username.</p>}
              {startingMembers.map((row, index) => (
                <div className="starting-member-row" key={row.key}>
                  <input className="field-input" value={row.identifier} onChange={(e) => updateStartingMember(row.key, 'identifier', e.target.value)} placeholder="Email or @username" aria-label={`Starting member ${index + 1} email or username`} maxLength={254} />
                  <select className="field-input" value={row.role} onChange={(e) => updateStartingMember(row.key, 'role', e.target.value)} aria-label={`Starting member ${index + 1} role`} title={ROLE_HELP[row.role]}>
                    {STARTING_MEMBER_ROLES.map((role) => <option key={role}>{role}</option>)}
                  </select>
                  <button type="button" className="iconbtn" aria-label={`Remove starting member ${index + 1}`} onClick={() => removeStartingMember(row.key)}><X size={14} /></button>
                </div>
              ))}
              {user?.isDemo && startingMembers.length > 0 && <p className="tiny-note">Demo mode: starting members are only saved for real accounts.</p>}
            </div>
            {createError && <div className="form-error" role="alert">{createError}</div>}
            <button className="btn full" type="submit" disabled={creating}>{projectCreated ? 'Project added ✓' : creating ? 'Creating…' : 'Create workspace'} <Plus size={16} /></button>
            <p className="tiny-note">Your project is saved to your DevOrbit workspace.</p>
          </form>
        </div>
      )}
    </div>
  );
}

function pageTitle(path) {
  if (path.startsWith('/project')) return 'Project workspace';
  if (path === '/profile') return 'My profile';
  if (path === '/discover') return 'Discover';
  if (path === '/feed') return 'Community feed'; // [Sprint 5 · M6]
  if (path.startsWith('/messages')) return 'Messages'; // [Sprint 6 · M2] US-19
  return 'Overview';
}

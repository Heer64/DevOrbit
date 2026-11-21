import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, Compass, Flag, FolderKanban, Globe2, Keyboard, LayoutDashboard, Lock, LogOut, Menu, MessageCircle, MessagesSquare, Moon, Plus, Rocket, Search, Settings, ShieldCheck, Sparkles, Sun, UserPlus, UserRound, X } from 'lucide-react'; // [Sprint 7 · M5] + Settings
import { CommandPalette, ShortcutSheet } from './CommandPalette';
import Logo from './Logo';
import { Avatar, initialsOf, tone } from './ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { projectApi, toProjectCard } from '../api';
import NotificationBell from './NotificationBell'; // [Sprint 3 · M7 Part 2] US-30
import DmUnreadBadge from './DmUnreadBadge'; // [Sprint 6 · M2] US-19
import { MAX_STARTING_MEMBERS, PROJECT_DOMAINS as DOMAINS, STARTING_MEMBER_ROLES, startingMembersPayload } from '../domains'; // [Sprint 1 · gaps]
import { ROLE_HELP } from '../roles';
import { canModerate, isPlatformAdmin } from '../platformRoles'; // [Sprint 6 · M8] US-57, US-58 · [Sprint 6 · M7] + canModerate (US-56)

const VISIBILITIES = [
  { value: 'Private', label: 'Private', hint: 'Only members can open it', icon: Lock },
  { value: 'Public', label: 'Public', hint: 'Anyone signed in can find it', icon: Globe2 },
];

export default function AppShell() {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const [workspaceProjects, setWorkspaceProjects] = useState([]);
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

  // [Solar Ember] Command palette, keyboard shortcuts and the account menu (frontend only).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const openPalette = useCallback(() => { setMenuOpen(false); setPaletteOpen(true); }, []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);
  const searchFor = useCallback((q) => navigate(`/discover?q=${encodeURIComponent(q)}`), [navigate]);

  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const away = (event) => { if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false); };
    const esc = (event) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [menuOpen]);

  const navItems = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, key: 'd' },
    { to: '/discover', label: 'Discover', icon: Compass, key: 'e' },
    { to: '/feed', label: 'Community feed', icon: MessagesSquare, key: 'f' }, // [Sprint 5 · M6] US-50/US-51
    { to: '/messages', label: 'Messages', icon: MessageCircle, key: 'm' }, // [Sprint 6 · M2] US-19 direct messages
    { to: '/profile', label: 'My profile', icon: UserRound, key: 'p' },
    { to: '/settings', label: 'Settings', icon: Settings, key: 's' }, // [Sprint 7 · M5] Settings page
  ];
  // [Sprint 6 · M8] US-57, US-58: only Platform Admins see the Admin panel link (the server checks the role again).
  // [Sprint 6 · M7] US-56: Content Moderators and Platform Admins see the moderator queue link (the server checks again).
  const staffItems = [
    ...(canModerate(user) ? [{ to: '/moderation', label: 'Moderation', icon: Flag }] : []),
    ...(isPlatformAdmin(user) ? [{ to: '/admin', label: 'Admin panel', icon: ShieldCheck }] : []),
  ];
  const displayName = user?.name || 'Demo user';
  const avatarText = user?.avatar || initialsOf(user?.name);
  const roleText = isPlatformAdmin(user) ? 'Platform admin' : canModerate(user) ? 'Content moderator' : 'Member';
  const projectCount = workspaceProjects.length;

  const paletteItems = useMemo(() => [
    ...[...navItems, ...staffItems].map(({ to, label, icon }) => ({ group: 'Go to', label, icon, hint: to, run: () => navigate(to) })),
    ...workspaceProjects.map((project) => ({ group: 'Projects', label: project.name, dot: tone(project.color), hint: project.domain || project.tag || 'Project', run: () => navigate(`/project/${project.id}`) })),
    { group: 'Actions', label: 'Create a new project', icon: Plus, hint: 'N', run: openCreate },
    { group: 'Actions', label: dark ? 'Switch to light theme' : 'Switch to dark theme', icon: dark ? Sun : Moon, hint: 'T', run: toggle },
    { group: 'Actions', label: 'Keyboard shortcuts', icon: Keyboard, hint: '?', run: () => setShortcutsOpen(true) },
    { group: 'Actions', label: 'Take the intro tour', icon: Rocket, hint: '/welcome', run: () => navigate('/welcome') },
    ...(user?.username ? [{ group: 'Actions', label: 'Open my public portfolio', icon: Sparkles, run: () => navigate(`/portfolio/${user.username}`) }] : []),
    { group: 'Actions', label: 'Log out of DevOrbit', icon: LogOut, run: logout },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [workspaceProjects, dark, user]);

  // Global keyboard shortcuts. Ignored while typing in a field (except Ctrl/Cmd K).
  useEffect(() => {
    let pendingG = 0;
    const onKey = (event) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'k') { event.preventDefault(); setPaletteOpen((open) => !open); return; }
      const target = event.target;
      const typing = target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName));
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (document.querySelector('.modal-back, .palette-back, [role="dialog"][aria-modal="true"]')) return;
      if (pendingG && Date.now() - pendingG < 1200) {
        pendingG = 0;
        const item = navItems.find((nav) => nav.key === key);
        if (item) { event.preventDefault(); navigate(item.to); }
        return;
      }
      if (key === 'g') { pendingG = Date.now(); return; }
      if (key === '/') { event.preventDefault(); setPaletteOpen(true); }
      else if (event.key === '?') { event.preventDefault(); setShortcutsOpen(true); }
      else if (key === 'n') { event.preventDefault(); openCreate(); }
      else if (key === 't') { event.preventDefault(); toggle(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggle]);

  const navLink = ({ to, label, icon: Icon }) => (
    <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'selected' : '')}>
      <Icon size={18} aria-hidden="true" /><span className="nav-text">{label}</span>
      {to === '/discover' && <span className="new">NEW</span>}
      {/* [Sprint 6 · M2] US-19: unread direct messages (real accounts only, like the notification bell) */}
      {to === '/messages' && user && !user.isDemo && <DmUnreadBadge />}
    </NavLink>
  );

  return (
    <div className="shell">
      <aside className={`sidebar ${mobile ? 'show' : ''}`} aria-label="Sidebar">
        <div className="sidebar-head"><NavLink to="/dashboard" className="brand-link" aria-label="DevOrbit home"><Logo /></NavLink><button className="mobile-close" aria-label="Close menu" onClick={() => setMobile(false)}><X size={18} /></button></div>
        <button type="button" className="btn side-new" onClick={openCreate} aria-label="New project: create a project"><Plus size={17} aria-hidden="true" /> New project</button>
        <nav className="side-nav" aria-label="Main">{navItems.map(navLink)}</nav>
        <div className="side-section">
          <div className="nav-label flex"><span>Your projects</span><button type="button" aria-label="Create project" title="Create project" onClick={openCreate}><Plus size={14} /></button></div>
          <nav aria-label="Your projects">
            {workspaceProjects.slice(0, 6).map((project) => (
              <button key={project.id} onClick={() => navigate(`/project/${project.id}`)} className={location.pathname === `/project/${project.id}` ? 'selected' : ''}>
                <i className={`sq ${tone(project.color)}`} aria-hidden="true" /><span className="label-ellipsis">{project.name}</span>
              </button>
            ))}
            {workspaceProjects.length === 0 && <span className="side-empty">No active projects yet</span>}
          </nav>
        </div>
        {staffItems.length > 0 && (
          <div className="side-section">
            <div className="nav-label">{isPlatformAdmin(user) ? 'Admin' : 'Moderator'}</div>
            <nav aria-label="Staff">{staffItems.map(navLink)}</nav>
          </div>
        )}
        <div className="side-bottom">
          <div className="side-note"><i className={user?.isDemo ? 'amber' : 'green'} aria-hidden="true" /><span>{user?.isDemo ? 'Demo mode: your changes stay in this browser.' : 'Connected: changes sync with your team live.'}</span></div>
          <div className="side-user">
            <NavLink to="/profile" className="side-user-link" aria-label={`${displayName}, ${roleText}`}>
              <span className="side-avatar"><Avatar initials={avatarText} src={user?.avatarSrc} /><i aria-hidden="true" /></span>
              <span className="side-user-text"><b>{displayName}</b><small>{roleText} · {projectCount} project{projectCount === 1 ? '' : 's'}</small></span>
            </NavLink>
            <button className="iconbtn" aria-label="Log out" title="Log out" onClick={logout}><LogOut size={15} /></button>
          </div>
        </div>
      </aside>
      {mobile && <div className="scrim" onClick={() => setMobile(false)} />}

      <main className="main">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Open menu" onClick={() => setMobile(true)}><Menu size={19} /></button>
          <button type="button" className="search-btn" onClick={openPalette} aria-label="Open command palette"><Search size={17} aria-hidden="true" /><span>Search or jump to…</span><kbd>Ctrl K</kbd></button>
          <div className="crumb"><span>Workspace</span><span className="sep">/</span><b>{pageTitle(location.pathname)}</b></div>
          <span className="top-grow" />
          <span className={`live-pill ${user?.isDemo ? 'demo' : ''}`}><i aria-hidden="true" />{user?.isDemo ? 'Demo' : 'Live'}</span>
          <button type="button" className="iconbtn top-icon" onClick={toggle} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} title={dark ? 'Light mode' : 'Dark mode'}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
          {/* [Sprint 3 · M7 Part 2] Real notifications for signed-in users; the demo keeps the static bell. */}
          {user && !user.isDemo
            ? <NotificationBell />
            : <button className="iconbtn bell top-icon" aria-label="Notifications" title="Notifications"><Bell size={18} /><i /></button>}
          <div className="account" ref={menuRef}>
            <button type="button" className="profile-button" onClick={() => setMenuOpen((open) => !open)} aria-label="Account menu" aria-haspopup="menu" aria-expanded={menuOpen}><Avatar initials={avatarText} src={user?.avatarSrc} /><ChevronDown size={14} /></button>
            {menuOpen && (
              <div className="account-menu" role="menu" aria-label="Account">
                <div className="account-head"><b>{displayName}</b><small>{user?.email || 'demo@devorbit.app'}</small></div>
                <div className="account-list">
                  <button type="button" role="menuitem" onClick={() => navigate('/profile')}><UserRound size={16} />Profile</button>
                  {/* [Sprint 7 · M5] Settings page */}
                  <button type="button" role="menuitem" onClick={() => navigate('/settings')}><Settings size={16} />Settings</button>
                  {user?.username && <button type="button" role="menuitem" onClick={() => navigate(`/portfolio/${user.username}`)}><Sparkles size={16} />My portfolio</button>}
                  <button type="button" role="menuitem" onClick={() => navigate('/welcome')}><Globe2 size={16} />Intro page</button>
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setShortcutsOpen(true); }}><Keyboard size={16} />Keyboard shortcuts</button>
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); toggle(); }}>{dark ? <Sun size={16} /> : <Moon size={16} />}{dark ? 'Light mode' : 'Dark mode'}</button>
                  <button type="button" role="menuitem" className="danger" onClick={logout}><LogOut size={16} />Sign out</button>
                </div>
              </div>
            )}
          </div>
        </header>
        <div className="content"><Outlet context={{ openCreate, openPalette }} /></div>
        <footer className="main-footer"><span>© 2026 DevOrbit</span><span><i /> {user?.isDemo ? 'Interactive demo workspace' : 'API-connected workspace'}</span><span className="spacer" /><button type="button" className="link" onClick={() => setShortcutsOpen(true)}><Keyboard size={13} /> Shortcuts</button></footer>
      </main>

      <CommandPalette open={paletteOpen} onClose={closePalette} items={paletteItems} onSearch={searchFor} />
      <ShortcutSheet open={shortcutsOpen} onClose={closeShortcuts} />

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
  if (path === '/dashboard') return 'Dashboard';
  if (path === '/profile') return 'My profile';
  if (path === '/settings') return 'Settings'; // [Sprint 7 · M5]
  if (path === '/discover') return 'Discover';
  if (path === '/feed') return 'Community feed'; // [Sprint 5 · M6]
  if (path.startsWith('/messages')) return 'Messages'; // [Sprint 6 · M2] US-19
  if (path === '/admin') return 'Admin panel'; // [Sprint 6 · M8] US-57, US-58
  if (path === '/moderation') return 'Moderator queue'; // [Sprint 6 · M7] US-56
  return 'Overview';
}

import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'; // [Sprint 5 · M1] US-45: useSearchParams for shareable filters
import { ArrowRight, ArrowUpRight, BadgeCheck, Bookmark, BriefcaseBusiness, Check, ChevronDown, Compass, Filter, Github, LogIn, MapPin, Search, SlidersHorizontal, Sparkles, Tag, UserPlus, Users, Zap } from 'lucide-react'; // [Sprint 5 · M1] + LogIn, Tag
import { LogoMark } from '../components/Logo';
import { AVATAR_TONES, Avatar, Btn, EmptyPanel, Heading, initialsOf, tone } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { projectApi, publicApi, userApi } from '../api'; // [Sprint 5 · M1] US-45: publicApi (no login)
import { publicProjectPath } from '../lib/publicLinks'; // [Sprint 5 · M1] US-45: the one place card links are made

// Sample data for the demo workspace only. Signed-in users load real public projects
// (GET /api/projects/discover) and discoverable people (GET /api/profile/people).
const sampleProjects = [
  { id: 'orbit-dashboard', name: 'Orbit dashboard', creator: 'Aarav Mehta', initials: 'AM', description: 'A calmer home for collaborative teams — keeping tasks, people, and progress connected.', tags: ['React', 'Productivity', 'Open source'], domain: 'Developer tools', contributors: 5, progress: 72, tone: 'violet', trending: 96 },
  { id: 'campus-connect', name: 'CampusConnect', creator: 'Riya Kapoor', initials: 'RK', description: 'Helping students find teammates, form project groups, and build beyond the classroom.', tags: ['Node.js', 'Community', 'Education'], domain: 'Education', contributors: 8, progress: 58, tone: 'orange', trending: 92 },
  { id: 'greenlight', name: 'Greenlight', creator: 'Jai Shah', initials: 'JS', description: 'A simple dashboard that makes everyday environmental impact feel tangible.', tags: ['React', 'Sustainability', 'Design'], domain: 'Climate tech', contributors: 4, progress: 88, tone: 'teal', trending: 84 },
  { id: 'pulse-api', name: 'Pulse API', creator: 'Nikhil Rao', initials: 'NR', description: 'A small, well-documented API starter with validation, observability, and clean conventions.', tags: ['Express', 'MongoDB', 'Backend'], domain: 'Developer tools', contributors: 3, progress: 46, tone: 'blue', trending: 79 },
  { id: 'papertrail', name: 'Papertrail', creator: 'Mira Patel', initials: 'MP', description: 'Turn research notes into linked, searchable knowledge that a whole team can use.', tags: ['AI', 'Research', 'Knowledge'], domain: 'Research', contributors: 6, progress: 39, tone: 'pink', trending: 73 },
  { id: 'launchpad', name: 'Launchpad UI', creator: 'Dev Malhotra', initials: 'DM', description: 'Accessible React components and page patterns for fast-moving student teams.', tags: ['React', 'UI', 'Open source'], domain: 'Design systems', contributors: 7, progress: 63, tone: 'yellow', trending: 68 },
];
const samplePeople = [
  { name: 'Riya Kapoor', handle: '@riya.builds', role: 'Frontend developer', location: 'Pune, India', skills: ['React', 'Figma', 'CSS'], initials: 'RK', tone: 'orange', projects: 4, followers: 128, bio: 'Crafting interfaces that feel as good as they work.' },
  { name: 'Nikhil Rao', handle: '@nik.codes', role: 'Backend & API engineer', location: 'Bengaluru, India', skills: ['Node.js', 'MongoDB', 'Express'], initials: 'NR', tone: 'blue', projects: 6, followers: 94, bio: 'Clean APIs, good docs, fewer 3am surprises.' },
  { name: 'Jai Shah', handle: '@jaishah', role: 'Full-stack developer', location: 'Ahmedabad, India', skills: ['React', 'Node.js', 'AI'], initials: 'JS', tone: 'teal', projects: 3, followers: 86, bio: 'Building at the intersection of community and code.' },
  { name: 'Mira Patel', handle: '@miramakes', role: 'Developer & researcher', location: 'Mumbai, India', skills: ['Python', 'AI', 'Research'], initials: 'MP', tone: 'pink', projects: 5, followers: 210, bio: 'Making research more collaborative and accessible.' },
  { name: 'Dev Malhotra', handle: '@dev.designs', role: 'Product designer / developer', location: 'Delhi, India', skills: ['UI', 'React', 'Accessibility'], initials: 'DM', tone: 'yellow', projects: 8, followers: 176, bio: 'Thoughtful products, usable by everyone.' },
];


export const SEARCH_DEBOUNCE_MS = 300;
const ALL_DOMAINS = 'All domains';

// API project -> the card shape this page renders.
export function toDiscoverProject(project = {}) {
  const name = project.name || 'Untitled project';
  return {
    id: String(project._id || project.id || ''),
    name,
    creator: '',
    initials: initialsOf(name),
    description: project.description || 'No description yet.',
    tags: Array.isArray(project.tags) ? project.tags : [],
    domain: project.domain || 'General',
    // [Sprint 5 · M1] US-45: the public API sends memberCount instead of a members list.
    contributors: Number.isFinite(project.memberCount) ? project.memberCount : Array.isArray(project.members) ? project.members.length : 0,
    // [Sprint 5 · M1] The public API does not send progress; then no progress bar is drawn (null).
    progress: project.progress === undefined || project.progress === null ? null : Number(project.progress || 0),
    status: project.status || '', // [Sprint 5 · M1] US-45: shown on the card and used by the Status filter
    tone: project.color || 'violet',
    trending: null,
  };
}

// API person -> the card shape this page renders.
export function toDiscoverPerson(person = {}) {
  return {
    id: String(person.id || person._id || ''),
    name: person.name || 'DevOrbit member',
    handle: person.username ? `@${person.username}` : '',
    username: person.username || '', // [Sprint 5 · M3] US-06: opens /people/:username
    role: person.role || 'DevOrbit member',
    location: '',
    skills: Array.isArray(person.skills) ? person.skills : [],
    initials: person.initials || initialsOf(person.name),
    tone: person.color || 'violet',
    projects: Number(person.projects || 0),
    followers: null,
    bio: '',
    githubUrl: person.githubUrl || '',
  };
}

// Waits until the user stops typing before the value changes.
function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// Loads one discover list from the API.
// Returns { items, loading, loaded, error, retry }. Earlier results stay on screen while a new
// search loads, so typing does not flash a loading panel; `loaded` is false only before the first answer.
function useDiscoverList(enabled, query, load, map) {
  const [attempt, setAttempt] = useState(0);
  const key = `${query}|${attempt}`;
  const [state, setState] = useState({ items: [], error: '', key: null });

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    load(query)
      .then((result) => { if (active) setState({ items: map(result), error: '', key }); })
      .catch((error) => { if (active) setState({ items: [], error: error.message || 'Could not load results.', key }); });
    return () => { active = false; };
    // load/map are module-level functions; the query and retries decide when to reload.
  }, [enabled, key]);

  return {
    items: state.items,
    error: state.error,
    loaded: state.key !== null,
    loading: enabled && state.key !== key,
    retry: () => setAttempt((n) => n + 1),
  };
}

const loadProjects = (q) => projectApi.discover(q);
const mapProjects = (result) => (result.projects || []).map(toDiscoverProject);
const loadPeople = (q) => userApi.search(q);
const mapPeople = (result) => (result.people || []).map(toDiscoverPerson);

// [Sprint 5 · M1] US-45 Browse and filter public projects (Actor: Visitor).
// Visitors and logged-in users both get the public list from GET /api/public/projects; the server
// applies the keyword, domain, skill-tag and status filters. Demo users keep the sample cards.
// The filters live in the URL (?q=&domain=&tag=&status=&page=), so a filtered list can be shared.
export const ALL_TAGS = 'All skill tags';
export const ANY_STATUS = 'Any status';
export const PUBLIC_FILTER_PARAMS = ['q', 'domain', 'tag', 'status', 'page'];

// One page of public projects for the filters. Same shape as useDiscoverList, plus total/page/pageSize.
function usePublicProjects(enabled, filters) {
  const [attempt, setAttempt] = useState(0);
  const key = `${JSON.stringify(filters)}|${attempt}`;
  const [state, setState] = useState({ items: [], total: 0, page: 1, pageSize: 24, error: '', key: null });

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    publicApi.projects(filters)
      .then((result) => {
        if (active) setState({ items: mapProjects(result), total: Number(result.total) || 0, page: Number(result.page) || 1, pageSize: Number(result.pageSize) || 24, error: '', key });
      })
      .catch((error) => {
        if (active) setState({ items: [], total: 0, page: 1, pageSize: 24, error: error.message || 'Could not load public projects.', key });
      });
    return () => { active = false; };
    // filters and retries are both in `key`.
  }, [enabled, key]);

  return {
    items: state.items,
    total: state.total,
    page: state.page,
    pageSize: state.pageSize,
    error: state.error,
    loaded: state.key !== null,
    loading: enabled && state.key !== key,
    retry: () => setAttempt((n) => n + 1),
  };
}

// The choices for the Domain / Skill tag / Status dropdowns (GET /api/public/projects/filters).
function usePublicFilterChoices(enabled) {
  const [choices, setChoices] = useState({ domains: [], statuses: [], tags: [] });
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    publicApi.filters()
      .then((result) => {
        if (active) setChoices({ domains: result.domains || [], statuses: result.statuses || [], tags: result.tags || [] });
      })
      .catch(() => {}); // the dropdowns still show the selected value; the list itself reports errors
    return () => { active = false; };
  }, [enabled]);
  return choices;
}

// Keeps the selected value in a dropdown even if the choices have not loaded (e.g. from a shared link).
const withSelected = (list, selected) => (selected && !list.includes(selected) ? [...list, selected] : list);

export default function DiscoverPage() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const navigate = useNavigate();
  const { user } = useAuth() || {};
  const live = Boolean(user && !user.isDemo);
  // [Sprint 5 · M1] US-45: visitors (not logged in) and real users see the public list; only demo users get samples.
  const visitor = !user;
  const publicList = !user?.isDemo;
  const [searchParams, setSearchParams] = useSearchParams();

  const [tab, setTab] = useState('projects');
  const [query, setQuery] = useState(params.get('q') || '');
  const [domain, setDomain] = useState(ALL_DOMAINS);
  const [followed, setFollowed] = useState([]);
  const [saved, setSaved] = useState([]);
  // [Sprint 5 · M1] Public lists (visitors too) have no trending score, so they sort like real users' lists.
  const sortOptions = live || !user ? ['Recently active', 'Alphabetical'] : ['Trending', 'Alphabetical'];
  const [sort, setSort] = useState(sortOptions[0]);

  // Real users: the API does the text search; the debounce keeps it to one request per pause.
  const apiQuery = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  // [Sprint 5 · M1] US-45: filters come from the URL; the server filters, sorts and pages.
  const urlFilters = {
    q: (searchParams.get('q') || '').trim(),
    domain: searchParams.get('domain') || '',
    tag: searchParams.get('tag') || '',
    status: searchParams.get('status') || '',
    page: searchParams.get('page') || '',
  };
  const liveProjects = usePublicProjects(publicList && tab === 'projects', urlFilters);
  const choices = usePublicFilterChoices(publicList);
  // Changes some URL filters; any change other than the page goes back to page 1.
  const setFilters = (changes) => setSearchParams((old) => {
    const next = new URLSearchParams(old);
    for (const [name, value] of Object.entries(changes)) {
      if (value) next.set(name, value);
      else next.delete(name);
    }
    if (!('page' in changes)) next.delete('page');
    return next;
  }, { replace: true });
  // The typed keyword goes into the URL after the debounce pause, which starts the request.
  useEffect(() => {
    if (!publicList || apiQuery === urlFilters.q) return;
    setFilters({ q: apiQuery });
    // only the debounced text decides this
  }, [apiQuery, publicList]);
  const filtersApplied = Boolean(urlFilters.q || urlFilters.domain || urlFilters.tag || urlFilters.status);
  const clearFilters = () => { setQuery(''); setFilters({ q: '', domain: '', tag: '', status: '' }); };
  const pageCount = Math.max(1, Math.ceil(liveProjects.total / (liveProjects.pageSize || 24)));
  const livePeople = useDiscoverList(live && tab === 'people', apiQuery, loadPeople, mapPeople);
  const active = tab === 'projects' ? liveProjects : livePeople;

  const allProjects = publicList ? liveProjects.items : sampleProjects; // [Sprint 5 · M1] was `live`
  const allPeople = live ? livePeople.items : samplePeople;

  const domains = useMemo(() => {
    const found = [...new Set(allProjects.map((p) => p.domain).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return domain !== ALL_DOMAINS && !found.includes(domain) ? [...found, domain] : found;
  }, [allProjects, domain]);

  // Demo data is searched here; real results are already searched by the API.
  const textMatch = (text) => live || text.toLowerCase().includes(query.trim().toLowerCase());
  const textMatchProjects = (text) => publicList || text.toLowerCase().includes(query.trim().toLowerCase()); // [Sprint 5 · M1]

  const filteredProjects = useMemo(() => {
    // [Sprint 5 · M1] Public list: the server already filtered; demo samples are filtered here as before.
    const list = publicList ? allProjects : allProjects.filter((p) => (domain === ALL_DOMAINS || p.domain === domain) && textMatchProjects(`${p.name} ${p.description} ${p.tags.join(' ')} ${p.creator}`));
    if (sort === 'Alphabetical') return [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'Trending') return [...list].sort((a, b) => b.trending - a.trending);
    return list; // 'Recently active': the API already returns the most recently updated first.
    // textMatch only depends on live and query.
  }, [allProjects, domain, sort, query, live, publicList]);

  const filteredPeople = useMemo(
    () => allPeople.filter((p) => textMatch(`${p.name} ${p.role} ${p.skills.join(' ')}`)),
    [allPeople, query, live]
  );

  const toggle = (list, setList, id) => setList((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old, id]));
  const nextSort = () => setSort(sortOptions[(sortOptions.indexOf(sort) + 1) % sortOptions.length]);
  const projectCount = publicList ? (liveProjects.loaded ? liveProjects.total : null) : sampleProjects.length; // [Sprint 5 · M1] total of all pages
  const peopleCount = live ? (livePeople.loaded ? livePeople.items.length : null) : user ? samplePeople.length : null; // [Sprint 5 · M1] no count for visitors
  // [Sprint 5 · M1] Projects load for visitors too; People still needs a real login (visitors get a prompt instead).
  const activeLive = tab === 'projects' ? publicList : live;
  const showLoading = activeLive && active.loading && !active.loaded;
  const showError = activeLive && !active.loading && active.error;
  const logInState = { from: { pathname: location.pathname, search: location.search } };

  return (
    <>
      <Heading eyebrow="THE DEVORBIT COMMUNITY" title={<>Find your next <em>orbit.</em></>} subtitle="Discover ideas worth building and the teams bringing them to life." />

      <section className="discover-hero">
        <div>
          <div className="eyebrow"><Compass size={13} /> EXPLORE YOUR NEXT POSSIBILITY</div>
          <h2>Good things happen<br />when paths cross.</h2>
          <p>Good work starts with good people. Find projects worth joining and people who share your interests.</p>
          <label className="discover-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tab === 'projects' ? 'Search projects, tags, or creators' : 'Search people or skills...'} aria-label={tab === 'projects' ? 'Search projects' : 'Search people'} />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search">×</button>}</label>
          {user?.isDemo && <div className="hero-figures"><div><b>1.2k+</b><small>projects to explore</small></div><div className="divider" /><div><b>3.8k+</b><small>builders in orbit</small></div></div>}
        </div>
        <div className="discover-orbit"><LogoMark /></div>
      </section>

      <div className="discover-controls">
        <div className="switch-tabs">
          <button className={tab === 'projects' ? 'active' : ''} onClick={() => setTab('projects')}><BriefcaseBusiness size={14} /> Projects {projectCount !== null && <span>{projectCount}</span>}</button>
          <button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}><Users size={14} /> People {peopleCount !== null && <span>{peopleCount}</span>}</button>
        </div>
        {tab === 'projects' && !publicList && (
          <div className="filters">
            <label className="select-control"><Filter size={13} />
              <select value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="Filter by domain">
                <option>{ALL_DOMAINS}</option>
                {domains.map((name) => <option key={name}>{name}</option>)}
              </select><ChevronDown size={13} />
            </label>
            <button className="sort-btn" onClick={nextSort} aria-label={`Sort: ${sort}`}><SlidersHorizontal size={13} /> {sort} <ChevronDown size={13} /></button>
          </div>
        )}
        {/* [Sprint 5 · M1] US-45: domain, skill-tag and status filters, done by the server. */}
        {tab === 'projects' && publicList && (
          <div className="filters" role="group" aria-label="Project filters">
            <label className="select-control"><Filter size={13} />
              <select value={urlFilters.domain || ALL_DOMAINS} onChange={(e) => setFilters({ domain: e.target.value === ALL_DOMAINS ? '' : e.target.value })} aria-label="Filter by domain">
                <option>{ALL_DOMAINS}</option>
                {withSelected(choices.domains, urlFilters.domain).map((name) => <option key={name}>{name}</option>)}
              </select><ChevronDown size={13} />
            </label>
            <label className="select-control"><Tag size={13} />
              <select value={urlFilters.tag || ALL_TAGS} onChange={(e) => setFilters({ tag: e.target.value === ALL_TAGS ? '' : e.target.value })} aria-label="Filter by skill tag">
                <option>{ALL_TAGS}</option>
                {withSelected(choices.tags, urlFilters.tag).map((name) => <option key={name}>{name}</option>)}
              </select><ChevronDown size={13} />
            </label>
            <label className="select-control"><SlidersHorizontal size={13} />
              <select value={urlFilters.status || ANY_STATUS} onChange={(e) => setFilters({ status: e.target.value === ANY_STATUS ? '' : e.target.value })} aria-label="Filter by status">
                <option>{ANY_STATUS}</option>
                {withSelected(choices.statuses, urlFilters.status).map((name) => <option key={name}>{name}</option>)}
              </select><ChevronDown size={13} />
            </label>
            <button className="sort-btn" onClick={nextSort} aria-label={`Sort: ${sort}`}><SlidersHorizontal size={13} /> {sort} <ChevronDown size={13} /></button>
            {filtersApplied && <button type="button" className="link" style={{ marginTop: 0 }} onClick={clearFilters}>Clear filters</button>}
          </div>
        )}
      </div>

      {showLoading && <section className="panel placeholder"><h2>{tab === 'projects' ? 'Loading projects…' : 'Loading people…'}</h2></section>}
      {showError && (
        <div className="form-error" role="alert">
          {active.error} <button type="button" className="link" onClick={active.retry}>Try again</button>
        </div>
      )}

      {!showLoading && !showError && tab === 'projects' && (
        <>
          <div className="section-head"><div><h2>{publicList ? 'Public projects' : 'Projects with momentum'} <span>{publicList ? liveProjects.total : filteredProjects.length}</span></h2><p>Find a project that fits your curiosity — or the skills you want to grow.</p></div></div>
          <div className="project-grid">
            {filteredProjects.map((p, i) => (
              <article className="project-card discover-card" key={p.id} style={{ cursor: 'default' }}>
                <div className="project-top">
                  <span className={`project-avatar ${tone(p.tone)}`}>{p.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</span>
                  <span className="top-right">
                    {p.trending !== null && <span className="trend"><Zap size={10} /> Trending</span>}
                    {!publicList && <button className={`save-btn ${saved.includes(p.id) ? 'saved' : ''}`} onClick={() => toggle(saved, setSaved, p.id)} title="Save project" aria-label="Save project"><Bookmark size={14} fill={saved.includes(p.id) ? 'currentColor' : 'none'} /></button>}
                  </span>
                </div>
                <div className="title-row"><h3>{p.name}</h3><span className="domain-chip">{p.domain}</span></div>
                <p>{p.description}</p>
                <div className="tags">{p.tags.map((t) => <span key={t}>{t}</span>)}</div>
                <div className="card-meta">
                  <span><Users size={12} />{p.contributors} {publicList ? `member${p.contributors === 1 ? '' : 's'}` : 'contributors'}</span>
                  {p.status && <span className="domain-chip" title="Project status">{p.status}</span>}
                  {p.creator && <span className="creator"><Avatar initials={p.initials} tone={AVATAR_TONES[i % 4]} small /><span>{p.creator}</span></span>}
                </div>
                {p.progress !== null && <div className="metric"><span>Progress</span><b>{p.progress}%</b></div>}
                {p.progress !== null && <div className="progress"><i className={tone(p.tone)} style={{ width: `${p.progress}%` }} /></div>}
                <div className="project-foot">{p.trending !== null ? <small>{p.trending}% trending score</small> : <small>Public project</small>}<button className="open-link" onClick={() => navigate(publicProjectPath(p.id))} aria-label={`View ${p.name}`}>View project <ArrowUpRight size={13} /></button></div>
              </article>
            ))}
          </div>
          {/* [Sprint 5 · M1] US-45: simple paging (24 per page). */}
          {publicList && pageCount > 1 && (
            <nav className="filters" aria-label="Pages" style={{ justifyContent: 'center', marginTop: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
              <Btn secondary className="small" disabled={liveProjects.page <= 1} onClick={() => setFilters({ page: liveProjects.page - 1 > 1 ? String(liveProjects.page - 1) : '' })}>Previous</Btn>
              <small>Page {liveProjects.page} of {pageCount}</small>
              <Btn secondary className="small" disabled={liveProjects.page >= pageCount} onClick={() => setFilters({ page: String(liveProjects.page + 1) })}>Next</Btn>
            </nav>
          )}
          {filteredProjects.length === 0 && publicList && (
            <EmptyPanel
              icon={Search}
              title="Nothing in this orbit yet"
              text={filtersApplied ? 'No public projects match these filters.' : 'No public projects yet. Make one of yours Public to see it here.'}
              onReset={filtersApplied ? clearFilters : undefined}
              resetLabel="Clear filters"
            />
          )}
          {filteredProjects.length === 0 && !publicList && (
            <EmptyPanel
              icon={Search}
              title="Nothing in this orbit yet"
              text={live && !query && domain === ALL_DOMAINS ? 'No public projects yet. Make one of yours Public to see it here.' : 'No projects found. Try a different search or domain.'}
              onReset={query || domain !== ALL_DOMAINS ? () => { setQuery(''); setDomain(ALL_DOMAINS); } : undefined}
            />
          )}
        </>
      )}

      {/* [Sprint 5 · M1] People search needs an account (GET /api/profile/people is login-only). */}
      {tab === 'people' && visitor && (
        <EmptyPanel icon={Users} title="Log in to meet collaborators" text="Searching people needs a DevOrbit account. Projects stay open to everyone." onReset={() => navigate('/login', { state: logInState })} resetLabel="Log in" />
      )}

      {!showLoading && !showError && tab === 'people' && !visitor && (
        <>
          <div className="section-head"><div><h2>Meet your next collaborator <span>{filteredPeople.length}</span></h2><p>Find people by the things they know and the things they love to build.</p></div><span className="match-note"><Sparkles size={13} /> Skill-based discovery</span></div>
          <div className="people-grid">
            {filteredPeople.map((p) => (
              <article className="panel person" key={p.id || p.handle}>
                <div className="person-head">
                  <Avatar initials={p.initials} tone={p.tone === 'orange' ? 'orange' : p.tone} large />
                  {!live && <Btn className={`small ${followed.includes(p.handle) ? 'following' : ''}`} secondary onClick={() => toggle(followed, setFollowed, p.handle)} icon={followed.includes(p.handle) ? Check : UserPlus}>{followed.includes(p.handle) ? 'Following' : 'Follow'}</Btn>}
                </div>
                <h3 className="person-id">{p.name} {!live && <BadgeCheck size={15} />}</h3>
                {p.handle && <p className="handle">{p.handle}</p>}
                <p className="role">{p.role}</p>
                {p.bio && <p className="bio">{p.bio}</p>}
                {p.location && <p className="place"><MapPin size={12} /> {p.location}</p>}
                <div className="skill-cloud">{p.skills.length ? p.skills.map((s) => <span key={s}>{s}</span>) : <small className="muted">No skills listed yet.</small>}</div>
                <div className="person-foot">
                  <span><BriefcaseBusiness size={13} />{p.projects} project{p.projects === 1 ? '' : 's'}</span>
                  {p.followers !== null && <span><Users size={13} />{p.followers + (followed.includes(p.handle) ? 1 : 0)} followers</span>}
                </div>
                {/* [Sprint 5 · M3] US-06: real people open their read-only profile. */}
                {live && p.username && <Btn secondary className="full person-profile-btn" onClick={() => navigate(`/people/${encodeURIComponent(p.username)}`)}>View profile <ArrowUpRight size={14} /></Btn>}
                {live
                  ? p.githubUrl && <a className="btn secondary full" href={/^https?:\/\//i.test(p.githubUrl) ? p.githubUrl : `https://${p.githubUrl}`} target="_blank" rel="noreferrer"><Github size={14} /> GitHub profile</a>
                  : <Btn secondary className="full" onClick={() => navigate('/profile')}>View profile <ArrowUpRight size={14} /></Btn>}
              </article>
            ))}
          </div>
          {filteredPeople.length === 0 && <EmptyPanel icon={Search} title="Nothing in this orbit yet" text={live && !query ? 'No one else has a discoverable profile yet.' : 'No people match that search yet.'} onReset={query ? () => setQuery('') : undefined} resetLabel="Clear search" />}
        </>
      )}

      <div className="bottom-cta"><Sparkles size={19} /><div><b>Have something worth building?</b><small>Start a project, invite people who care, and make it real.</small></div>{visitor
        ? <Btn secondary onClick={() => navigate('/signup', { state: logInState })} icon={LogIn}>Sign up to start one</Btn> /* [Sprint 5 · M1] visitors have no workspace yet */
        : <Btn secondary onClick={() => navigate('/dashboard')}>Go to workspace <ArrowRight size={14} /></Btn>}</div>
    </>
  );
}

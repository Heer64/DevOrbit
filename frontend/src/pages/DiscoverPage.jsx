import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, BadgeCheck, Bookmark, BriefcaseBusiness, Check, ChevronDown, Compass, Filter, Github, MapPin, Search, SlidersHorizontal, Sparkles, UserPlus, Users, Zap } from 'lucide-react';
import { LogoMark } from '../components/Logo';
import { AVATAR_TONES, Avatar, Btn, EmptyPanel, Heading, initialsOf, tone } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { projectApi, userApi } from '../api';

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
    contributors: Array.isArray(project.members) ? project.members.length : 0,
    progress: Number(project.progress || 0),
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

export default function DiscoverPage() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const navigate = useNavigate();
  const { user } = useAuth() || {};
  const live = Boolean(user && !user.isDemo);

  const [tab, setTab] = useState('projects');
  const [query, setQuery] = useState(params.get('q') || '');
  const [domain, setDomain] = useState(ALL_DOMAINS);
  const [followed, setFollowed] = useState([]);
  const [saved, setSaved] = useState([]);
  const sortOptions = live ? ['Recently active', 'Alphabetical'] : ['Trending', 'Alphabetical'];
  const [sort, setSort] = useState(sortOptions[0]);

  // Real users: the API does the text search; the debounce keeps it to one request per pause.
  const apiQuery = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const liveProjects = useDiscoverList(live && tab === 'projects', apiQuery, loadProjects, mapProjects);
  const livePeople = useDiscoverList(live && tab === 'people', apiQuery, loadPeople, mapPeople);
  const active = tab === 'projects' ? liveProjects : livePeople;

  const allProjects = live ? liveProjects.items : sampleProjects;
  const allPeople = live ? livePeople.items : samplePeople;

  const domains = useMemo(() => {
    const found = [...new Set(allProjects.map((p) => p.domain).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return domain !== ALL_DOMAINS && !found.includes(domain) ? [...found, domain] : found;
  }, [allProjects, domain]);

  // Demo data is searched here; real results are already searched by the API.
  const textMatch = (text) => live || text.toLowerCase().includes(query.trim().toLowerCase());

  const filteredProjects = useMemo(() => {
    const list = allProjects.filter((p) => (domain === ALL_DOMAINS || p.domain === domain) && textMatch(`${p.name} ${p.description} ${p.tags.join(' ')} ${p.creator}`));
    if (sort === 'Alphabetical') return [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'Trending') return [...list].sort((a, b) => b.trending - a.trending);
    return list; // 'Recently active': the API already returns the most recently updated first.
    // textMatch only depends on live and query.
  }, [allProjects, domain, sort, query, live]);

  const filteredPeople = useMemo(
    () => allPeople.filter((p) => textMatch(`${p.name} ${p.role} ${p.skills.join(' ')}`)),
    [allPeople, query, live]
  );

  const toggle = (list, setList, id) => setList((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old, id]));
  const nextSort = () => setSort(sortOptions[(sortOptions.indexOf(sort) + 1) % sortOptions.length]);
  const projectCount = live ? (liveProjects.loaded ? liveProjects.items.length : null) : sampleProjects.length;
  const peopleCount = live ? (livePeople.loaded ? livePeople.items.length : null) : samplePeople.length;
  const showLoading = live && active.loading && !active.loaded;
  const showError = live && !active.loading && active.error;

  return (
    <>
      <Heading eyebrow="THE DEVORBIT COMMUNITY" title={<>Find your next <em>orbit.</em></>} subtitle="Discover ideas worth building and the teams bringing them to life." />

      <section className="discover-hero">
        <div>
          <div className="eyebrow"><Compass size={13} /> EXPLORE YOUR NEXT POSSIBILITY</div>
          <h2>Good things happen<br />when paths cross.</h2>
          <p>Good work starts with good people. Find projects worth joining and people who share your interests.</p>
          <label className="discover-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tab === 'projects' ? 'Search projects, tags, or creators' : 'Search people or skills...'} aria-label={tab === 'projects' ? 'Search projects' : 'Search people'} />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search">×</button>}</label>
          {!live && <div className="hero-figures"><div><b>1.2k+</b><small>projects to explore</small></div><div className="divider" /><div><b>3.8k+</b><small>builders in orbit</small></div></div>}
        </div>
        <div className="discover-orbit"><LogoMark /></div>
      </section>

      <div className="discover-controls">
        <div className="switch-tabs">
          <button className={tab === 'projects' ? 'active' : ''} onClick={() => setTab('projects')}><BriefcaseBusiness size={14} /> Projects {projectCount !== null && <span>{projectCount}</span>}</button>
          <button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}><Users size={14} /> People {peopleCount !== null && <span>{peopleCount}</span>}</button>
        </div>
        {tab === 'projects' && (
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
      </div>

      {showLoading && <section className="panel placeholder"><h2>{tab === 'projects' ? 'Loading projects…' : 'Loading people…'}</h2></section>}
      {showError && (
        <div className="form-error" role="alert">
          {active.error} <button type="button" className="link" onClick={active.retry}>Try again</button>
        </div>
      )}

      {!showLoading && !showError && tab === 'projects' && (
        <>
          <div className="section-head"><div><h2>{live ? 'Public projects' : 'Projects with momentum'} <span>{filteredProjects.length}</span></h2><p>Find a project that fits your curiosity — or the skills you want to grow.</p></div></div>
          <div className="project-grid">
            {filteredProjects.map((p, i) => (
              <article className="project-card discover-card" key={p.id} style={{ cursor: 'default' }}>
                <div className="project-top">
                  <span className={`project-avatar ${tone(p.tone)}`}>{p.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</span>
                  <span className="top-right">
                    {p.trending !== null && <span className="trend"><Zap size={10} /> Trending</span>}
                    {!live && <button className={`save-btn ${saved.includes(p.id) ? 'saved' : ''}`} onClick={() => toggle(saved, setSaved, p.id)} title="Save project" aria-label="Save project"><Bookmark size={14} fill={saved.includes(p.id) ? 'currentColor' : 'none'} /></button>}
                  </span>
                </div>
                <div className="title-row"><h3>{p.name}</h3><span className="domain-chip">{p.domain}</span></div>
                <p>{p.description}</p>
                <div className="tags">{p.tags.map((t) => <span key={t}>{t}</span>)}</div>
                <div className="card-meta">
                  <span><Users size={12} />{p.contributors} {live ? `member${p.contributors === 1 ? '' : 's'}` : 'contributors'}</span>
                  {p.creator && <span className="creator"><Avatar initials={p.initials} tone={AVATAR_TONES[i % 4]} small /><span>{p.creator}</span></span>}
                </div>
                <div className="metric"><span>Progress</span><b>{p.progress}%</b></div>
                <div className="progress"><i className={tone(p.tone)} style={{ width: `${p.progress}%` }} /></div>
                <div className="project-foot">{p.trending !== null ? <small>{p.trending}% trending score</small> : <small>Public project</small>}<button className="open-link" onClick={() => navigate(`/project/${p.id}`)} aria-label={`View ${p.name}`}>View project <ArrowUpRight size={13} /></button></div>
              </article>
            ))}
          </div>
          {filteredProjects.length === 0 && (
            <EmptyPanel
              icon={Search}
              title="Nothing in this orbit yet"
              text={live && !query && domain === ALL_DOMAINS ? 'No public projects yet. Make one of yours Public to see it here.' : 'No projects found. Try a different search or domain.'}
              onReset={query || domain !== ALL_DOMAINS ? () => { setQuery(''); setDomain(ALL_DOMAINS); } : undefined}
            />
          )}
        </>
      )}

      {!showLoading && !showError && tab === 'people' && (
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
                {live
                  ? p.githubUrl && <a className="btn secondary full" href={/^https?:\/\//i.test(p.githubUrl) ? p.githubUrl : `https://${p.githubUrl}`} target="_blank" rel="noreferrer"><Github size={14} /> GitHub profile</a>
                  : <Btn secondary className="full" onClick={() => navigate('/profile')}>View profile <ArrowUpRight size={14} /></Btn>}
              </article>
            ))}
          </div>
          {filteredPeople.length === 0 && <EmptyPanel icon={Search} title="Nothing in this orbit yet" text={live && !query ? 'No one else has a discoverable profile yet.' : 'No people match that search yet.'} onReset={query ? () => setQuery('') : undefined} resetLabel="Clear search" />}
        </>
      )}

      <div className="bottom-cta"><Sparkles size={19} /><div><b>Have something worth building?</b><small>Start a project, invite people who care, and make it real.</small></div><Btn secondary onClick={() => navigate('/dashboard')}>Go to workspace <ArrowRight size={14} /></Btn></div>
    </>
  );
}

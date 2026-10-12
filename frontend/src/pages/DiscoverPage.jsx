import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, BadgeCheck, Bookmark, BriefcaseBusiness, Check, ChevronDown, Compass, Filter, MapPin, Search, SlidersHorizontal, Sparkles, UserPlus, Users, Zap } from 'lucide-react';
import { LogoMark } from '../components/Logo';
import { AVATAR_TONES, Avatar, Btn, EmptyPanel, Heading, tone } from '../components/ui';

const projects = [
  { id: 'orbit-dashboard', name: 'Orbit dashboard', creator: 'Aarav Mehta', initials: 'AM', description: 'A calmer home for collaborative teams — keeping tasks, people, and progress connected.', tags: ['React', 'Productivity', 'Open source'], domain: 'Developer tools', contributors: 5, progress: 72, tone: 'violet', trending: 96 },
  { id: 'campus-connect', name: 'CampusConnect', creator: 'Riya Kapoor', initials: 'RK', description: 'Helping students find teammates, form project groups, and build beyond the classroom.', tags: ['Node.js', 'Community', 'Education'], domain: 'Education', contributors: 8, progress: 58, tone: 'orange', trending: 92 },
  { id: 'greenlight', name: 'Greenlight', creator: 'Jai Shah', initials: 'JS', description: 'A simple dashboard that makes everyday environmental impact feel tangible.', tags: ['React', 'Sustainability', 'Design'], domain: 'Climate tech', contributors: 4, progress: 88, tone: 'teal', trending: 84 },
  { id: 'pulse-api', name: 'Pulse API', creator: 'Nikhil Rao', initials: 'NR', description: 'A small, well-documented API starter with validation, observability, and clean conventions.', tags: ['Express', 'MongoDB', 'Backend'], domain: 'Developer tools', contributors: 3, progress: 46, tone: 'blue', trending: 79 },
  { id: 'papertrail', name: 'Papertrail', creator: 'Mira Patel', initials: 'MP', description: 'Turn research notes into linked, searchable knowledge that a whole team can use.', tags: ['AI', 'Research', 'Knowledge'], domain: 'Research', contributors: 6, progress: 39, tone: 'pink', trending: 73 },
  { id: 'launchpad', name: 'Launchpad UI', creator: 'Dev Malhotra', initials: 'DM', description: 'Accessible React components and page patterns for fast-moving student teams.', tags: ['React', 'UI', 'Open source'], domain: 'Design systems', contributors: 7, progress: 63, tone: 'yellow', trending: 68 },
];
const people = [
  { name: 'Riya Kapoor', handle: '@riya.builds', role: 'Frontend developer', location: 'Pune, India', skills: ['React', 'Figma', 'CSS'], initials: 'RK', tone: 'orange', projects: 4, followers: 128, bio: 'Crafting interfaces that feel as good as they work.' },
  { name: 'Nikhil Rao', handle: '@nik.codes', role: 'Backend & API engineer', location: 'Bengaluru, India', skills: ['Node.js', 'MongoDB', 'Express'], initials: 'NR', tone: 'blue', projects: 6, followers: 94, bio: 'Clean APIs, good docs, fewer 3am surprises.' },
  { name: 'Jai Shah', handle: '@jaishah', role: 'Full-stack developer', location: 'Ahmedabad, India', skills: ['React', 'Node.js', 'AI'], initials: 'JS', tone: 'teal', projects: 3, followers: 86, bio: 'Building at the intersection of community and code.' },
  { name: 'Mira Patel', handle: '@miramakes', role: 'Developer & researcher', location: 'Mumbai, India', skills: ['Python', 'AI', 'Research'], initials: 'MP', tone: 'pink', projects: 5, followers: 210, bio: 'Making research more collaborative and accessible.' },
  { name: 'Dev Malhotra', handle: '@dev.designs', role: 'Product designer / developer', location: 'Delhi, India', skills: ['UI', 'React', 'Accessibility'], initials: 'DM', tone: 'yellow', projects: 8, followers: 176, bio: 'Thoughtful products, usable by everyone.' },
];

export default function DiscoverPage() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const navigate = useNavigate();
  const [tab, setTab] = useState('projects');
  const [query, setQuery] = useState(params.get('q') || '');
  const [domain, setDomain] = useState('All domains');
  const [followed, setFollowed] = useState([]);
  const [saved, setSaved] = useState([]);
  const [sort, setSort] = useState('Trending');

  const filteredProjects = useMemo(() => projects
    .filter((p) => (domain === 'All domains' || p.domain === domain) && `${p.name} ${p.description} ${p.tags.join(' ')} ${p.creator}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (sort === 'Trending' ? b.trending - a.trending : a.name.localeCompare(b.name))), [query, domain, sort]);
  const filteredPeople = useMemo(() => people.filter((p) => `${p.name} ${p.role} ${p.skills.join(' ')}`.toLowerCase().includes(query.toLowerCase())), [query]);
  const toggle = (list, setList, id) => setList((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old, id]));

  return (
    <>
      <Heading eyebrow="THE DEVORBIT COMMUNITY" title={<>Find your next <em>orbit.</em></>} subtitle="Discover ideas worth building and the teams bringing them to life." />

      <section className="discover-hero">
        <div>
          <div className="eyebrow"><Compass size={13} /> EXPLORE YOUR NEXT POSSIBILITY</div>
          <h2>Good things happen<br />when paths cross.</h2>
          <p>Good work starts with good people. Find projects worth joining and people who share your interests.</p>
          <label className="discover-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tab === 'projects' ? 'Search projects, tags, or creators' : 'Search people or skills...'} />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search">×</button>}</label>
          <div className="hero-figures"><div><b>1.2k+</b><small>projects to explore</small></div><div className="divider" /><div><b>3.8k+</b><small>builders in orbit</small></div></div>
        </div>
        <div className="discover-orbit"><LogoMark /></div>
      </section>

      <div className="discover-controls">
        <div className="switch-tabs">
          <button className={tab === 'projects' ? 'active' : ''} onClick={() => setTab('projects')}><BriefcaseBusiness size={14} /> Projects <span>{projects.length}</span></button>
          <button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}><Users size={14} /> People <span>{people.length}</span></button>
        </div>
        {tab === 'projects' && (
          <div className="filters">
            <label className="select-control"><Filter size={13} />
              <select value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="Filter by domain">
                <option>All domains</option><option>Developer tools</option><option>Education</option><option>Climate tech</option><option>Research</option><option>Design systems</option>
              </select><ChevronDown size={13} />
            </label>
            <button className="sort-btn" onClick={() => setSort(sort === 'Trending' ? 'Alphabetical' : 'Trending')}><SlidersHorizontal size={13} /> {sort} <ChevronDown size={13} /></button>
          </div>
        )}
      </div>

      {tab === 'projects' ? (
        <>
          <div className="section-head"><div><h2>Projects with momentum <span>{filteredProjects.length}</span></h2><p>Find a project that fits your curiosity — or the skills you want to grow.</p></div></div>
          <div className="project-grid">
            {filteredProjects.map((p, i) => (
              <article className="project-card discover-card" key={p.id} style={{ cursor: 'default' }}>
                <div className="project-top">
                  <span className={`project-avatar ${tone(p.tone)}`}>{p.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</span>
                  <span className="top-right">
                    <span className="trend"><Zap size={10} /> Trending</span>
                    <button className={`save-btn ${saved.includes(p.id) ? 'saved' : ''}`} onClick={() => toggle(saved, setSaved, p.id)} title="Save project" aria-label="Save project"><Bookmark size={14} fill={saved.includes(p.id) ? 'currentColor' : 'none'} /></button>
                  </span>
                </div>
                <div className="title-row"><h3>{p.name}</h3><span className="domain-chip">{p.domain}</span></div>
                <p>{p.description}</p>
                <div className="tags">{p.tags.map((t) => <span key={t}>{t}</span>)}</div>
                <div className="card-meta"><span><Users size={12} />{p.contributors} contributors</span><span className="creator"><Avatar initials={p.initials} tone={AVATAR_TONES[i % 4]} small /><span>{p.creator}</span></span></div>
                <div className="metric"><span>Progress</span><b>{p.progress}%</b></div>
                <div className="progress"><i className={tone(p.tone)} style={{ width: `${p.progress}%` }} /></div>
                <div className="project-foot"><small>{p.trending}% trending score</small><button className="open-link" onClick={() => navigate(`/project/${p.id}`)}>View project <ArrowUpRight size={13} /></button></div>
              </article>
            ))}
          </div>
          {filteredProjects.length === 0 && <EmptyPanel icon={Search} title="Nothing in this orbit yet" text="No projects found. Try a different search or domain." onReset={() => { setQuery(''); setDomain('All domains'); }} />}
        </>
      ) : (
        <>
          <div className="section-head"><div><h2>Meet your next collaborator <span>{filteredPeople.length}</span></h2><p>Find people by the things they know and the things they love to build.</p></div><span className="match-note"><Sparkles size={13} /> Skill-based discovery</span></div>
          <div className="people-grid">
            {filteredPeople.map((p) => (
              <article className="panel person" key={p.handle}>
                <div className="person-head">
                  <Avatar initials={p.initials} tone={p.tone === 'orange' ? 'orange' : p.tone} large />
                  <Btn className={`small ${followed.includes(p.handle) ? 'following' : ''}`} secondary onClick={() => toggle(followed, setFollowed, p.handle)} icon={followed.includes(p.handle) ? Check : UserPlus}>{followed.includes(p.handle) ? 'Following' : 'Follow'}</Btn>
                </div>
                <h3 className="person-id">{p.name} <BadgeCheck size={15} /></h3>
                <p className="handle">{p.handle}</p>
                <p className="role">{p.role}</p>
                <p className="bio">{p.bio}</p>
                <p className="place"><MapPin size={12} /> {p.location}</p>
                <div className="skill-cloud">{p.skills.map((s) => <span key={s}>{s}</span>)}</div>
                <div className="person-foot"><span><BriefcaseBusiness size={13} />{p.projects} projects</span><span><Users size={13} />{p.followers + (followed.includes(p.handle) ? 1 : 0)} followers</span></div>
                <Btn secondary className="full" onClick={() => navigate('/profile')}>View profile <ArrowUpRight size={14} /></Btn>
              </article>
            ))}
          </div>
          {filteredPeople.length === 0 && <EmptyPanel icon={Search} title="Nothing in this orbit yet" text="No people match that search yet." onReset={() => setQuery('')} resetLabel="Clear search" />}
        </>
      )}

      <div className="bottom-cta"><Sparkles size={19} /><div><b>Have something worth building?</b><small>Start a project, invite people who care, and make it real.</small></div><Btn secondary onClick={() => navigate('/dashboard')}>Go to workspace <ArrowRight size={14} /></Btn></div>
    </>
  );
}

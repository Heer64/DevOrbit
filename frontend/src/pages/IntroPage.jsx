import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bell, Columns3, FileText, Flame, GitBranch, GitPullRequest, Globe2, MessagesSquare, Moon, Plus, Reply, Search, ShieldCheck, Sparkles, Sun, UserRound, Users } from 'lucide-react';
import Logo, { OrbitGlass } from '../components/Logo';
import Logo3D from '../components/Logo3D';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

/*
 * Solar Ember intro page (/welcome): a scroll story that introduces DevOrbit before sign-in.
 * Kinetic headline + live 3D logo, a tech-stack marquee, a paragraph whose words light up
 * as you scroll (and dim again going back up), a sticky product story, a bento grid of
 * features, a pinned sideways "how it works" track, FAQ and a final call to action.
 * Frontend only: it describes features that already exist and calls no API.
 */
const STEPS = [
  { title: 'Plan on a board that moves live', text: 'Drag a card and every teammate sees it move. Due dates, labels and milestones keep the week honest.' },
  { title: 'Talk where the work is', text: 'Channels, threads with reply counts and @mentions that notify the right person. Record decisions so nobody asks twice.' },
  { title: 'See the code without leaving', text: 'Connect one GitHub repository. Pushes, issues and pull requests land in your activity feed through a signed webhook.' },
  { title: 'Get caught up in seconds', text: 'Back after a weekend? Copilot summarises what changed since your last visit and links every line to its source.' },
];
const FEATURES = [
  { cls: 'w2', icon: Columns3, title: 'Kanban with realtime sync', text: 'Columns, drag and drop, and live updates for everyone on the project.', bars: true },
  { icon: Sparkles, title: 'Copilot that cites', text: 'Answers only from your project data, with links to each source.' },
  { cls: 'h2', icon: ShieldCheck, title: 'Safe by default', text: 'Roles from Owner to Viewer, privacy settings, a moderator queue, and GitHub tokens that never reach the browser.', roles: true },
  { icon: MessagesSquare, title: 'Chat and DMs', text: 'Project channels, threads and direct messages.' },
  { icon: FileText, title: 'Docs and files', text: 'Markdown pages and uploads up to 10 MB.' },
  { icon: UserRound, title: 'Portfolio in one click', text: 'Your projects and shipped work become a shareable page.' },
  { cls: 'w2', icon: Globe2, title: 'A public side, too', text: 'Discover open projects, request to join, post updates, vote, follow builders and find collaborators by skill.', skills: true },
  { icon: Search, title: 'Find anything', text: 'Search people and projects from the top bar.' },
  { icon: Bell, title: 'Notifications that matter', text: 'Assignments, @mentions, deadlines and join requests, live.' },
];
const FLOW = [
  ['Create a project', 'Name it, pick a domain from the agreed list and choose public or private.'],
  ['Bring the team', 'Invite by email with a role. Invitations expire after 7 days.'],
  ['Plan the work', 'Milestones, tasks, labels and due dates, on a list or a board.'],
  ['Connect GitHub', 'Authorize, pick one repository and watch events arrive.'],
  ['Ship and show it', 'Mark the project complete and share your generated portfolio.'],
];
const FAQ = [
  ['Who is DevOrbit for?', 'Student and indie teams who want one place for tasks, conversations, code activity and decisions.'],
  ['Do I need an account to look around?', 'No. Discover public projects and shared portfolios without signing in. Create an account when you want to join or start a project.'],
  ['Does Copilot make things up?', 'Copilot answers only from your project data and links each line to its source. When the data does not cover a question, it says so.'],
  ['Can I keep a project private?', 'Yes. Private projects are visible to members only, and every member has a role from Owner to Viewer.'],
];
const STACK = ['React', 'Vite', 'Node.js', 'Express', 'MongoDB', 'Socket.io', 'Vitest', 'Playwright', 'GitHub Actions'];
const MANIFESTO = 'DevOrbit pulls your tasks, conversations, code and decisions into one orbit, so the whole team always knows what happened, what matters and what comes next.';

function StoryVisual({ index }) {
  if (index === 0) return (
    <div className="intro-mini-board">
      {[['To do', ['Light theme tokens', 'Empty states']], ['In progress', ['Env secrets']], ['Done', ['Password reset', 'Round avatars']]].map(([name, cards]) => (
        <div key={name}><small><i className="intro-dot" />{name}</small>{cards.map((c) => <div key={c} className="intro-mini">{c}</div>)}</div>
      ))}
    </div>
  );
  if (index === 1) return (
    <div className="intro-mini-chat">
      <div className="intro-mini"><b>Arjun</b> PR for the touch drag fix is up. <span className="mention">@Riya</span> can you review?</div>
      <div className="intro-mini"><b>Riya</b> On it. Recording the decision too.</div>
      <div className="intro-mini muted-row"><Reply size={14} /> 2 replies in thread</div>
    </div>
  );
  if (index === 2) return (
    <div className="intro-mini-chat">
      <div className="intro-mini"><GitPullRequest size={15} /> PR #42 "Password reset flow" merged</div>
      <div className="intro-mini"><GitBranch size={15} /> 3 commits pushed to main</div>
      <div className="intro-mini"><Flame size={15} /> Issue #57 opened</div>
    </div>
  );
  return (
    <div className="intro-mini-chat">
      <div className="intro-mini"><b>DevOrbit Core:</b> 3 tasks completed, PR #42 merged, 1 decision recorded.</div>
      <div className="intro-mini"><b>Due this week:</b> Env secrets (today), Light theme tokens (Thu).</div>
    </div>
  );
}

export default function IntroPage() {
  const { user } = useAuth();
  const { dark, toggle } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState(0);
  const scrubRef = useRef(null);
  const flowRef = useRef(null);
  const trackRef = useRef(null);

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const vh = window.innerHeight;
        setScrolled(window.scrollY > 24);
        const scrub = scrubRef.current;
        if (scrub) {
          const r = scrub.getBoundingClientRect();
          const k = Math.max(0, Math.min(1, (vh * 0.85 - r.top) / (r.height + vh * 0.35)));
          const words = scrub.querySelectorAll('.w');
          const on = Math.round(k * words.length);
          words.forEach((w, i) => w.classList.toggle('on', i < on));
        }
        const steps = document.querySelectorAll('.intro-step');
        let best = 0; let bestD = Infinity;
        steps.forEach((s, i) => { const r = s.getBoundingClientRect(); const d = Math.abs(r.top + r.height / 2 - vh / 2); if (d < bestD) { bestD = d; best = i; } });
        setActive(best);
        const flow = flowRef.current; const track = trackRef.current;
        if (flow && track) {
          if (window.innerWidth > 900) {
            const r = flow.getBoundingClientRect();
            const k = Math.max(0, Math.min(1, -r.top / Math.max(1, flow.offsetHeight - vh)));
            track.style.transform = `translateX(${-k * Math.max(0, track.scrollWidth - window.innerWidth)}px)`;
          } else track.style.transform = '';
        }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, []);

  const goTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const primary = user
    ? <Link to="/dashboard" className="btn xl">Open your dashboard <ArrowRight size={18} /></Link>
    : <Link to="/signup" className="btn xl">Get started <ArrowRight size={18} /></Link>;

  return (
    <div className="intro">
      <header className={`intro-nav ${scrolled ? 'scrolled' : ''}`}>
        <Link to="/welcome" aria-label="DevOrbit intro" style={{ color: 'inherit', textDecoration: 'none' }}><Logo /></Link>
        <nav aria-label="Sections" className="intro-links">
          <button type="button" onClick={() => goTo('intro-story')}>Product</button>
          <button type="button" onClick={() => goTo('intro-features')}>Features</button>
          <button type="button" onClick={() => goTo('intro-flow')}>How it works</button>
          <button type="button" onClick={() => goTo('intro-faq')}>FAQ</button>
        </nav>
        <span className="intro-spacer" />
        <button className="iconbtn" onClick={toggle} aria-label="Toggle theme">{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
        {user ? <Link to="/dashboard" className="btn small">Open dashboard</Link> : <><Link to="/login" className="btn secondary small">Log in</Link><Link to="/signup" className="btn small">Sign up</Link></>}
      </header>

      <section className="intro-sec intro-hero" aria-label="Introduction">
        <div className="intro-hero-copy">
          <span className="intro-pill"><i /> Copilot catches you up</span>
          <h1>
            {"Your team's work,".split(' ').map((w, i) => <span key={w}><span className="kin"><span style={{ animationDelay: `${100 + i * 70}ms` }}>{w}</span></span>{' '}</span>)}
            <br /><span className="kin"><span style={{ animationDelay: '320ms' }}>in</span></span>{' '}
            <span className="kin"><span className="ember-text" style={{ animationDelay: '390ms' }}>one orbit.</span></span>
          </h1>
          <p className="intro-lede">Plan on a live board, talk in threads, watch GitHub activity and let Copilot catch you up. Built for student and indie teams who ship together.</p>
          <div className="intro-actions">{primary}<Link to="/discover" className="btn secondary xl">Explore public projects</Link></div>
          <p className="intro-proof"><Users size={16} /> Built by a 10-person student team across 6 sprints</p>
        </div>
        <div className="intro-hero-logo"><div className="intro-halo" aria-hidden="true" /><Logo3D size={460} scrollTurn /></div>
        <div className="intro-cue" aria-hidden="true"><span />Scroll</div>
      </section>

      <div className="intro-marquee" aria-label="Built with"><div className="intro-track">{[...STACK, ...STACK].map((t, i) => <span key={`${t}-${i}`}><Sparkles size={15} /> {t}</span>)}</div></div>

      <section className="intro-sec" aria-label="What DevOrbit is">
        <p className="intro-scrub" ref={scrubRef}>{MANIFESTO.split(' ').map((w, i) => <span className="w" key={i}>{w} </span>)}</p>
      </section>

      <section className="intro-sec" id="intro-story" aria-labelledby="intro-story-h">
        <div className="intro-head" data-reveal><small>The product</small><h2 id="intro-story-h">One workspace for every moment of a project.</h2></div>
        <div className="intro-story">
          <div className="intro-sticky"><div className="intro-screen glass">{STEPS.map((s, i) => <div key={s.title} className={`intro-vis ${active === i ? 'on' : ''}`}><StoryVisual index={i} /></div>)}</div></div>
          <div>{STEPS.map((s, i) => (
            <article key={s.title} className={`intro-step ${active === i ? 'on' : ''}`}>
              <small>0{i + 1} / 04</small><h3>{s.title}</h3><p>{s.text}</p>
              <div className="intro-screen intro-screen-m glass"><div className="intro-vis on"><StoryVisual index={i} /></div></div>
            </article>
          ))}</div>
        </div>
      </section>

      <section className="intro-sec" id="intro-features" aria-labelledby="intro-feat-h">
        <div className="intro-head" data-reveal><small>Features</small><h2 id="intro-feat-h">Everything in one bento box.</h2></div>
        <div className="intro-bento">{FEATURES.map(({ cls = '', icon: Icon, title, text, bars, roles, skills }) => (
          <article key={title} className={`intro-card glass ${cls}`} data-reveal>
            <span className="intro-ic"><Icon size={22} /></span><h3>{title}</h3><p>{text}</p>
            {bars && <div className="intro-bars">{[30, 55, 75, 100].map((w, i) => <div key={w}><small>{['To do', 'Doing', 'Review', 'Done'][i]}</small><span className="progress"><i style={{ width: `${w}%` }} /></span></div>)}</div>}
            {roles && <div className="intro-roles">{['Owner', 'Admin', 'Contributor', 'Viewer'].map((r) => <span key={r}>{r}</span>)}</div>}
            {skills && <div className="skill-cloud">{['React', 'Node.js', 'MongoDB', 'UI design', 'Testing'].map((s) => <span key={s}>{s}</span>)}</div>}
          </article>
        ))}</div>
      </section>

      <section className="intro-flow" id="intro-flow" ref={flowRef} aria-labelledby="intro-flow-h">
        <div className="intro-pin">
          <div className="intro-head intro-sec-inner"><small>How it works</small><h2 id="intro-flow-h">From idea to shipped, in five moves.</h2></div>
          <div className="intro-htrack" ref={trackRef}>{FLOW.map(([t, d], i) => <article key={t} className="intro-hcard glass"><span className="intro-num">0{i + 1}</span><h3>{t}</h3><p>{d}</p></article>)}</div>
        </div>
      </section>

      <section className="intro-sec" id="intro-faq" aria-labelledby="intro-faq-h">
        <div className="intro-head" data-reveal><small>FAQ</small><h2 id="intro-faq-h">Questions, answered.</h2></div>
        <div className="intro-faq">{FAQ.map(([q, a]) => <details key={q} className="glass" data-reveal><summary>{q}<Plus size={20} /></summary><p>{a}</p></details>)}</div>
      </section>

      <section className="intro-sec" aria-label="Get started">
        <div className="intro-cta glass" data-reveal>
          <OrbitGlass size={170} />
          <h2>Bring your team into orbit.</h2>
          <p className="intro-lede">Create a project, invite your team and keep every update in one place.</p>
          <div className="intro-actions" style={{ justifyContent: 'center' }}>{primary}{!user && <Link to="/login" className="btn secondary xl">Log in</Link>}</div>
        </div>
      </section>

      <footer className="intro-foot"><Logo /><span>Build together. Stay in context.</span><button type="button" className="link" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Back to top</button></footer>
    </div>
  );
}

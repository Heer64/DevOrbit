import { Link } from 'react-router-dom';
import { CheckCircle2, Lock, MessageSquare, Scale } from 'lucide-react';
import { timeAgo } from './activityDisplay';

/*
 * [Sprint 5 · M5] US-49: how a portfolio looks. Used by the shared page (/portfolio/:username)
 * and the "My portfolio" panel on the Profile page. It only shows what the API sends:
 *   projects[]: { _id?, name, description, domain, tags, role, completedAt, isPrivate,
 *                 stats { tasksCompleted, decisionsRecorded, messagesPosted, computedAt } }
 * In the owner view each project links to its workspace (_id is only sent to the owner).
 * Reusable by M3 (US-06 other user's profile): <PortfolioView portfolio={data} />.
 */

export function formatCompletedDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const count = (value, one, many) => `${value} ${value === 1 ? one : many}`;

// "3 tasks completed · 1 decision recorded · 5 messages posted"
export function statsLine(stats = {}) {
  return [
    count(stats.tasksCompleted || 0, 'task completed', 'tasks completed'),
    count(stats.decisionsRecorded || 0, 'decision recorded', 'decisions recorded'),
    count(stats.messagesPosted || 0, 'message posted', 'messages posted'),
  ].join(' · ');
}

function Stat({ icon: Icon, value, label }) {
  return (
    <div className="portfolio-stat">
      <Icon size={14} aria-hidden="true" />
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}

function ProjectCard({ project, linkProjects }) {
  const stats = project.stats || {};
  const title = linkProjects && project._id
    ? <Link to={`/project/${encodeURIComponent(project._id)}`}>{project.name}</Link>
    : project.name;
  const completed = formatCompletedDate(project.completedAt);
  return (
    <li className="portfolio-project">
      <div className="portfolio-project-head">
        <div>
          <h3>{project.isPrivate && <Lock size={13} aria-label="Private project" />} {title}</h3>
          <p className="portfolio-meta">
            <span className="pill purple">{project.role}</span>
            {project.domain && <span className="pill">{project.domain}</span>}
            {completed && <span>Completed {completed}</span>}
          </p>
        </div>
      </div>
      {project.description && <p className="portfolio-description">{project.description}</p>}
      <div className="portfolio-stats" aria-label={`My contribution to ${project.name}: ${statsLine(stats)}`}>
        <Stat icon={CheckCircle2} value={stats.tasksCompleted || 0} label="Tasks completed" />
        <Stat icon={Scale} value={stats.decisionsRecorded || 0} label="Decisions recorded" />
        <Stat icon={MessageSquare} value={stats.messagesPosted || 0} label="Messages posted" />
      </div>
    </li>
  );
}

export default function PortfolioView({ portfolio, linkProjects = false, emptyText = 'No completed projects yet.', now = Date.now() }) {
  const projects = portfolio?.projects || [];
  const totals = portfolio?.totals || { projects: 0, tasksCompleted: 0, decisionsRecorded: 0, messagesPosted: 0 };
  if (!projects.length) return <p className="empty-inline">{emptyText}</p>;
  const updated = portfolio.statsUpdatedAt ? timeAgo(portfolio.statsUpdatedAt, now) : '';
  return (
    <div className="portfolio">
      <div className="portfolio-totals" aria-label="Portfolio totals">
        <Stat icon={CheckCircle2} value={totals.projects} label={totals.projects === 1 ? 'Completed project' : 'Completed projects'} />
        <Stat icon={CheckCircle2} value={totals.tasksCompleted} label="Tasks completed" />
        <Stat icon={Scale} value={totals.decisionsRecorded} label="Decisions recorded" />
        <Stat icon={MessageSquare} value={totals.messagesPosted} label="Messages posted" />
      </div>
      <ul className="portfolio-projects">
        {projects.map((project, index) => <ProjectCard key={project._id || `${project.name}-${index}`} project={project} linkProjects={linkProjects} />)}
      </ul>
      {updated && <p className="tiny-note portfolio-updated">Contribution numbers updated {updated} (refreshed at least once a day).</p>}
    </div>
  );
}

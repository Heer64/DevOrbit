import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, ExternalLink, Lock } from 'lucide-react';
import { portfolioApi } from '../api';
import { Btn } from './ui';
import PortfolioView from './PortfolioView';

/*
 * [Sprint 5 · M5] US-49: "My portfolio" on the Profile page.
 * Shows my Completed projects with my role and numbers (AC1, AC2), and the share link (AC3).
 * The link works for anyone only while my portfolio is public (User.portfolioPublic,
 * set in privacy settings: Sprint 5 · M3, US-07). When it is private the link says "not available".
 */

export function shareUrl(sharePath, origin = typeof window !== 'undefined' ? window.location.origin : '') {
  return `${origin}${sharePath || ''}`;
}

export default function MyPortfolioPanel({ api = portfolioApi, copyText = (text) => navigator.clipboard.writeText(text) }) {
  const [portfolio, setPortfolio] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    let active = true;
    api.mine()
      .then((data) => { if (active) setPortfolio(data); })
      .catch((e) => { if (active) setError(e?.message || 'Could not load your portfolio.'); });
    return () => { active = false; };
  }, [api]);

  const link = portfolio ? shareUrl(portfolio.sharePath) : '';

  const copy = async () => {
    setCopied('');
    try {
      await copyText(link);
      setCopied('Link copied.');
    } catch {
      setCopied('Could not copy automatically. Select the link and copy it.');
    }
  };

  return (
    <section className="panel my-portfolio" aria-label="My portfolio">
      <div className="panel-head">
        <div><div className="eyebrow">PORTFOLIO</div><h2 style={{ marginTop: 6 }}>My portfolio</h2><p>Projects marked Completed, with your role and contributions.</p></div>
        {portfolio && <span className={`pill ${portfolio.isPublic ? 'green' : ''}`}>{portfolio.isPublic ? 'Public' : 'Private'}</span>}
      </div>

      {!portfolio && !error && <p className="team-note">Loading your portfolio…</p>}
      {error && <div className="form-error" role="alert">{error}</div>}

      {portfolio && (
        <>
          {portfolio.isPublic ? (
            <div className="portfolio-share">
              <input className="field-input" readOnly value={link} aria-label="Portfolio link" onFocus={(e) => e.target.select()} />
              <Btn secondary icon={Copy} onClick={copy}>Copy link</Btn>
              <Link className="btn secondary" to={portfolio.sharePath} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open</Link>
            </div>
          ) : (
            <p className="team-note"><Lock size={12} /> Your portfolio is private. Anyone opening its link sees &ldquo;This portfolio is not available.&rdquo;</p>
          )}
          {copied && <p className="tiny-note" role="status">{copied}</p>}
          <PortfolioView portfolio={portfolio} linkProjects emptyText="No completed projects yet. When a project you belong to is marked Completed, it appears here." />
        </>
      )}
    </section>
  );
}

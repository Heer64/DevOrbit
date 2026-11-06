import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { portfolioApi, assetUrl } from '../api';
import { Avatar, initialsOf } from '../components/ui';
import PortfolioView from '../components/PortfolioView';

/*
 * [Sprint 5 · M5] US-49 AC3: the shareable, read-only portfolio at /portfolio/:username.
 * Opens without logging in (PublicShell) and inside the app for logged-in users (AppShell).
 * When the owner turned their portfolio off, or the user does not exist, it says
 * "This portfolio is not available." and shows nothing else.
 */
export default function PortfolioPage({ api = portfolioApi }) {
  const { username } = useParams();
  const [state, setState] = useState({ loading: true, portfolio: null, error: '' });

  useEffect(() => {
    let active = true;
    setState({ loading: true, portfolio: null, error: '' });
    api.shared(username)
      .then((portfolio) => { if (active) setState({ loading: false, portfolio, error: '' }); })
      .catch((error) => {
        if (!active) return;
        const message = error?.status === 404 ? 'This portfolio is not available.' : error?.message || 'Could not load this portfolio.';
        setState({ loading: false, portfolio: null, error: message });
      });
    return () => { active = false; };
  }, [api, username]);

  if (state.loading) return <section className="panel"><p className="team-note">Loading portfolio…</p></section>;
  if (state.error) {
    return (
      <section className="panel portfolio-unavailable">
        <div className="eyebrow">PORTFOLIO</div>
        <h2 role="alert">{state.error}</h2>
        <p className="team-note">The owner may have made it private, or the link may be wrong.</p>
      </section>
    );
  }

  const owner = state.portfolio.user || {};
  return (
    <>
      <section className="panel portfolio-header">
        <Avatar initials={initialsOf(owner.name)} src={assetUrl(owner.avatarUrl)} large />
        <div>
          <div className="eyebrow">PORTFOLIO</div>
          <h1>{owner.name}</h1>
          <p className="team-note">@{owner.username}{owner.headline ? ` · ${owner.headline}` : ''}</p>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>Completed projects</h2><p>Roles and contributions in projects marked Completed.</p></div></div>
        <PortfolioView portfolio={state.portfolio} emptyText={`${owner.name || 'This person'} has no completed projects yet.`} />
      </section>
    </>
  );
}

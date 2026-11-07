import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Award, Lock, Users } from 'lucide-react';
import { assetUrl, portfolioApi, profileApi } from '../api';
import { Avatar, initialsOf } from '../components/ui';
import PortfolioView from '../components/PortfolioView';

/*
 * [Sprint 5 · M3] US-06 View another user's profile, read-only, at /people/:username (login required).
 * Shows photo, bio, skill tags, follower count and public score (AC1). Only what the API sends is
 * shown, and the API never sends hidden fields (AC2). The portfolio (Sprint 5 · M5) is shown when it
 * is public; when its owner turned it off (US-07) the page says "This portfolio is not available."
 * Contract: GET /api/profile/users/:username (backend/src/routes/profile.js).
 */

export const PORTFOLIO_NOT_AVAILABLE = 'This portfolio is not available.';

export default function UserProfilePage({ api = profileApi, portfolios = portfolioApi }) {
  const { username } = useParams();
  const [state, setState] = useState({ loading: true, profile: null, error: '' });
  const [portfolio, setPortfolio] = useState({ loading: false, data: null, error: '' });

  useEffect(() => {
    let active = true;
    setState({ loading: true, profile: null, error: '' });
    setPortfolio({ loading: false, data: null, error: '' });
    api.user(username)
      .then((result) => {
        if (!active) return;
        const profile = result.profile;
        setState({ loading: false, profile, error: '' });
        if (!profile?.portfolio?.available) return;
        setPortfolio({ loading: true, data: null, error: '' });
        portfolios.shared(profile.username)
          .then((data) => { if (active) setPortfolio({ loading: false, data, error: '' }); })
          .catch((error) => {
            if (!active) return;
            const message = error?.status === 404 ? PORTFOLIO_NOT_AVAILABLE : error?.message || 'Could not load this portfolio.';
            setPortfolio({ loading: false, data: null, error: message });
          });
      })
      .catch((error) => {
        if (!active) return;
        const message = error?.status === 404 ? 'This profile does not exist.' : error?.message || 'Could not load this profile.';
        setState({ loading: false, profile: null, error: message });
      });
    return () => { active = false; };
  }, [api, portfolios, username]);

  if (state.loading) return <section className="panel"><p className="team-note">Loading profile…</p></section>;
  if (state.error) {
    return (
      <section className="panel portfolio-unavailable">
        <div className="eyebrow">PROFILE</div>
        <h2 role="alert">{state.error}</h2>
        <p className="team-note">Check the username and try again.</p>
      </section>
    );
  }

  const { profile } = state;
  const portfolioOff = !profile.portfolio?.available || portfolio.error === PORTFOLIO_NOT_AVAILABLE;

  return (
    <>
      <section className="profile-hero panel user-profile" aria-label={`Profile of ${profile.name}`}>
        <div className="cover"><div /><div /></div>
        <div className="profile-main">
          <Avatar initials={initialsOf(profile.name)} src={assetUrl(profile.avatarUrl)} large />
          <div className="identity">
            <h1 className="user-profile-name">{profile.name}</h1>
            <p>@{profile.username}{profile.headline ? ` · ${profile.headline}` : ''}</p>
            <p className="bio">{profile.bio || `${profile.name} has not added a bio yet.`}</p>
            {profile.isMe && <p className="tiny-note">This is how other people see your profile. <Link to="/profile">Edit your profile</Link></p>}
          </div>
          <div className="profile-stats" aria-label="Public stats">
            <b>{profile.followerCount}<small><Users size={9} /> {profile.followerCount === 1 ? 'Follower' : 'Followers'}</small></b>
            <b>{profile.publicScore}<small><Award size={9} /> Score</small></b>
          </div>
        </div>
      </section>

      <div className="profile-columns">
        <div className="stack-col">
          <section className="panel">
            <div className="panel-head"><div><h2>Skills &amp; tools</h2><p>Skill tags on {profile.name}&rsquo;s profile.</p></div></div>
            <div className="skill-cloud">{profile.skills.length ? profile.skills.map((s) => <span key={s}>{s}</span>) : <small className="muted">No skills listed yet.</small>}</div>
          </section>
        </div>

        <div className="stack-col">
          <section className="panel" aria-label="Portfolio">
            <div className="panel-head"><div><div className="eyebrow">PORTFOLIO</div><h2 style={{ marginTop: 6 }}>Completed projects</h2><p>Roles and contributions in projects marked Completed.</p></div></div>
            {portfolioOff ? (
              <p className="team-note portfolio-off"><Lock size={12} /> {PORTFOLIO_NOT_AVAILABLE}</p>
            ) : portfolio.loading ? (
              <p className="team-note">Loading portfolio…</p>
            ) : portfolio.error ? (
              <div className="form-error" role="alert">{portfolio.error}</div>
            ) : (
              <>
                <PortfolioView portfolio={portfolio.data} emptyText={`${profile.name} has no completed projects yet.`} />
                <Link className="link" to={profile.portfolio.path}>Open shareable portfolio</Link>
              </>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

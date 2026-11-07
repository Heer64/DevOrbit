/*
 * [Sprint 5 · M3] US-06 / US-07 rules that need no database (tested in test/userProfileRules.test.js).
 * lib/userProfile.js and routes/profile.js use them.
 */

export const USER_NOT_FOUND_MESSAGE = 'User not found.';
export const PRIVACY_SETTING_MESSAGE = 'Privacy settings must be true or false.';

// US-07: the two privacy switches a user controls.
//   profileDiscoverable  "Appear in collaborator search" (GET /api/profile/people)
//   portfolioPublic      "Public portfolio" (/portfolio/:username, Sprint 5 · M5)
export const PRIVACY_SETTINGS = ['profileDiscoverable', 'portfolioPublic'];

// The only User fields read for another user's profile. Email, password, login counters and the
// search switch are never loaded, so they cannot leak by mistake.
export const PROFILE_FIELDS = 'name username headline bio avatarUrl skills portfolioPublic';

// NFR-21: a privacy switch must be a real true/false, not "yes", 1 or null.
// Returns the name of the first bad setting in the request body, or null when all are fine.
export function badPrivacySetting(body = {}) {
  return PRIVACY_SETTINGS.find((field) => body[field] !== undefined && typeof body[field] !== 'boolean') || null;
}

export function portfolioPathOf(username) {
  return `/portfolio/${encodeURIComponent(username)}`;
}

const count = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};

/*
 * US-06: what another logged-in user sees. Built from an allow-list, so a field is only sent when
 * it is named here. A portfolio that was turned off (US-07) is never linked; the page shows
 * "not available" instead.
 */
export function profileView(user, { followerCount = 0, publicScore = 0 } = {}, viewerId = null) {
  const portfolioAvailable = user.portfolioPublic !== false;
  return {
    name: user.name,
    username: user.username,
    headline: user.headline || '',
    bio: user.bio || '',
    avatarUrl: user.avatarUrl || '',
    skills: Array.isArray(user.skills) ? user.skills : [],
    followerCount: count(followerCount),
    publicScore: Number.isFinite(Number(publicScore)) ? Math.trunc(Number(publicScore)) : 0,
    portfolio: {
      available: portfolioAvailable,
      path: portfolioAvailable ? portfolioPathOf(user.username) : null,
    },
    isMe: viewerId !== null && String(user._id) === String(viewerId),
  };
}

/*
 * [Sprint 1 · gaps] Create-project rules (US-08, US-09, Sprint 1 plan line E):
 * "Create-project form with name, description, domain from an agreed fixed list, visibility,
 *  optional starting members/roles."
 *
 * Pure rules, no Express or Mongoose, so they are unit tested on their own
 * (backend/test/projectSetup.test.js).
 */
import { ASSIGNABLE_ROLES } from './permissions.js';

/*
 * The agreed domain list. The create-project dropdown shows exactly these, in this order
 * (frontend/src/domains.js holds the same list; keep the two in sync).
 */
export const PROJECT_DOMAINS = [
  'Developer tools',
  'Education',
  'Climate tech',
  'Research',
  'Design systems',
  'Backend',
  'Community',
  'Other',
];

// Used when a request leaves the domain out.
export const DEFAULT_DOMAIN = 'Other';

export const DOMAIN_MESSAGE = `Domain must be one of: ${PROJECT_DOMAINS.join(', ')}.`;

/*
 * Reads the domain sent by the client. Matching ignores letter case and extra spaces, and the
 * stored value is always the spelling from the list ("  climate TECH " -> "Climate tech").
 * Returns { ok: true, value } or { ok: false, message }.
 */
export function readDomain(raw, { required = false } = {}) {
  if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) {
    return required ? { ok: false, message: DOMAIN_MESSAGE } : { ok: true, value: DEFAULT_DOMAIN };
  }
  if (typeof raw !== 'string') return { ok: false, message: DOMAIN_MESSAGE };
  const wanted = raw.replace(/\s+/g, ' ').trim().toLowerCase();
  const match = PROJECT_DOMAINS.find((domain) => domain.toLowerCase() === wanted);
  return match ? { ok: true, value: match } : { ok: false, message: DOMAIN_MESSAGE };
}

// The project's tags start with its domain, except for the catch-all ones.
export function domainTags(domain) {
  return domain && domain !== 'Other' && domain !== 'General' ? [domain] : [];
}

/*
 * Optional starting members, sent with the new project as
 *   members: [{ identifier: 'riya@example.com' | 'riya' | '@riya', role?: 'Admin' | 'Contributor' | 'Viewer' }]
 * The creator is the Owner, so the same roles as "add a member" (US-09) are allowed. "Owner" is not.
 */
export const MAX_STARTING_MEMBERS = 20;
export const STARTING_MEMBER_DEFAULT_ROLE = 'Contributor';

export function normalizeIdentifier(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');
}

/*
 * Checks the shape of the list only (no database). Returns
 *   { ok: true, members: [{ identifier, role }] }   identifiers normalized, in the order sent
 *   { ok: false, message }
 */
export function readStartingMembers(raw) {
  if (raw === undefined || raw === null) return { ok: true, members: [] };
  if (!Array.isArray(raw)) return { ok: false, message: 'Starting members must be a list.' };
  if (raw.length > MAX_STARTING_MEMBERS) {
    return { ok: false, message: `You can add at most ${MAX_STARTING_MEMBERS} starting members. Invite more people later.` };
  }
  const members = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, message: 'Each starting member needs an email or username and a role.' };
    }
    const identifier = normalizeIdentifier(item.identifier);
    if (!identifier) return { ok: false, message: 'Enter the email or username of each starting member.' };
    if (identifier.length > 254) return { ok: false, message: 'An email or username is too long.' };
    const role = item.role === undefined || item.role === '' ? STARTING_MEMBER_DEFAULT_ROLE : item.role;
    if (role === 'Owner') {
      return { ok: false, message: 'A project has one Owner: you. Choose Admin, Contributor or Viewer.' };
    }
    if (!ASSIGNABLE_ROLES.includes(role)) {
      return { ok: false, message: `Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}.` };
    }
    if (seen.has(identifier)) return { ok: false, message: `"${identifier}" is listed more than once.` };
    seen.add(identifier);
    members.push({ identifier, role });
  }
  return { ok: true, members };
}

// Mongo filter that finds every listed person in one query.
export function startingMemberLookup(members) {
  const emails = members.filter((m) => m.identifier.includes('@')).map((m) => m.identifier);
  const usernames = members.filter((m) => !m.identifier.includes('@')).map((m) => m.identifier);
  const or = [];
  if (emails.length) or.push({ email: { $in: emails } });
  if (usernames.length) or.push({ username: { $in: usernames } });
  return or.length ? { $or: or } : null;
}

/*
 * Pairs each listed identifier with the user found for it. users: [{ _id, email, username, name }].
 * Returns { ok: true, resolved: [{ user, role }] } or { ok: false, status, message }.
 * Unknown people, the creator themself, and two entries that are the same person are refused,
 * so the project is only created when the whole list is valid.
 */
export function matchStartingMembers(members, users, creatorId) {
  const byEmail = new Map(users.map((u) => [String(u.email || '').toLowerCase(), u]));
  const byUsername = new Map(users.map((u) => [String(u.username || '').toLowerCase(), u]));
  const resolved = [];
  const seenIds = new Set();
  const unknown = [];
  for (const member of members) {
    const user = member.identifier.includes('@') ? byEmail.get(member.identifier) : byUsername.get(member.identifier);
    if (!user) {
      unknown.push(member.identifier);
      continue;
    }
    const id = String(user._id);
    if (id === String(creatorId)) {
      return { ok: false, status: 400, message: 'You are the Owner already. Remove yourself from the starting members.' };
    }
    if (seenIds.has(id)) {
      return { ok: false, status: 400, message: `${user.name || member.identifier} is listed more than once.` };
    }
    seenIds.add(id);
    resolved.push({ user, role: member.role });
  }
  if (unknown.length) {
    return {
      ok: false,
      status: 404,
      message: `No DevOrbit user matches: ${unknown.join(', ')}. Check the email or username. Nothing was created.`,
      unknown,
    };
  }
  return { ok: true, resolved };
}

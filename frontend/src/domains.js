// [Sprint 1 · gaps] The agreed project domains, in dropdown order.
// The API only accepts these (backend/src/lib/projectSetup.js PROJECT_DOMAINS); keep the two lists the same.
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

// Roles a project's creator (the Owner) can give starting members. Same as "add a member" (US-09).
export const STARTING_MEMBER_ROLES = ['Admin', 'Contributor', 'Viewer'];
export const MAX_STARTING_MEMBERS = 20;

// Turns the form rows into the API's `members` list: blank rows are dropped, "@name" becomes "name".
export function startingMembersPayload(rows) {
  return (rows || [])
    .map((row) => ({
      identifier: String(row.identifier || '')
        .trim()
        .replace(/^@/, ''),
      role: row.role || 'Contributor',
    }))
    .filter((row) => row.identifier);
}

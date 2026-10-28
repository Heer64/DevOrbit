// [Sprint 3 · M1] Small display helpers shared by the invitation panels (US-10, US-11).
import { formatDay } from './JoinRequestCard';

export { formatDay };

// Pill text and colour for one invitation, from the status the API worked out.
export function invitationBadge(invitation) {
  switch (invitation?.status) {
    case 'Pending':
      return { label: `Pending · expires ${formatDay(invitation.expiresAt)}`, tone: 'orange' };
    case 'Accepted':
      return { label: 'Accepted', tone: 'green' };
    case 'Declined':
      return { label: 'Declined', tone: 'red' };
    case 'Expired':
      return { label: 'Expired', tone: '' };
    default:
      return { label: invitation?.status || '', tone: '' };
  }
}

// Days left before a pending invitation expires, rounded up (1 on its last day, 0 once it has expired).
export function daysLeft(expiresAt, now = Date.now()) {
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

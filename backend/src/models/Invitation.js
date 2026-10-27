import mongoose from 'mongoose';

/*
 * [Sprint 3 · M1] Project invitations (US-10, US-11, FR-31).
 *
 * An Owner or Admin invites an existing DevOrbit user (by email or username) with a role.
 * The invited user accepts (becomes a member with that role) or declines (is not added, and the
 * inviter can see it was declined). A pending invitation expires INVITE_EXPIRY_DAYS days after it
 * was sent.
 *
 * "Expired" is worked out from expiresAt, so an invitation counts as expired the moment its time is
 * up, even before anything writes status 'Expired'. The API stores 'Expired' when it next touches
 * the row (before a new invite, or when someone tries to accept a late one), which also frees the
 * one-pending-invitation slot below.
 *
 * Rows are kept after a decision so the project keeps a history of who was invited and what happened.
 */
export const INVITATION_STATUSES = ['Pending', 'Accepted', 'Declined', 'Expired'];
export const INVITE_ROLES = ['Admin', 'Contributor', 'Viewer'];
export const INVITE_EXPIRY_DAYS = 7;
export const INVITE_EXPIRY_MS = INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

const invitationSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    // The person being invited.
    invitee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // The Owner or Admin who sent it.
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Role the invitee gets on accepting. Never 'Owner'.
    role: {
      type: String,
      enum: INVITE_ROLES,
      default: 'Contributor',
    },
    status: {
      type: String,
      enum: INVITATION_STATUSES,
      default: 'Pending',
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    // When the invitee accepted or declined (null while pending or once expired).
    respondedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// One pending invitation per person per project. Also stops two quick clicks from sending two.
invitationSchema.index(
  { project: 1, invitee: 1 },
  { unique: true, partialFilterExpression: { status: 'Pending' } }
);
// "My invitations": one user's invitations by status, newest first.
invitationSchema.index({ invitee: 1, status: 1, createdAt: -1 });
// The project's invitation list for its Owner and Admins, newest first.
invitationSchema.index({ project: 1, createdAt: -1 });

// The status to show: a Pending invitation whose time is up is Expired.
export function effectiveStatus(invitation, now = new Date()) {
  if (!invitation) return null;
  if (invitation.status === 'Pending' && new Date(invitation.expiresAt).getTime() <= now.getTime()) return 'Expired';
  return invitation.status;
}

export default mongoose.model('Invitation', invitationSchema);

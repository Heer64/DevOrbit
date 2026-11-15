import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

import User from '../models/User.js';
import Session from '../models/Session.js';
import { disconnectUser } from './realtime.js';
import {
  PLATFORM_ROLE_ADMIN,
  adminUserView,
  checkRoleChange,
  checkSuspension,
  readAdminBootstrap,
  roleChangeMessage,
  suspensionMessage,
  userListFilter,
} from './platformRoleRules.js';

/*
 * [Sprint 6 · M8] Platform administration: the database side (US-57, US-58; FR-27, NFR-19).
 * Rules (who may do what, messages, the list filter) live in lib/platformRoleRules.js.
 *
 *   listUsers(query, actorId)                  the admin panel's list, search and filters
 *   changePlatformRole(actorId, userId, role)  grant / revoke Content Moderator (US-57)
 *   setSuspended(actorId, userId, suspend)     suspend / reactivate an account (US-58)
 *   ensurePlatformAdminFromEnv(env)            first Platform Admin from PLATFORM_ADMIN_EMAIL / _PASSWORD (FR-27)
 *
 * Every write is a single conditional update, so two admins clicking at the same moment cannot leave an account
 * half-changed, and a Platform Admin can never be demoted or suspended through here (the update's own condition
 * refuses it even if the account became an admin between the read and the write).
 */

const USER_LIST_FIELDS = 'name username email avatarUrl platformRole suspendedAt createdAt';

// One line per admin action, with IDs only: no names, e-mails, passwords or tokens reach the log.
export function logAdminAction(action, { actorId, targetId, ...extra } = {}) {
  if (process.env.NODE_ENV === 'test') return;
  const details = Object.entries(extra)
    .map(([key, value]) => ` ${key}=${value}`)
    .join('');
  console.info(`[admin] ${action} target=${targetId} by=${actorId}${details}`);
}

export async function listUsers({ q, status, role, page, pageSize }, actorId) {
  const filter = userListFilter({ q, status, role });
  const [users, total, moderators, admins, suspended] = await Promise.all([
    User.find(filter)
      .select(USER_LIST_FIELDS)
      .sort({ name: 1, _id: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    User.countDocuments(filter),
    // Summary for the whole platform (not only this search), shown above the list.
    User.countDocuments({ platformRole: 'moderator' }),
    User.countDocuments({ platformRole: PLATFORM_ROLE_ADMIN }),
    User.countDocuments({ suspendedAt: { $ne: null } }),
  ]);
  return {
    users: users.map((user) => adminUserView(user, actorId)),
    page,
    pageSize,
    total,
    summary: { moderators, admins, suspended },
  };
}

async function loadTarget(userId) {
  return User.findById(userId).select(USER_LIST_FIELDS).lean();
}

/*
 * Grant (role = "moderator") or revoke (role = "user") the Content Moderator role.
 *   -> { ok: true, user, changed, message } | { ok: false, status, message, code }
 * The new role is read by requireAuth on the user's next request (US-57 AC1/AC2).
 */
export async function changePlatformRole(actorId, userId, role) {
  const target = await loadTarget(userId);
  const allowed = checkRoleChange(target, role);
  if (!allowed.ok) return allowed;

  if (allowed.changed) {
    const result = await User.updateOne({ _id: target._id, platformRole: { $ne: PLATFORM_ROLE_ADMIN } }, { $set: { platformRole: role } });
    if (!result.matchedCount) {
      // Removed, or made a Platform Admin, after it was read: answer from what is stored now.
      const now = await loadTarget(userId);
      const again = checkRoleChange(now, role);
      if (!again.ok) return again;
    }
    logAdminAction(role === 'moderator' ? 'moderator.granted' : 'moderator.revoked', { actorId, targetId: target._id });
  }

  const updated = await loadTarget(userId);
  if (!updated) return checkRoleChange(null, role);
  return {
    ok: true,
    changed: allowed.changed,
    user: adminUserView(updated, actorId),
    message: roleChangeMessage(updated.name, role, allowed.changed),
  };
}

/*
 * Suspend (suspend = true) or reactivate (false) an account.
 *   -> { ok: true, user, changed, sessionsEnded, message } | { ok: false, status, message, code }
 * Suspending deletes every session of the account (access and refresh tokens stop working at once) and closes
 * its live connections (US-58 AC1). Reactivating only clears the flag; the user logs in again (US-58 AC2).
 */
export async function setSuspended(actorId, userId, suspend) {
  const target = await loadTarget(userId);
  const allowed = checkSuspension(actorId, target, suspend);
  if (!allowed.ok) return allowed;

  let sessionsEnded = 0;
  if (suspend) {
    if (allowed.changed) {
      const result = await User.updateOne(
        { _id: target._id, platformRole: { $ne: PLATFORM_ROLE_ADMIN }, suspendedAt: null },
        { $set: { suspendedAt: new Date(), suspendedBy: new mongoose.Types.ObjectId(String(actorId)) } }
      );
      if (!result.matchedCount) {
        const now = await loadTarget(userId);
        const again = checkSuspension(actorId, now, true);
        if (!again.ok) return again;
      }
    }
    // Always end the sessions, also when it was already suspended: nothing may stay logged in.
    const ended = await Session.deleteMany({ user: target._id });
    sessionsEnded = ended.deletedCount || 0;
    await disconnectUser(target._id);
    if (allowed.changed) logAdminAction('account.suspended', { actorId, targetId: target._id, sessionsEnded });
  } else if (allowed.changed) {
    await User.updateOne({ _id: target._id }, { $set: { suspendedAt: null, suspendedBy: null } });
    logAdminAction('account.reactivated', { actorId, targetId: target._id });
  }

  const updated = await loadTarget(userId);
  if (!updated) return checkSuspension(actorId, null, suspend);
  return {
    ok: true,
    changed: allowed.changed,
    sessionsEnded,
    user: adminUserView(updated, actorId),
    message: suspensionMessage(updated.name, suspend, allowed.changed),
  };
}

function usernameBase(name) {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 22) || 'admin'
  );
}

async function freeUsername(name) {
  const base = usernameBase(name);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const username = `${base.slice(0, 25)}${crypto.randomBytes(2).toString('hex')}`.slice(0, 30);
    if (!(await User.exists({ username }))) return username;
  }
  throw new Error('Could not pick a free username for the Platform Admin account.');
}

/*
 * First Platform Admin from the environment (FR-27). Runs once when the server starts (server.js).
 *   -> { outcome: 'not_configured' | 'invalid' | 'created' | 'promoted' | 'already_admin' | 'password_mismatch', problem? }
 *
 *   no account with that e-mail   -> it is created as Platform Admin with PLATFORM_ADMIN_PASSWORD     ('created')
 *   account exists, already admin -> nothing to do; a suspension is lifted (the recovery path)        ('already_admin')
 *   account exists, not admin     -> promoted only if PLATFORM_ADMIN_PASSWORD is its real password    ('promoted')
 *                                    otherwise nothing changes and a warning is logged              ('password_mismatch')
 * The password of an existing account is never changed here.
 */
export async function ensurePlatformAdminFromEnv(env = process.env) {
  const config = readAdminBootstrap(env);
  if (!config.configured) return { outcome: 'not_configured' };
  if (!config.ok) return { outcome: 'invalid', problem: config.problem };

  const existing = await User.findOne({ email: config.email }).select('+passwordHash');
  if (!existing) {
    try {
      await User.create({
        name: config.name,
        email: config.email,
        username: await freeUsername(config.name),
        passwordHash: await bcrypt.hash(config.password, 12),
        platformRole: PLATFORM_ROLE_ADMIN,
      });
      return { outcome: 'created' };
    } catch (error) {
      // Someone signed up with that e-mail at the same moment: treat it as an existing account.
      if (error.code !== 11000) throw error;
      return ensurePlatformAdminFromEnv(env);
    }
  }

  if (existing.platformRole === PLATFORM_ROLE_ADMIN) {
    if (existing.suspendedAt) await User.updateOne({ _id: existing._id }, { $set: { suspendedAt: null, suspendedBy: null } });
    return { outcome: 'already_admin' };
  }

  if (!(await bcrypt.compare(config.password, existing.passwordHash))) return { outcome: 'password_mismatch' };
  await User.updateOne({ _id: existing._id }, { $set: { platformRole: PLATFORM_ROLE_ADMIN, suspendedAt: null, suspendedBy: null } });
  return { outcome: 'promoted' };
}

// What server.js prints for each outcome (no e-mail, no password).
export const ADMIN_BOOTSTRAP_LOG = Object.freeze({
  created: 'Platform Admin: created the account from PLATFORM_ADMIN_EMAIL.',
  promoted: 'Platform Admin: the PLATFORM_ADMIN_EMAIL account is now a Platform Admin.',
  already_admin: 'Platform Admin: the PLATFORM_ADMIN_EMAIL account is a Platform Admin.',
  password_mismatch:
    'Platform Admin: NOT promoted. An account with PLATFORM_ADMIN_EMAIL already exists and PLATFORM_ADMIN_PASSWORD is not its password.',
});

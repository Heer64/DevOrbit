import Channel, { DEFAULT_CHANNEL } from '../models/Channel.js';

/*
 * Makes sure the project has its #general channel and returns it.
 * Safe to call on every request: two calls at the same time cannot create two channels
 * (the unique index on { project, name } stops the second one, and we read the winner).
 */
export async function ensureDefaultChannel(projectId) {
  const existing = await Channel.findOne({ project: projectId, name: DEFAULT_CHANNEL });
  if (existing) return existing;

  try {
    return await Channel.create({
      project: projectId,
      name: DEFAULT_CHANNEL,
      description: 'Team-wide conversation',
      isDefault: true,
    });
  } catch (error) {
    if (error.code === 11000) {
      return Channel.findOne({ project: projectId, name: DEFAULT_CHANNEL });
    }
    throw error;
  }
}

// "  Design Review " -> "design-review". Returns '' when nothing usable is left.
export function normalizeChannelName(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/\s+/g, '-')
    .slice(0, 30);
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 2 final] What this file does
 * Helpers for project channels: creates #general on first use and cleans up
 * channel names typed by users ("Design Review" -> "design-review").
 * ---------------------------------------------------------------------------
 */

import { Router } from 'express';
import multer from 'multer';
import User from '../models/User.js';
import Project from '../models/Project.js';
import { requireAuth } from '../middleware/auth.js';
import { MAX_AVATAR_BYTES, detectImageType, saveAvatar, removeAvatarFile } from '../lib/avatar.js';
import { loadUserProfile } from '../lib/userProfile.js'; // [Sprint 5 · M3] US-06
import { PRIVACY_SETTING_MESSAGE, USER_NOT_FOUND_MESSAGE, badPrivacySetting } from '../lib/userProfileRules.js'; // [Sprint 5 · M3] US-06, US-07
import { SKILL_SEARCH_LIMIT, parseSkillTags, rankBySkillMatch, skillTagFilter } from '../lib/skillSearchRules.js'; // [Sprint 5 · M4] US-48
import { readUsername } from '../lib/portfolioRules.js'; // [Sprint 7 · M4]
import { CONNECTION_KINDS, readPage } from '../lib/profileConnectionsRules.js'; // [Sprint 7 · M4]
import { contributionSnapshot, listConnections, profileProjects } from '../lib/profileConnections.js'; // [Sprint 7 · M4]

const router = Router();
router.use(requireAuth);

// Photos are held in memory (2 MB cap) so the bytes can be checked before anything touches disk.
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AVATAR_BYTES, files: 1, fields: 0 } });

function publicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    username: user.username,
    email: user.email,
    bio: user.bio || '',
    headline: user.headline || '',
    avatarUrl: user.avatarUrl || '',
    skills: user.skills || [],
    githubUrl: user.githubUrl || '',
    linkedinUrl: user.linkedinUrl || '',
    focus: user.focus || '',
    exploring: user.exploring || '',
    openTo: user.openTo || '',
    profileDiscoverable: user.profileDiscoverable !== false,
    portfolioPublic: user.portfolioPublic !== false,
  };
}

router.get('/me', async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    return res.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

router.patch('/me', async (req, res, next) => {
  try {
    const allowed = [
      // avatarUrl is deliberately not editable here: photos go through POST /me/avatar so type and size are enforced.
      'name', 'username', 'bio', 'headline', 'skills',
      'githubUrl', 'linkedinUrl', 'focus', 'exploring', 'openTo',
      'profileDiscoverable', 'portfolioPublic',
    ];
    const update = {};
    for (const field of allowed) {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    }
    // [Sprint 5 · M3] US-07: the two privacy switches must be true or false (NFR-21).
    if (badPrivacySetting(update)) return res.status(400).json({ message: PRIVACY_SETTING_MESSAGE });

    if (update.name !== undefined) {
      update.name = String(update.name).trim();
      if (!update.name || update.name.length > 80) return res.status(400).json({ message: 'Name is required and must be 80 characters or fewer.' });
    }
    if (update.username !== undefined) {
      update.username = String(update.username).trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,30}$/.test(update.username)) {
        return res.status(400).json({ message: 'Username must be 3–30 characters and use letters, numbers, dots, underscores or hyphens.' });
      }
      const duplicate = await User.exists({ username: update.username, _id: { $ne: req.user.id } });
      if (duplicate) return res.status(409).json({ message: 'That username is already taken.' });
    }
    if (update.bio !== undefined && String(update.bio).length > 500) return res.status(400).json({ message: 'Bio must be 500 characters or fewer.' });
    if (update.headline !== undefined && String(update.headline).length > 120) return res.status(400).json({ message: 'Headline must be 120 characters or fewer.' });
    // [Sprint 7 · M4] D6: the "About" section on My profile shows these three (they were stored but never shown).
    for (const [field, label, max] of [['focus', 'Focus', 160], ['exploring', 'Exploring', 200], ['openTo', 'Open to', 200]]) {
      if (update[field] === undefined) continue;
      update[field] = String(update[field]).trim();
      if (update[field].length > max) return res.status(400).json({ message: `${label} must be ${max} characters or fewer.` });
    }
    if (update.skills !== undefined) {
      if (!Array.isArray(update.skills)) return res.status(400).json({ message: 'Skills must be a list.' });
      update.skills = [...new Set(update.skills.map((skill) => String(skill).trim()).filter(Boolean))];
      if (update.skills.length > 10) return res.status(400).json({ message: 'Add no more than 10 skills.' });
      if (update.skills.some((skill) => skill.length > 40)) return res.status(400).json({ message: 'Each skill must be 40 characters or fewer.' });
    }

    const user = await User.findByIdAndUpdate(req.user.id, update, { new: true, runValidators: true });
    if (!user) return res.status(404).json({ message: 'User not found.' });
    return res.json({ user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'That username is already taken.' });
    return next(error);
  }
});

router.post('/me/avatar', avatarUpload.single('avatar'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Choose a JPEG or PNG image to upload.' });
    // Both the declared type and the real file signature must say JPEG or PNG.
    const declared = String(req.file.mimetype || '').toLowerCase();
    const detected = detectImageType(req.file.buffer);
    if (!detected || !['image/jpeg', 'image/png'].includes(declared) || declared !== detected.mime) {
      return res.status(415).json({ message: 'Profile photo must be a JPEG or PNG image.' });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    const previous = user.avatarUrl;
    user.avatarUrl = await saveAvatar(user._id.toString(), req.file.buffer, detected.ext);
    await user.save();
    await removeAvatarFile(previous).catch(() => {});
    return res.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

router.delete('/me/avatar', async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    const previous = user.avatarUrl;
    user.avatarUrl = '';
    await user.save();
    await removeAvatarFile(previous).catch(() => {});
    return res.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

/*
 * [Sprint 5 · M3] US-06 View another user's profile (login required: this router uses requireAuth).
 *   GET /api/profile/users/:username
 *     200 { profile: { name, username, headline, bio, avatarUrl, skills, followerCount, publicScore,
 *                      portfolio: { available, path }, isMe } }
 *     404 { message: "User not found." }
 *   Never sends email, password data, IDs or the privacy switches themselves. A portfolio that was
 *   turned off (US-07) comes back as portfolio.available = false and no path.
 *   Rules: lib/userProfileRules.js. Follower count and score: lib/userProfile.js.
 */
router.get('/users/:username', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const profile = await loadUserProfile(req.params.username, req.user.id);
    if (!profile) return res.status(404).json({ message: USER_NOT_FOUND_MESSAGE });
    return res.json({ profile });
  } catch (error) {
    return next(error);
  }
});

/*
 * [Sprint 7 · M4] Followers / following lists, projects on a profile, and D6 (real "About" and
 * "Contribution snapshot" on My profile). Rules: lib/profileConnectionsRules.js, database: lib/profileConnections.js.
 * All need login (router.use(requireAuth) above) and Cache-Control: no-store.
 *
 *   GET /api/profile/me/snapshot
 *     200 { snapshot: { projects, completedProjects, tasksCompleted, tasksCompletedThisWeek, messagesPosted,
 *                       decisionsRecorded, collaborators, followerCount, followingCount, joinedAt } }
 *
 *   GET /api/profile/users/:username/followers?page=1
 *   GET /api/profile/users/:username/following?page=1
 *     200 { people: [{ name, username, headline, avatarUrl }], total, page, pageSize, hasMore }
 *     Newest first, 20 per page. No user IDs or emails. Works on your own and on other people's profiles.
 *
 *   GET /api/profile/users/:username/projects
 *     200 { projects: [{ _id, name, description, domain, status, visibility, tags, color, role,
 *                        memberCount, viewerIsMember, path }] }
 *     Public projects of the user, plus Private ones only when the viewer is a member too.
 *     path = /project/:id for members, /discover/:id (public project page) for everyone else.
 *
 *   404 { message: "User not found." } for an unknown username.
 */
router.get('/me/snapshot', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    return res.json({ snapshot: await contributionSnapshot(req.user.id) });
  } catch (error) {
    return next(error);
  }
});

async function findProfileUser(req, res) {
  const username = readUsername(req.params.username);
  const user = username ? await User.findOne({ username }).select('_id').lean() : null;
  if (!user) res.status(404).json({ message: USER_NOT_FOUND_MESSAGE });
  return user;
}

for (const kind of CONNECTION_KINDS) {
  router.get(`/users/:username/${kind}`, async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      const user = await findProfileUser(req, res);
      if (!user) return undefined;
      return res.json(await listConnections(kind, user._id, readPage(req.query.page)));
    } catch (error) {
      return next(error);
    }
  });
}

router.get('/users/:username/projects', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const user = await findProfileUser(req, res);
    if (!user) return undefined;
    return res.json({ projects: await profileProjects(user._id, req.user.id) });
  } catch (error) {
    return next(error);
  }
});

// US-07 AC1: people who turned off "appear in collaborator search" are never returned here.
/*
 * [Sprint 5 · M4] US-48 Find a collaborator by skill.
 *   GET /api/profile/people?skills=react,css[&q=text]
 *   Users with at least one of the tags (whole tag, any case), most matching tags first, then by name.
 *   Each row also gets matchedSkills (their own spelling) and matchCount. Opted-out users and you are
 *   still never returned. Without ?skills= the free-text search below works exactly as before.
 *   400 for more than 10 tags or a tag over 40 characters. Rules: lib/skillSearchRules.js.
 */
router.get('/people', async (req, res, next) => {
  try {
    const { tags: skillTags, error: skillTagsError } = parseSkillTags(req.query.skills); // [Sprint 5 · M4] US-48
    if (skillTagsError) return res.status(400).json({ message: skillTagsError }); // [Sprint 5 · M4]
    const query = String(req.query.q || '').trim();
    const filter = { _id: { $ne: req.user.id }, profileDiscoverable: true };
    if (query) {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(escaped, 'i');
      filter.$or = [{ name: pattern }, { username: pattern }, { headline: pattern }, { skills: pattern }];
    }
    if (skillTags.length) filter.skills = skillTagFilter(skillTags); // [Sprint 5 · M4] US-48 AC1: at least one tag
    let users = await User.find(filter) // [Sprint 5 · M4] let: re-ordered below for a skill search
      .select('name username headline avatarUrl skills githubUrl linkedinUrl')
      .sort({ updatedAt: -1 })
      .limit(skillTags.length ? 0 : 60) // [Sprint 5 · M4] a skill search ranks every match first, then keeps the top 60
      .lean();
    if (skillTags.length) users = rankBySkillMatch(users, skillTags).slice(0, SKILL_SEARCH_LIMIT); // [Sprint 5 · M4] US-48 AC1: most matching tags first
    const counts = await Project.aggregate([
      { $unwind: '$members' },
      { $match: { 'members.user': { $in: users.map((user) => user._id) } } },
      { $group: { _id: '$members.user', count: { $sum: 1 } } },
    ]);
    const countByUser = new Map(counts.map((entry) => [entry._id.toString(), entry.count]));
    return res.json({ people: users.map((user) => ({
      id: user._id.toString(),
      name: user.name,
      username: user.username,
      role: user.headline || 'DevOrbit member',
      initials: user.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
      skills: user.skills || [],
      projects: countByUser.get(user._id.toString()) || 0,
      color: 'violet',
      githubUrl: user.githubUrl || '',
      linkedinUrl: user.linkedinUrl || '',
      ...(skillTags.length ? { matchedSkills: user.matchedSkills, matchCount: user.matchCount } : {}), // [Sprint 5 · M4] US-48
    })) });
  } catch (error) {
    return next(error);
  }
});

export default router;

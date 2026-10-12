import { Router } from 'express';
import multer from 'multer';
import User from '../models/User.js';
import Project from '../models/Project.js';
import { requireAuth } from '../middleware/auth.js';
import { MAX_AVATAR_BYTES, detectImageType, saveAvatar, removeAvatarFile } from '../lib/avatar.js';

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

router.get('/people', async (req, res, next) => {
  try {
    const query = String(req.query.q || '').trim();
    const filter = { _id: { $ne: req.user.id }, profileDiscoverable: true };
    if (query) {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(escaped, 'i');
      filter.$or = [{ name: pattern }, { username: pattern }, { headline: pattern }, { skills: pattern }];
    }
    const users = await User.find(filter)
      .select('name username headline avatarUrl skills githubUrl linkedinUrl')
      .sort({ updatedAt: -1 })
      .limit(60)
      .lean();
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
    })) });
  } catch (error) {
    return next(error);
  }
});

export default router;

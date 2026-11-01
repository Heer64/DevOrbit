import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { loadProjectForMember } from '../lib/projectAccess.js';
import { canViewProjectHealth } from '../lib/permissions.js';
import { buildProjectHealth } from '../lib/projectHealth.js';

/*
 * [Sprint 4 · M8] Project health (US-40, FR-22). Mounted at /api/projects/:id/health
 *
 * GET /api/projects/:id/health
 *   Project Managers only (Owner or Admin; "Project Manager" in the user stories means one of
 *   these two roles). Contributors and Viewers get 403, as do non-members.
 *   401 not signed in · 400 invalid project ID · 404 no such project · 403 not allowed
 *   -> {
 *        project: { _id, name, status },
 *        membershipRole,
 *        overdue:  { total, limit, tasks: [{ _id, title, status, label, priority, dueDate, daysOverdue, assignee }] },
 *        blocked:  { total, limit, tasks: [ same shape ] },
 *        activity: { days: 7, since, count, level: 'Low'|'Medium'|'High', thresholds: { mediumFrom: 5, highAbove: 20 } },
 *        generatedAt
 *      }
 *   Rules (overdue, blocked, Low/Medium/High): lib/healthRules.js.
 */
const router = Router({ mergeParams: true });
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;
    const { project, role } = loaded;
    if (!canViewProjectHealth(role)) {
      return res.status(403).json({ message: 'Project health is visible to the project Owner and Admins only.' });
    }

    const health = await buildProjectHealth(project._id);
    res.set('Cache-Control', 'no-store');
    return res.json({
      project: { _id: project._id, name: project.name, status: project.status },
      membershipRole: role,
      ...health,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;

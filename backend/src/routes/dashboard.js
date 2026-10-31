import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { loadProjectForMember } from '../lib/projectAccess.js';
import { buildProjectDashboard } from '../lib/projectDashboard.js';

/*
 * [Sprint 4 · M7] Project dashboard (US-39, FR-15). Mounted at /api/projects/:id/dashboard
 *
 * GET /api/projects/:id/dashboard
 *   Signed-in project members only (any role, Viewer included).
 *   401 not signed in · 400 invalid project ID · 404 no such project · 403 not a member
 *   (also for Public projects: the dashboard is a member view).
 *   -> {
 *        project: { _id, name, status },
 *        membershipRole,
 *        milestones: { total, completed, items: [{ _id, title, description, dueDate, taskCount, doneCount, progress, completed }] },
 *        tasks:      { total, open, done, byStatus: { 'To do', 'In progress', 'Blocked', 'Done' } },
 *        dueSoon:    { days: 7, from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', total, limit, tasks: [{ _id, title, status, priority, dueDate, assignee, milestone }] },
 *        generatedAt
 *      }
 *   Rules (open task, 7-day window, milestone %): lib/dashboardRules.js.
 *   Overdue and blocked lists belong to project health (US-40, M8), not this endpoint.
 */
const router = Router({ mergeParams: true });
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;
    const { project, role } = loaded;

    const dashboard = await buildProjectDashboard(project._id);
    res.set('Cache-Control', 'no-store');
    return res.json({
      project: { _id: project._id, name: project.name, status: project.status },
      membershipRole: role,
      ...dashboard,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;

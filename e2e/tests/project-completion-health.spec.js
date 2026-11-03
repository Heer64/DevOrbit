// [Sprint 4 · M8] Journeys: project health on the Dashboard tab (US-40, FR-22), and the Owner
// marks the project Completed and reopens it (US-15, FR-3).
import { test, expect } from '@playwright/test';
import { addTask, createProject, dateInDays, signUp, unique } from './helpers.js';

const openTab = (page, name) => page.locator('.project-tabs').getByRole('button', { name, exact: true }).click();

test('project health lists overdue and blocked tasks and shows the activity level', async ({ page }) => {
  await signUp(page);
  await createProject(page);
  const late = unique('Submit report');
  const stuck = unique('Waiting for API keys');
  await addTask(page, { title: late, dueDate: dateInDays(-3) }); // due 3 days ago, not Done
  await addTask(page, { title: stuck, label: 'Blocked' });

  await openTab(page, 'Dashboard');
  const health = page.getByRole('region', { name: 'Project health' });
  await expect(health).toBeVisible();

  const overdue = health.getByRole('region', { name: 'Overdue', exact: true });
  await expect(overdue.getByText(late)).toBeVisible();
  await expect(overdue.getByText(/days? overdue/)).toBeVisible();
  await expect(overdue.getByText(stuck)).toHaveCount(0);

  const blocked = health.getByRole('region', { name: 'Blocked', exact: true });
  await expect(blocked.getByText(stuck)).toBeVisible();
  await expect(blocked.getByText(/Label: Blocked/)).toBeVisible();
  await expect(blocked.getByText(late)).toHaveCount(0);

  // A brand-new project has only a few feed events this week (project created, 2 tasks): Low (< 5).
  await expect(health.getByTestId('activity-level')).toHaveText('Low');

  // Clicking an overdue task opens it in the Tasks tab.
  await overdue.getByRole('button', { name: `Open task ${late}` }).click();
  await expect(page).toHaveURL(/tab=tasks&task=[a-f0-9]{24}/);
});

test('the Owner marks the project Completed and reopens it', async ({ page }) => {
  await signUp(page);
  const project = await createProject(page);

  await page.getByRole('button', { name: 'Mark as completed', exact: true }).click();
  const confirmComplete = page.getByRole('alertdialog', { name: 'Mark this project as Completed?' });
  await confirmComplete.getByRole('button', { name: 'Mark as completed' }).click();
  await expect(page.getByText('Project marked as Completed.')).toBeVisible();
  await expect(page.getByText(/^Completed on /)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reopen project', exact: true })).toBeVisible();

  // Saved on the server, and recorded in the Activity feed.
  await page.reload();
  await expect(page.getByText(/^Completed on /)).toBeVisible();
  await openTab(page, 'Activity');
  await expect(page.getByText(`marked the project "${project.name}" as Completed`, { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'Reopen project', exact: true }).click();
  const confirmReopen = page.getByRole('alertdialog', { name: 'Reopen this project?' });
  await confirmReopen.getByRole('button', { name: 'Reopen project' }).click();
  await expect(page.getByText('Project reopened.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark as completed', exact: true })).toBeVisible();
  await expect(page.getByText(/^Completed on /)).toHaveCount(0);
});

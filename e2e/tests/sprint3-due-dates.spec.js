
import { test, expect } from '@playwright/test';
import {
  signUp,
  createProject,
  addTask,
  dateInDays,
  unique,
  taskRow,
} from './helpers.js';

test('Sprint 3 M5: tasks show due today and overdue', async ({ page }) => {
  await signUp(page);
  await createProject(page);

  const todayTask = unique('Due today task');
  const overdueTask = unique('Overdue task');

  await addTask(page, {
    title: todayTask,
    dueDate: dateInDays(0),
  });

  await addTask(page, {
    title: overdueTask,
    dueDate: dateInDays(-2),
  });

  await expect(taskRow(page, todayTask)).toBeVisible();
  await expect(taskRow(page, overdueTask)).toBeVisible();

  await expect(taskRow(page, todayTask)).toContainText(/due today/i);
  await expect(taskRow(page, overdueTask)).toContainText(/overdue/i);
});

test('Sprint 3 M5: due date persists after page reload', async ({ page }) => {
  await signUp(page);
  await createProject(page);

  const title = unique('Deadline persistence');

  await addTask(page, {
    title,
    dueDate: dateInDays(1),
  });

  await expect(taskRow(page, title)).toBeVisible();

  await page.reload();

  await expect(taskRow(page, title)).toBeVisible();
  await expect(taskRow(page, title)).toContainText(/due tomorrow/i);
});

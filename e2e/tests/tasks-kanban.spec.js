// Journey 2 (Sprint 2): create a project, add a labelled task, move it on the Kanban board,
// and check the move was saved by the real API (US-21, US-24, US-27, US-28).
import { test, expect } from '@playwright/test';
import { addTask, boardColumn, createProject, signUp, taskRow, unique } from './helpers.js';

test('a task with a label can be created and moved on the Kanban board', async ({ page }) => {
  await signUp(page);
  await createProject(page);
  const title = unique('Write API docs');

  await addTask(page, { title, label: 'Docs' });

  // List view: the new task is To do and shows its label.
  const row = taskRow(page, title);
  await expect(row).toBeVisible();
  await expect(row.getByText('Docs', { exact: true })).toBeVisible();
  await expect(row.getByText('To do', { exact: true })).toBeVisible();

  // Board view: the card is in the To Do column, with the label.
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(boardColumn(page, 'To Do').getByText(title)).toBeVisible();
  await expect(boardColumn(page, 'To Do').getByText('Docs', { exact: true })).toBeVisible();

  // Move it with the card's "Move to" menu (the keyboard/menu path of US-28).
  await page.getByRole('combobox', { name: `Move ${title} to` }).selectOption('In progress');
  await expect(boardColumn(page, 'In Progress').getByText(title)).toBeVisible();
  await expect(boardColumn(page, 'To Do').getByText(title)).toHaveCount(0);

  // Reload: the board loads from the API, so the new status must have been saved.
  await page.reload();
  await expect(boardColumn(page, 'In Progress').getByText(title)).toBeVisible();

  // The change is in the project's Activity feed.
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByText(/moved .*Write API docs.* from To do to In progress/)).toBeVisible();
});

test('editing a task label is saved', async ({ page }) => {
  await signUp(page);
  await createProject(page);
  const title = unique('Fix navbar');
  await addTask(page, { title, label: 'Frontend' });

  await page.getByRole('button', { name: 'List', exact: true }).click();
  await page.getByRole('button', { name: `Edit ${title}` }).click();
  const label = page.getByPlaceholder('e.g. Frontend, Bug, Docs');
  await expect(label).toHaveValue('Frontend');
  await label.fill('Bug');
  await page.getByRole('button', { name: /Save changes/ }).click();

  await page.reload();
  await expect(taskRow(page, title).getByText('Bug', { exact: true })).toBeVisible();
});

// [Sprint 1 · roles] Journey: what each project role can do, end to end in two browsers
// (US-08 create a project with starting members, US-09 assign project roles; read-only Viewers from Sprint 2 Pair D).
// The Owner creates a project with a Viewer as a starting member. The Viewer can open it but cannot
// add tasks or change roles. The Owner makes them a Contributor: now they can add a task, but they
// still cannot change anyone's role. The API rules themselves are covered in backend/test.
import { test, expect } from '@playwright/test';
import { addTask, signUp, taskRow, unique } from './helpers.js';

const VIEWER_NOTE = 'You are a Viewer on this project, so tasks are read-only.';
const ROLES_NOTE = 'Only Owners and Admins can change roles.';
const roleSelects = (page) => page.getByRole('combobox', { name: /^Role for / });
const addTaskButtons = (page) => page.getByRole('button', { name: 'Add task', exact: true });

test('a Viewer is read-only; after the Owner makes them a Contributor they can add tasks but not change roles', async ({ browser }) => {
  // The member signs up first, so the Owner can add them by email.
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  const member = await signUp(memberPage, unique('Member'));

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const owner = await signUp(ownerPage, unique('Owner'));

  // The Owner creates a project with the member as a Viewer (create form: "Starting members").
  const projectName = unique('Roles project');
  await ownerPage.getByRole('button', { name: 'Create project', exact: true }).first().click();
  await ownerPage.getByPlaceholder('e.g. CampusConnect').fill(projectName);
  await ownerPage.getByRole('radio', { name: /Private/ }).check();
  await ownerPage.getByRole('button', { name: 'Add a member' }).click();
  await ownerPage.getByLabel('Starting member 1 email or username').fill(member.email);
  await ownerPage.getByLabel('Starting member 1 role').selectOption('Viewer');
  await ownerPage.getByRole('button', { name: /Create workspace/ }).click();
  await expect(ownerPage).toHaveURL(/\/dashboard$/);
  await ownerPage.getByRole('button', { name: `Open ${projectName}` }).click();
  await expect(ownerPage).toHaveURL(/\/project\/[a-f0-9]{24}$/);
  const projectPath = new URL(ownerPage.url()).pathname;

  // The Owner sees the member as a Viewer and can change their role.
  await expect(ownerPage.getByText('You: Owner')).toBeVisible();
  const memberRole = ownerPage.getByRole('combobox', { name: `Role for ${member.name}` });
  await expect(memberRole).toHaveValue('Viewer');

  // Viewer: can open the project, but there is no "Add task" and the task list says read-only.
  await memberPage.goto(projectPath);
  await expect(memberPage.getByRole('heading', { level: 1, name: projectName })).toBeVisible();
  await expect(memberPage.getByText('You: Viewer')).toBeVisible();
  await expect(memberPage.getByText(VIEWER_NOTE)).toBeVisible();
  await expect(addTaskButtons(memberPage)).toHaveCount(0);
  // ...and cannot change roles.
  await expect(memberPage.getByText(ROLES_NOTE)).toBeVisible();
  await expect(roleSelects(memberPage)).toHaveCount(0);

  // The Owner makes the member a Contributor.
  await memberRole.selectOption('Contributor');
  await expect(ownerPage.getByText(`${member.name} is now Contributor.`)).toBeVisible();
  await ownerPage.reload();
  await expect(ownerPage.getByRole('combobox', { name: `Role for ${member.name}` })).toHaveValue('Contributor');

  // Contributor: after a reload the new role applies, and they can add a task.
  await memberPage.reload();
  await expect(memberPage.getByText('You: Contributor')).toBeVisible();
  await expect(memberPage.getByText(VIEWER_NOTE)).toHaveCount(0);
  const title = unique('Contributor task');
  await addTask(memberPage, { title });
  await expect(taskRow(memberPage, title)).toBeVisible();

  // The task was saved by the API: the Owner sees it too.
  await ownerPage.reload();
  await expect(taskRow(ownerPage, title)).toBeVisible();

  // A Contributor still cannot change roles: no role menus, and the note says why.
  await expect(memberPage.getByText(ROLES_NOTE)).toBeVisible();
  await expect(roleSelects(memberPage)).toHaveCount(0);
  await expect(memberPage.getByRole('combobox', { name: `Role for ${owner.name}` })).toHaveCount(0);

  await memberContext.close();
  await ownerContext.close();
});

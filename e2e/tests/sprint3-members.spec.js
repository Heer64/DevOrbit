
import { test, expect } from '@playwright/test';
import { signUp, createProject } from './helpers.js';

test('Sprint 3 M3: owner removes a member after confirmation', async ({ page, browser }) => {
  await signUp(page);
  const project = await createProject(page);

  const memberContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  const memberPage = await memberContext.newPage();

  try {
    const member = await signUp(memberPage);

    const invitations = page.locator('.invitations-panel');
    await invitations.getByLabel('Email or username to invite')
      .fill(member.email);

    await invitations.getByLabel('Role for the invited person')
      .selectOption('Contributor');

    await invitations.getByRole('button', { name: 'Send invite' }).click();

    await expect(invitations.getByRole('status'))
      .toContainText('Invitation sent');


    await memberPage.reload();

    const inbox = memberPage.getByRole('region', {
      name: 'Your invitations',
    });

    await inbox.getByRole('button', {
      name: `Accept invitation to ${project.name}`,
    }).click();

    await memberPage.goto(`/project/${project.id}`);

    await expect(memberPage.getByRole('heading', {
      name: project.name,
      level: 1,
    })).toBeVisible();
// Refresh owner's page after the invited member joins.
await page.reload();
    const team = page.locator('.team-panel');

    await expect(team.getByRole('button', {
      name: `Remove ${member.name}`,
    })).toBeVisible();

    await team.getByRole('button', {
      name: `Remove ${member.name}`,
    }).click();

    const dialog = page.getByRole('alertdialog');

    await expect(dialog).toContainText(`Remove ${member.name}?`);

    // Cancel first: membership should remain.
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await expect(team.getByRole('button', {
      name: `Remove ${member.name}`,
    })).toBeVisible();

    // Confirm removal.
    await team.getByRole('button', {
      name: `Remove ${member.name}`,
    }).click();

    await page.getByRole('alertdialog')
      .getByRole('button', { name: 'Remove member' })
      .click();

    await expect(team.getByRole('status'))
      .toContainText(`${member.name} was removed`);

    await expect(team.getByRole('button', {
      name: `Remove ${member.name}`,
    })).toHaveCount(0);

    await memberPage.reload();

    await expect(memberPage.getByRole('heading', {
      name: project.name,
      level: 1,
    })).not.toBeVisible();
  } finally {
    await memberContext.close();
  }
});

test('Sprint 3 M3: only owner cannot leave without transfer', async ({ page }) => {
  await signUp(page);
  await createProject(page);

  await page.reload();
  const team = page.locator('.team-panel');

  await team.getByRole('button', {
    name: 'Leave project',
  }).click();

  const dialog = page.getByRole('alertdialog');

  await expect(dialog).toContainText('Transfer ownership first');

  await dialog.getByRole('button',{
    name: 'OK',
  }).click();

  await expect(dialog).toHaveCount(0);

  await expect(team.getByText('You: Owner')).toBeVisible();
});

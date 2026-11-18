
import { test, expect } from '@playwright/test';
import { signUp, createProject } from './helpers.js';

test('Sprint 3 M1: user accepts project invitation', async ({ page, browser }) => {

  await signUp(page);
  const project = await createProject(page);

  const inviteeContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  const inviteePage = await inviteeContext.newPage();

  try {
    const invitee = await signUp(inviteePage);

    const invitations = page.locator('.invitations-panel');
    await invitations.getByLabel('Email or username to invite')
      .fill(invitee.email);

    await invitations.getByLabel('Role for the invited person')
      .selectOption('Contributor');

    await invitations.getByRole('button', { name: 'Send invite' })
      .click();

    await expect(invitations.getByRole('status'))
      .toContainText('Invitation sent');

    await inviteePage.reload();

    const inbox = inviteePage.getByRole('region', {
      name: 'Your invitations',
    });

    await expect(inbox).toBeVisible();

    await inbox.getByRole('button', {
      name: `Accept invitation to ${project.name}`,
    }).click();


    await inviteePage.goto(`/project/${project.id}`);

    await expect(
      inviteePage.getByRole('heading', {
        level: 1,
        name: project.name,
      }),
    ).toBeVisible();
  } finally {
    await inviteeContext.close();
  }
});

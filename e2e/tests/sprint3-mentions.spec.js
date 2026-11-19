
import { test, expect } from '@playwright/test';
import { signUp, createProject, unique } from './helpers.js';

test('Sprint 3 M4 M7: mention creates a notification that can be read', async ({ page, browser }) => {
  await signUp(page);
  const project = await createProject(page);

  const memberContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  const memberPage = await memberContext.newPage();

  try {
    const member = await signUp(memberPage);

    // Owner invites the second user.
    const invitations = page.locator('.invitations-panel');

    await invitations
      .getByLabel('Email or username to invite')
      .fill(member.email);

    await invitations
      .getByLabel('Role for the invited person')
      .selectOption('Contributor');

    await invitations
      .getByRole('button', { name: 'Send invite' })
      .click();

    await expect(
      invitations.getByRole('status'),
    ).toContainText('Invitation sent');

    // Second user accepts invitation.
    await memberPage.reload();

    await memberPage
      .getByRole('region', { name: 'Your invitations' })
      .getByRole('button', {
        name: `Accept invitation to ${project.name}`,
      })
      .click();

    await memberPage.goto(`/project/${project.id}`);

    await expect(
      memberPage.getByRole('heading', {
        name: project.name,
        level: 1,
      }),
    ).toBeVisible();

    // Refresh Owner's page to load new member.
    await page.reload();

    // Owner opens Chat.
    await page
      .locator('.project-tabs')
      .getByRole('button', { name: 'Chat', exact: true })
      .click();

    const room = page.getByRole('region', {
      name: '#general',
    });

    const editor = room.getByRole('combobox', {
      name: 'Message',
    });

    // Type @ to open member suggestions.
    await editor.fill('@');

    const suggestions = page.getByRole('listbox', {
      name: 'Mention a project member',
    });

    await expect(suggestions).toBeVisible();

    // Select the invited user.
    await suggestions
      .getByRole('option', {
        name: new RegExp(member.name),
      })
      .click();

    const message = unique('Please review this task');

    await editor.press('End');
    await editor.pressSequentially(` ${message}`);

    await room
      .getByRole('button', { name: 'Send message' })
      .click();

    // The message appears in the channel.
    await expect(
      room.getByText(message, { exact: false }),
    ).toBeVisible();

    // Invited user receives a mention notification.
    await memberPage.reload();

    const bell = memberPage.getByRole('button', {
      name: /^Notifications/,
    });

    await expect(bell).toContainText(/1/).catch(() => {});
    await bell.click();

    const list = memberPage.getByRole('region', {
      name: 'Notifications list',
    });

    await expect(list).toBeVisible();

    const notification = list
      .locator('button.notif-item')
      .filter({ hasText: 'Mention' });

    await expect(notification).toBeVisible();
    await expect(notification).toHaveClass(/unread/);

    // Opening notification marks it read.
    await notification.click();

    await memberPage
      .getByRole('button', { name: /^Notifications/ })
      .click();

    await expect(
      memberPage
        .getByRole('region', { name: 'Notifications list' })
        .locator('button.notif-item')
        .filter({ hasText: 'Mention' }),
    ).not.toHaveClass(/unread/);
  } finally {
    await memberContext.close();
  }
});


import { test, expect } from '@playwright/test';
import {
  signUp,
  createProject,
  addTask,
  unique,
  taskRow,
} from './helpers.js';

// Open a project tab.
const openTab = async (page, name) => {
  await page
    .locator('.project-tabs')
    .getByRole('button', { name, exact: true })
    .click();
};

// Only search channel messages, not copies inside the thread panel.
const channelMessage = (page, text) =>
  page.locator('.chat-messages article.chat-message', {
    hasText: text,
  });

// ------------------------------------------------------------
// Sprint 3 - M4 - US-17
// Test 1: Thread replies persist after reload.
// ------------------------------------------------------------

test('Sprint 3 M4 (US-17): thread replies persist after reload', async ({ page }) => {
  await signUp(page);
  await createProject(page);
  await openTab(page, 'Chat');

  const message = unique('Sprint 3 discussion');
  const reply = unique('Sprint 3 thread reply');

  const room = page.getByRole('region', {
    name: '#general',
  });

  // Create a channel message.
  await room
    .getByRole('combobox', { name: 'Message' })
    .fill(message);

  await room
    .getByRole('button', { name: 'Send message' })
    .click();

  const messageRow = channelMessage(page, message);

  await expect(messageRow).toBeVisible();

  // Open the message thread.
  await messageRow
    .getByRole('button', { name: 'Reply in thread' })
    .click();

  const thread = page.getByRole('complementary', {
    name: 'Thread',
  });

  await expect(thread).toBeVisible();

  // Send a thread reply.
  await thread
    .getByRole('combobox', { name: 'Reply' })
    .fill(reply);

  await thread
    .getByRole('button', { name: 'Send reply' })
    .click();

  // Verify reply appears.
  await expect(thread.getByText(reply)).toBeVisible();

  // Verify reply count.
  await expect(
    messageRow.getByRole('button', {
      name: /1 reply, open thread/i,
    }),
  ).toBeVisible();

  // Reload to verify data is stored on server.
  await page.reload();

  await openTab(page, 'Chat');

  const savedMessage = channelMessage(page, message);

  await expect(savedMessage).toBeVisible();

  await savedMessage
    .getByRole('button', {
      name: /1 reply, open thread/i,
    })
    .click();

  // Reply must still exist after reload.
  await expect(
    page
      .getByRole('complementary', { name: 'Thread' })
      .getByText(reply),
  ).toBeVisible();
});

// ------------------------------------------------------------
// Sprint 3 - M4 - US-20
// Test 2: Task comments persist after reload.
// ------------------------------------------------------------

test('Sprint 3 M4 (US-20): task comments persist after reload', async ({ page }) => {
  await signUp(page);
  await createProject(page);

  const title = unique('Sprint 3 comment task');
  const comment = unique('Sprint 3 task comment');

  // Create task.
  await addTask(page, { title });

  await expect(taskRow(page, title)).toBeVisible();

  // Open task editor.
  await page
    .getByRole('button', { name: `Edit ${title}` })
    .click();

  const comments = page.getByRole('region', {
    name: 'Comments',
  });

  await expect(comments).toBeVisible();

  // Write and post a comment.
  await comments
    .getByRole('combobox', { name: 'Add a comment' })
    .fill(comment);

  await comments
    .getByRole('button', { name: 'Post comment' })
    .click();

  // Verify comment appears.
  await expect(
    comments.getByText(comment),
  ).toBeVisible();

  // Reload the page.
  await page.reload();

  await expect(taskRow(page, title)).toBeVisible();

  // Open task editor again.
  await page
    .getByRole('button', { name: `Edit ${title}` })
    .click();

  // Verify comment persists after reload.
  await expect(
    page
      .getByRole('region', { name: 'Comments' })
      .getByText(comment),
  ).toBeVisible();
});

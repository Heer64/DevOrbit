// [Sprint 7 · M1] Edit and delete your own channel messages and thread replies, end to end.
// - Edit in place: "(edited)" mark, kept after a reload.
// - Delete after a confirmation: "Message deleted" in the same place, its thread and reply count kept.
// - A deleted reply stays in the thread as "Message deleted".
// (403 for someone else's message and live delivery to other members are covered by
//  backend/test/channelMessageEdits.test.js.)
import { test, expect } from '@playwright/test';
import { signUp, createProject, unique } from './helpers.js';

const openTab = (page, name) => page.locator('.project-tabs').getByRole('button', { name, exact: true }).click();
const channelMessage = (page, text) => page.locator('.chat-messages article.chat-message', { hasText: text });

test('Sprint 7 M1: edit and delete channel messages and thread replies, kept after reload', async ({ page }) => {
  await signUp(page);
  await createProject(page);
  await openTab(page, 'Chat');
  const room = page.getByRole('region', { name: '#general' });

  const send = async (text) => {
    await room.getByRole('combobox', { name: 'Message' }).fill(text);
    await room.getByRole('button', { name: 'Send message' }).click();
    await expect(channelMessage(page, text)).toBeVisible();
  };

  // Edit: fix a typo in place.
  const typo = unique('Standup tommorow');
  await send(typo);
  const typoRow = channelMessage(page, typo);
  await typoRow.hover();
  await typoRow.getByRole('button', { name: 'Edit message' }).click();
  const fixed = typo.replace('tommorow', 'tomorrow');
  await room.getByRole('combobox', { name: 'Edit your message' }).fill(fixed);
  await room.getByRole('combobox', { name: 'Edit your message' }).press('Enter');
  const fixedRow = channelMessage(page, fixed);
  await expect(fixedRow).toBeVisible();
  await expect(fixedRow.locator('.chat-edited')).toHaveText('(edited)');
  await expect(room.getByText(typo)).toHaveCount(0);

  // A thread with one reply, then the reply is deleted.
  const question = unique('Vite or Next?');
  await send(question);
  const questionRow = channelMessage(page, question);
  await questionRow.getByRole('button', { name: 'Reply in thread' }).click();
  const thread = page.getByRole('complementary', { name: 'Thread' });
  const answer = unique('Vite, it is lighter');
  await thread.getByRole('combobox', { name: 'Reply' }).fill(answer);
  await thread.getByRole('button', { name: 'Send reply' }).click();
  const answerRow = thread.locator('article.chat-message', { hasText: answer });
  await expect(answerRow).toBeVisible();
  await answerRow.hover();
  await answerRow.getByRole('button', { name: 'Delete message' }).click();
  await page.getByRole('alertdialog', { name: 'Delete this reply?' }).getByRole('button', { name: 'Delete reply' }).click();
  await expect(thread.locator('article.chat-message.deleted')).toHaveCount(1);
  await expect(thread.getByText(answer)).toHaveCount(0);
  await expect(questionRow.getByRole('button', { name: /1 reply/ })).toBeVisible();
  await thread.getByRole('button', { name: 'Close thread' }).click();

  // Delete the thread's first message: it stays in place, and its thread can still be opened.
  await questionRow.hover();
  await questionRow.getByRole('button', { name: 'Delete message' }).click();
  await page.getByRole('alertdialog', { name: 'Delete this message?' }).getByRole('button', { name: 'Delete message' }).click();
  const deletedRows = page.locator('.chat-messages article.chat-message.deleted');
  await expect(deletedRows).toHaveCount(1);
  await expect(deletedRows.first()).toContainText('Message deleted');
  await expect(deletedRows.first().getByRole('button', { name: /1 reply/ })).toBeVisible();
  await expect(room.getByText(question)).toHaveCount(0);

  // Reload: the edit and both deletes were saved on the server.
  await page.reload();
  await openTab(page, 'Chat');
  await expect(channelMessage(page, fixed).locator('.chat-edited')).toBeVisible();
  await expect(page.locator('.chat-messages article.chat-message.deleted')).toHaveCount(1);
  await expect(page.getByText(question)).toHaveCount(0);
});

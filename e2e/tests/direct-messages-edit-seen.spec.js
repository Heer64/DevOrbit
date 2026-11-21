// [Sprint 7 · M2] Direct messages: edit and delete your own messages, and Sent / Seen, end to end in two browsers.
// - "Sent" under my message until the other person opens the conversation, then "Seen" (live, and after a reload).
// - Edit: "edited" mark on both sides, live. Delete: "Message deleted" on both sides, in the same place, live.
// - Only my own messages have Edit / Delete; the API answers 403 for someone else's message.
import { test, expect } from '@playwright/test';
import { signUp, unique } from './helpers.js';

const usernameOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('devorbit_user') || '{}').username);

test('Sprint 7 M2: Sent/Seen, edit and delete direct messages, live on both sides and kept after reload', async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  await signUp(alice, unique('Alice'));

  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();
  const bobUser = await signUp(bob, unique('Bob'));
  const bobUsername = await usernameOf(bob);

  // Bob waits on his Messages page; Alice opens a conversation with him from his profile.
  await bob.getByRole('link', { name: /^Messages/ }).click();
  await expect(bob).toHaveURL(/\/messages$/);
  await alice.goto(`/people/${bobUsername}`);
  await alice.getByRole('button', { name: `Message ${bobUser.name}` }).click();
  await expect(alice).toHaveURL(/\/messages\/[a-f0-9]{24}$/);
  const conversationPath = new URL(alice.url()).pathname;
  const aliceRoom = alice.getByRole('region', { name: `Conversation with ${bobUser.name}` });

  // Sent: Bob has not opened the conversation yet.
  const first = `Are we on for 4pm? ${unique('m')}`;
  await aliceRoom.getByLabel('Write a direct message').fill(first);
  await aliceRoom.getByLabel('Write a direct message').press('Enter');
  const firstOnAlice = aliceRoom.locator('.dm-message.mine', { hasText: first });
  await expect(firstOnAlice.locator('.dm-status')).toContainText('Sent');

  // Seen: Bob opens it; Alice's message changes without a reload.
  await bob.getByRole('navigation', { name: 'Conversations' }).getByRole('link', { name: /Alice/ }).click();
  const bobRoom = bob.getByRole('region', { name: /^Conversation with Alice/ });
  await expect(bobRoom.locator('.dm-message.theirs', { hasText: first })).toBeVisible();
  await expect(firstOnAlice.locator('.dm-status')).toContainText('Seen');
  await expect(bobRoom.locator('.dm-message.theirs', { hasText: first }).locator('.dm-status')).toHaveCount(0);

  // Only my own messages have Edit / Delete.
  await expect(bobRoom.locator('.dm-message.theirs').getByRole('button', { name: 'Edit message' })).toHaveCount(0);
  await expect(bobRoom.locator('.dm-message.theirs').getByRole('button', { name: 'Delete message' })).toHaveCount(0);

  // Edit: Alice fixes a typo; Bob sees the new text and "edited" live.
  const typo = `See you tommorow ${unique('m')}`;
  await aliceRoom.getByLabel('Write a direct message').fill(typo);
  await aliceRoom.getByLabel('Write a direct message').press('Enter');
  const typoOnAlice = aliceRoom.locator('.dm-message.mine', { hasText: typo });
  await typoOnAlice.hover();
  await typoOnAlice.getByRole('button', { name: 'Edit message' }).click();
  const fixed = typo.replace('tommorow', 'tomorrow');
  await aliceRoom.getByLabel('Edit your message').fill(fixed);
  await aliceRoom.getByLabel('Edit your message').press('Enter');
  const fixedOnBob = bobRoom.locator('.dm-message.theirs', { hasText: fixed });
  await expect(fixedOnBob).toBeVisible();
  await expect(fixedOnBob.locator('.dm-edited')).toBeVisible();
  await expect(bobRoom.getByText(typo)).toHaveCount(0);

  // Delete: confirmation, then "Message deleted" on both sides, in the same place.
  await firstOnAlice.hover();
  await firstOnAlice.getByRole('button', { name: 'Delete message' }).click();
  await alice.getByRole('alertdialog').getByRole('button', { name: 'Delete message' }).click();
  await expect(aliceRoom.locator('.dm-message.deleted')).toHaveCount(1);
  await expect(bobRoom.locator('.dm-message.deleted')).toHaveCount(1);
  await expect(bobRoom.getByText(first)).toHaveCount(0);
  await expect(bobRoom.locator('.dm-message').first()).toContainText('Message deleted');

  // (403 for someone else's message is covered by backend/test/directMessageEdits.test.js.)

  // Reload both: edited, deleted and Seen are kept (saved on the server).
  await alice.reload();
  await bob.reload();
  await expect(bob).toHaveURL(new RegExp(`${conversationPath}$`));
  await expect(aliceRoom.locator('.dm-message.deleted')).toHaveCount(1);
  await expect(aliceRoom.locator('.dm-message.mine', { hasText: fixed }).locator('.dm-edited')).toBeVisible();
  await expect(aliceRoom.locator('.dm-message.mine', { hasText: fixed }).locator('.dm-status')).toContainText('Seen');
  await expect(bobRoom.locator('.dm-message.deleted')).toHaveCount(1);
  await expect(bobRoom.locator('.dm-message.theirs', { hasText: fixed }).locator('.dm-edited')).toBeVisible();

  await aliceContext.close();
  await bobContext.close();
});

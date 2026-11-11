// [Sprint 6 · M2] US-19 Send direct messages, end to end in two browsers.
// AC1: "Message" on a profile opens a private conversation, separate from project channels.
// AC2: the other person sees new messages live (no reload), and a third person cannot open the conversation.
// The under-1-second delivery time is measured in backend/test/directMessagesRealtime.test.js.
import { test, expect } from '@playwright/test';
import { signUp, unique } from './helpers.js';

const usernameOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('devorbit_user') || '{}').username);

test('US-19: Message on a profile, live delivery both ways, unread badge, and privacy', async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  await signUp(alice, unique('Alice'));

  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();
  const bobUser = await signUp(bob, unique('Bob'));
  const bobUsername = await usernameOf(bob);
  expect(bobUsername).toBeTruthy();

  // Bob waits on his (empty) Messages page.
  await bob.getByRole('link', { name: /^Messages/ }).click();
  await expect(bob).toHaveURL(/\/messages$/);
  await expect(bob.getByText('No conversations yet.')).toBeVisible();

  // AC1: Alice opens Bob's profile and chooses Message.
  await alice.goto(`/people/${bobUsername}`);
  await alice.getByRole('button', { name: `Message ${bobUser.name}` }).click();
  await expect(alice).toHaveURL(/\/messages\/[a-f0-9]{24}$/);
  const conversationUrl = alice.url();
  const aliceRoom = alice.getByRole('region', { name: `Conversation with ${bobUser.name}` });
  await expect(aliceRoom.getByText(`only you and ${bobUser.name} can read it`, { exact: false })).toBeVisible();
  await expect(aliceRoom.getByText('not part of any project channel', { exact: false })).toBeVisible();

  // AC2: Alice sends; Bob's inbox shows it live, with an unread badge, without reloading.
  const hello = `Hello Bob ${unique('dm')}`;
  await aliceRoom.getByLabel('Write a direct message').fill(hello);
  await aliceRoom.getByRole('button', { name: 'Send message' }).click();
  await expect(aliceRoom.locator('.dm-message.mine', { hasText: hello })).toBeVisible();

  const bobInbox = bob.getByRole('navigation', { name: 'Conversations' });
  await expect(bobInbox.getByText(hello)).toBeVisible();
  await expect(bob.getByTestId('dm-unread-badge')).toContainText('1');

  // Bob opens it: the badge goes away and he replies; Alice sees the reply live.
  await bobInbox.getByRole('link', { name: /Alice/ }).click();
  await expect(bob).toHaveURL(new RegExp(`${new URL(conversationUrl).pathname}$`)); // the same conversation as Alice's
  const bobRoom = bob.getByRole('region', { name: /^Conversation with Alice/ });
  await expect(bobRoom.locator('.dm-message.theirs', { hasText: hello })).toBeVisible();
  await expect(bob.getByTestId('dm-unread-badge')).toHaveCount(0);

  const reply = `Hi Alice ${unique('dm')}`;
  await bobRoom.getByLabel('Write a direct message').fill(reply);
  await bobRoom.getByLabel('Write a direct message').press('Enter');
  await expect(aliceRoom.locator('.dm-message.theirs', { hasText: reply })).toBeVisible();

  // AC2: a third user cannot read the conversation, even with its link.
  const carolContext = await browser.newContext();
  const carol = await carolContext.newPage();
  await signUp(carol, unique('Carol'));
  await carol.goto(new URL(conversationUrl).pathname);
  await expect(carol.getByRole('alert')).toContainText('This conversation does not exist, or you are not part of it.');
  await expect(carol.getByText(hello)).toHaveCount(0);
  await expect(carol.getByText(reply)).toHaveCount(0);

  await aliceContext.close();
  await bobContext.close();
  await carolContext.close();
});

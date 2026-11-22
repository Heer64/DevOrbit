// [Sprint 7 · M6] Notification popup, end to end with two people in two browsers.
// Riya posts on the feed and waits on her dashboard. Jai comments on the post. Riya gets the
// "Reply" notification live: a popup appears (no reload), and selecting it opens the feed and
// marks the notification read. The close button only hides a popup.
// (The "Server is waking up…" banner needs a sleeping Render server, so it is covered by
//  frontend/src/serverWake.test.js, api.serverWake.test.js and ServerWakeBanner.test.jsx.)
import { test, expect } from '@playwright/test';
import { signUp, unique } from './helpers.js';

async function publishPost(page, text) {
  await page.goto('/feed');
  await page.getByRole('tab', { name: 'Latest' }).click();
  const composer = page.getByRole('form', { name: 'Create a post' });
  await composer.getByRole('textbox', { name: 'Post text' }).fill(text);
  await composer.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(composer.getByRole('status')).toContainText('Your post is published');
}

async function commentOn(page, postText, comment) {
  await page.goto('/feed');
  await page.getByRole('tab', { name: 'Latest' }).click();
  const post = page.locator('article.post-card', { hasText: postText });
  await post.locator('.post-comments-toggle').click();
  await post.getByRole('textbox', { name: 'Write a comment' }).fill(comment);
  await post.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(post.getByText(comment)).toBeVisible();
}

test('Sprint 7 M6: a new notification pops up live and opens its item', async ({ browser }) => {
  const riyaContext = await browser.newContext();
  const jaiContext = await browser.newContext();
  const riya = await riyaContext.newPage();
  const jai = await jaiContext.newPage();

  try {
    await signUp(riya, unique('Riya Popup'));
    const jaiUser = await signUp(jai, unique('Jai Popup'));

    const postText = unique('Who wants to pair on the deploy?');
    await publishPost(riya, postText);

    // Riya waits on her dashboard; the live connection is opened by the bell.
    await riya.goto('/dashboard');
    const bell = riya.getByRole('button', { name: /^Notifications/ });
    await expect(bell).toHaveAttribute('aria-label', 'Notifications');
    await riya.waitForTimeout(1500); // let the live connection open before Jai comments (events are not replayed)

    // 1st comment: the popup appears without a reload. Close it with ✕: it stays unread.
    await commentOn(jai, postText, unique('Me! After lunch?'));
    const popups = riya.getByRole('region', { name: 'New notifications' });
    const first = popups.locator('.live-toast').first();
    await expect(first).toBeVisible();
    await expect(first).toContainText('Reply');
    await expect(first).toContainText(jaiUser.name);
    await expect(bell).toHaveAttribute('aria-label', 'Notifications, 1 unread');
    await first.getByRole('button', { name: 'Dismiss notification' }).click();
    await expect(popups.locator('.live-toast')).toHaveCount(0);
    await expect(bell).toHaveAttribute('aria-label', 'Notifications, 1 unread');

    // 2nd comment: select the popup itself. It opens the feed and is marked read.
    await commentOn(jai, postText, unique('Or tomorrow morning'));
    const second = popups.locator('.live-toast').first();
    await expect(second).toBeVisible();
    await expect(bell).toHaveAttribute('aria-label', 'Notifications, 2 unread');
    await second.locator('.live-toast-open').click();
    await expect(riya).toHaveURL(/\/feed$/);
    await expect(popups.locator('.live-toast')).toHaveCount(0);
    await expect(bell).toHaveAttribute('aria-label', 'Notifications, 1 unread');
  } finally {
    await riyaContext.close();
    await jaiContext.close();
  }
});

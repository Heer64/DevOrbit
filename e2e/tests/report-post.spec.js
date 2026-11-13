// Sprint 6 · M6 (US-55): a user reports someone else's public post with a reason and is thanked;
// reporting it again (after a reload) says it was already reported. The author cannot report their own post.
// Two separate browser sessions: the author and the reporter.
import { test, expect } from '@playwright/test';
import { signUp, unique } from './helpers.js';

test('report a public post with a reason; a second report is told it was already reported', async ({ browser }) => {
  const text = unique('Cheap followers here');

  // The author publishes a post.
  const authorContext = await browser.newContext();
  const author = await authorContext.newPage();
  await signUp(author);
  await author.goto('/feed');
  await author.getByRole('textbox', { name: 'Post text' }).fill(text);
  await author.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(author.getByText('Your post is published.')).toBeVisible();

  // The author sees Edit/Delete on their own post, never Report.
  await author.getByRole('tab', { name: 'Latest' }).click();
  const ownCard = author.getByRole('article').filter({ hasText: text });
  await expect(ownCard.getByRole('button', { name: 'Edit post' })).toBeVisible();
  await expect(ownCard.getByRole('button', { name: 'Report post' })).toHaveCount(0);

  // Another user reports it (AC1).
  const reporterContext = await browser.newContext();
  const reporter = await reporterContext.newPage();
  await signUp(reporter);
  await reporter.goto('/feed');
  await reporter.getByRole('tab', { name: 'Latest' }).click();
  const card = reporter.getByRole('article').filter({ hasText: text });
  await card.getByRole('button', { name: 'Report post' }).click();

  const dialog = reporter.getByRole('dialog', { name: 'Report this post' });
  await dialog.getByRole('radio', { name: 'Spam or misleading' }).check();
  await dialog.getByRole('textbox', { name: 'Report details' }).fill('Same link posted many times');
  await dialog.getByRole('button', { name: 'Send report' }).click();

  await expect(card.getByText('Thanks. Your report was sent to the moderators.')).toBeVisible();
  await expect(dialog).toHaveCount(0);

  // After a reload, reporting the same post again says it was already reported (AC2).
  await reporter.reload();
  await reporter.getByRole('tab', { name: 'Latest' }).click();
  await reporter.getByRole('article').filter({ hasText: text }).getByRole('button', { name: 'Report post' }).click();
  await expect(dialog.getByText('You have already reported this post.')).toBeVisible();
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toHaveCount(0);

  // The post is still in the feed with its text (a report alone hides nothing).
  await expect(reporter.getByRole('article').filter({ hasText: text })).toBeVisible();

  await authorContext.close();
  await reporterContext.close();
});

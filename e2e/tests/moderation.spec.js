// Sprint 6 · M7 (US-56, FR-27): two posts are reported; the Platform Admin (who has Content Moderator rights) opens
// the moderator queue, sees each post with its reason and report count, Warns the author of the first (the author
// gets an in-app "Moderation warning") and Removes the second (it disappears from the feed for everyone).
// A normal user has no Moderation link and /moderation says it is for Content Moderators only.
import { test, expect } from '@playwright/test';
import { logIn, signUp, unique } from './helpers.js';
import { E2E_PLATFORM_ADMIN } from '../platformAdmin.js';

const API = `http://localhost:${process.env.E2E_API_PORT || 5000}/api`;

test('moderator queue: Warn sends an in-app warning, Remove deletes the post', async ({ browser, request }) => {
  const warnText = unique('Buy cheap followers');
  const removeText = unique('Click this scam link');

  // The author publishes two posts.
  const authorContext = await browser.newContext();
  const author = await authorContext.newPage();
  const authorAccount = await signUp(author);
  await author.goto('/feed');
  for (const text of [warnText, removeText]) {
    await author.getByRole('textbox', { name: 'Post text' }).fill(text);
    await author.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(author.getByText('Your post is published.')).toBeVisible();
  }
  // A normal user: no Moderation link, and the page refuses.
  await expect(author.getByRole('link', { name: 'Moderation', exact: true })).toHaveCount(0);
  await author.goto('/moderation');
  await expect(author.getByText('Only a Content Moderator can open the moderator queue.')).toBeVisible();
  await author.goto('/feed');

  // Another user reports both posts (through the API, the report dialog itself is tested in report-post.spec.js).
  const reporterContext = await browser.newContext();
  const reporter = await reporterContext.newPage();
  const reporterAccount = await signUp(reporter);
  const login = await request.post(`${API}/auth/login`, { data: { email: reporterAccount.email, password: reporterAccount.password } });
  expect(login.status()).toBe(200);
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  const feed = await (await request.get(`${API}/posts?limit=50`, { headers })).json();
  const idOf = (text) => feed.posts.find((post) => post.text === text)?._id;
  for (const [text, reason] of [[warnText, 'spam'], [removeText, 'harassment']]) {
    const sent = await request.post(`${API}/posts/${idOf(text)}/report`, { headers, data: { reason } });
    expect(sent.status()).toBe(201);
  }

  // The Platform Admin opens the moderator queue from the sidebar.
  const modContext = await browser.newContext();
  const mod = await modContext.newPage();
  await logIn(mod, E2E_PLATFORM_ADMIN);
  await mod.getByRole('link', { name: 'Moderation', exact: true }).click();
  await expect(mod).toHaveURL(/\/moderation$/);
  await expect(mod.getByRole('heading', { level: 1, name: 'Moderator queue' })).toBeVisible();

  // AC1: each reported post with its reason and report count.
  const warnCard = mod.getByTestId('report-card').filter({ hasText: warnText });
  await expect(warnCard.getByText('1 report', { exact: true })).toBeVisible();
  await expect(warnCard.getByText('Spam or misleading × 1')).toBeVisible();
  await expect(warnCard.getByText(authorAccount.name)).toBeVisible();

  // AC2 Warn: the card leaves the queue and the author gets an in-app warning.
  await warnCard.getByRole('button', { name: `Warn ${authorAccount.name}` }).click();
  await expect(mod.getByRole('status')).toHaveText('Warning sent to the author. Its reports are resolved.');
  await expect(warnCard).toHaveCount(0);

  await author.reload();
  await author.getByRole('button', { name: /^Notifications/ }).click();
  const bellList = author.getByRole('region', { name: 'Notifications list' });
  await expect(bellList.getByText('Moderation warning')).toBeVisible();
  await expect(bellList.getByText(/A Content Moderator warned you about your post/)).toBeVisible();

  // AC2 Remove: asks first, then the post is gone from the queue and from the feed.
  const removeCard = mod.getByTestId('report-card').filter({ hasText: removeText });
  await removeCard.getByRole('button', { name: `Remove post by ${authorAccount.name}` }).click();
  await mod.getByRole('alertdialog').getByRole('button', { name: 'Remove post' }).click();
  await expect(mod.getByRole('status')).toHaveText('Post removed. Its reports are resolved.');
  await expect(removeCard).toHaveCount(0);
  await expect(mod.getByRole('list', { name: 'Recent decisions' }).getByText('Removed').first()).toBeVisible();

  await reporter.goto('/feed');
  await reporter.getByRole('tab', { name: 'Latest' }).click();
  await expect(reporter.getByRole('article').filter({ hasText: warnText })).toBeVisible();
  await expect(reporter.getByRole('article').filter({ hasText: removeText })).toHaveCount(0);

  await authorContext.close();
  await reporterContext.close();
  await modContext.close();
});

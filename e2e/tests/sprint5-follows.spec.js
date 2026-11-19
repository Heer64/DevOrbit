// Sprint 5 M3/M8: author profile link and follow/unfollow from another account.
import { test, expect } from '@playwright/test';
import { signUp, unique } from './helpers.js';

test('Sprint 5 M8: follow and unfollow a post author through their public profile', async ({ page, browser }) => {
  const author = await signUp(page);
  await page.goto('/feed');
  await page.getByRole('tab', { name: 'Latest' }).click();
  const content = unique('Sprint5 follow author');
  const composer = page.getByRole('form', { name: 'Create a post' });
  await composer.getByRole('textbox', { name: 'Post text' }).fill(content);
  await composer.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.locator('article.post-card', { hasText: content })).toBeVisible();

  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const visitor = await context.newPage();
  try {
    await signUp(visitor);
    await visitor.goto('/feed');
    await visitor.getByRole('tab', { name: 'Latest' }).click();
    const post = visitor.locator('article.post-card', { hasText: content });
    await expect(post).toBeVisible();
    await post.locator('a.post-author-name').click();
    await expect(visitor).toHaveURL(/\/people\//);
    await expect(visitor.getByRole('heading', { level: 1, name: author.name })).toBeVisible();
    await visitor.getByRole('button', { name: `Follow ${author.name}`, exact: true }).click();
    await expect(visitor.getByRole('button', { name: `Unfollow ${author.name}`, exact: true })).toBeVisible();
    await visitor.reload();
    await expect(visitor.getByRole('button', { name: `Unfollow ${author.name}`, exact: true })).toBeVisible();
    await visitor.getByRole('button', { name: `Unfollow ${author.name}`, exact: true }).click();
    await expect(visitor.getByRole('button', { name: `Follow ${author.name}`, exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

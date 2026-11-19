
import { test, expect } from '@playwright/test';
import { signUp, unique } from './helpers.js';

// Open the Latest community feed.
async function openLatest(page) {
  await page.goto('/feed');

  await page.getByRole('tab', {
    name: 'Latest',
  }).click();

  await expect(
    page.getByRole('region', { name: 'Posts' })
  ).toBeVisible();
}

// Create a new community post.
async function createPost(page, text) {
  const composer = page.getByRole('form', {
    name: 'Create a post',
  });

  await composer
    .getByRole('textbox', { name: 'Post text' })
    .fill(text);

  await composer
    .getByRole('button', { name: 'Post', exact: true })
    .click();

  await expect(
    composer.getByRole('status')
  ).toContainText('Your post is published');

  return page.locator('article.post-card', {
    hasText: text,
  });
}

// --------------------------------------------------
// Sprint 5 M6/M8
// Create, edit, delete post and switch feed order.
// --------------------------------------------------

test('Sprint 5 M6/M8: publish, edit and delete a post; switch feed order', async ({ page }) => {
  await signUp(page);
  await openLatest(page);

  const original = unique('Sprint5 community post');
  const revised = unique('Sprint5 updated post');

  // Create a post.
  const post = await createPost(page, original);
  await expect(post).toBeVisible();

  // Open post editor.
  await post.getByRole('button', {
    name: 'Edit post',
  }).click();

  // Locate editor directly instead of relying
  // on the original post text after editing.
  const editForm = page.locator('form.post-edit');

  await expect(editForm).toBeVisible();

  await editForm.getByRole('textbox', {
    name: 'Edit post text',
  }).fill(revised);

  // FIX: Save through the edit form.
  await editForm.getByRole('button', {
    name: 'Save',
    exact: true,
  }).click();

  // Verify updated content.
  const updated = page.locator('article.post-card', {
    hasText: revised,
  });

  await expect(updated).toBeVisible();
  await expect(updated).toContainText('edited');

  // Switch to Trending feed.
  await page.getByRole('tab', {
    name: 'Trending',
  }).click();

  await expect(
    page.getByRole('region', {
      name: 'Trending posts',
    })
  ).toBeVisible();

  // Switch back to Latest.
  await page.getByRole('tab', {
    name: 'Latest',
  }).click();

  await expect(updated).toBeVisible();

  // Delete updated post.
  await updated.getByRole('button', {
    name: 'Delete post',
  }).click();

  const dialog = page.getByRole('alertdialog');

  await expect(dialog).toContainText(
    'Delete this post?'
  );

  await dialog.getByRole('button', {
    name: 'Delete post',
  }).click();

  // Confirm deletion.
  await expect(updated).toHaveCount(0);
});

// --------------------------------------------------
// Sprint 5 M7
// Upvote and remove upvote.
// --------------------------------------------------

test('Sprint 5 M7: an upvote can be added and then retracted', async ({ page }) => {
  await signUp(page);
  await openLatest(page);

  const content = unique('Sprint5 voting');

  const post = await createPost(page, content);

  const votes = post.getByRole('group', {
    name: 'Vote on this post',
  });

  // Initial vote state.
  await expect(
    votes.getByRole('button', {
      name: 'Upvote',
      exact: true,
    })
  ).toBeVisible();

  await expect(
    votes.locator('.vote-score')
  ).toHaveText('0');

  // Add upvote.
  await votes.getByRole('button', {
    name: 'Upvote',
    exact: true,
  }).click();

  await expect(
    votes.getByRole('button', {
      name: 'Remove upvote',
    })
  ).toBeVisible();

  await expect(
    votes.locator('.vote-score')
  ).toHaveText('1');

  // Remove upvote.
  await votes.getByRole('button', {
    name: 'Remove upvote',
  }).click();

  await expect(
    votes.getByRole('button', {
      name: 'Upvote',
      exact: true,
    })
  ).toBeVisible();

  await expect(
    votes.locator('.vote-score')
  ).toHaveText('0');
});

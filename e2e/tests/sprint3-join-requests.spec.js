
import { test, expect } from '@playwright/test';
import { signUp, createProject } from './helpers.js';

test('Sprint 3 M2: owner approves a public project join request', async ({ page, browser }) =>{
  await signUp(page);

  const project = await createProject(page, {
    visibility: 'Public',
  });

  const visitorContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });

  const visitorPage = await visitorContext.newPage();

  try {
    const visitor = await signUp(visitorPage);

    await visitorPage.goto(`/discover/${project.id}`);

    const joinCard = visitorPage.getByRole('region', {
      name: 'Join this project',
    });

    await expect(joinCard).toBeVisible();

    await joinCard.getByLabel('Message to the project team')
      .fill('I would like to contribute to this project.');

    await joinCard.getByRole('button',{
      name: 'Request to join',
    }).click();

    await expect(joinCard.getByRole('status'))
      .toContainText('Request sent');

    await page.reload();

    const requests = page.locator('.join-requests-panel');

    await expect(requests.getByText(visitor.name)).toBeVisible();

    await requests.getByRole('button', {
      name: `Approve ${visitor.name}`,
    }).click();

    await expect(requests.getByRole('status'))
      .toContainText('joined as Contributor');

    await visitorPage.goto(`/project/${project.id}`);

    await expect(visitorPage.getByRole('heading', {
      name: project.name,
      level: 1,
    })).toBeVisible();
  } finally {
    await visitorContext.close();
  }
});
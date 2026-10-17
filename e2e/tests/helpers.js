// Shared steps for the end-to-end tests. Every test makes its own users and projects,
// with unique names, so tests never depend on each other or on leftover data.
import { expect } from "@playwright/test";

let counter = 0;
export function unique(prefix) {
  counter += 1;
  return `${prefix} ${Date.now().toString(36)}${counter}`;
}

// Date-only string N days from today, in the format of <input type="date">.
export function dateInDays(days) {
  const now = new Date();
  const date = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + days,
  );
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export async function signUp(page, name = unique("Tester")) {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@example.com`;
  const password = "correct horse battery";

  await page.goto("/signup");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  return { name, email, password, firstName: name.split(" ")[0] };
}

export async function logIn(page, { email, password }) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in to DevOrbit" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

// Creates a project from the sidebar and opens it. Returns the project's database id.
export async function createProject(
  page,
  { name = unique("Project"), visibility = "Private", description = "" } = {},
) {
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .first()
    .click();
  await page.getByPlaceholder("e.g. CampusConnect").fill(name);
  if (description)
    await page
      .getByPlaceholder("What are you building, and who is it for?")
      .fill(description);
  await page.getByRole("radio", { name: new RegExp(visibility) }).check();
  await page.getByRole("button", { name: /Create workspace/ }).click();

  // The modal closes and goes back to the dashboard, where the new card appears.
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("button", { name: `Open ${name}` }).click();
  await expect(page).toHaveURL(/\/project\/[a-f0-9]{24}$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return { name, id: page.url().split("/").pop() };
}

// Adds a task through the task form on the project page.
export async function addTask(
  page,
  { title, label = "", dueDate = "", assignToMe = false, ownerName = "" },
) {
  await page
    .getByRole("button", { name: "Add task", exact: true })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Add a task" })).toBeVisible();
  // Look only inside the task form: the task list also has a "Filter by assignee" dropdown.
  const form = page.locator("form.task-modal");
  await form.getByPlaceholder("What needs to get done?").fill(title);
  if (label)
    await form.getByPlaceholder("e.g. Frontend, Bug, Docs").fill(label);
  if (dueDate) await form.getByLabel("Due date").fill(dueDate);
  if (assignToMe) {
    const assignee = form.getByLabel("Assignee");
    // Members load from the team API; wait until "<name> (you)" is an option.
    await expect(
      assignee.locator("option", { hasText: `${ownerName} (you)` }),
    ).toHaveCount(1);
    await assignee.selectOption({ label: `${ownerName} (you)` });
  }
  await form.getByRole("button", { name: /Create task/ }).click();
  await expect(page.getByRole("heading", { name: "Add a task" })).toBeHidden();
}

export const taskRow = (page, title) =>
  page.locator("article.task-row", { hasText: title });
export const boardColumn = (page, label) =>
  page.getByRole("region", { name: `${label} column` });

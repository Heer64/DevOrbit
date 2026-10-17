# DevOrbit end-to-end tests

These tests run the **real** app: the Express API with a real MongoDB, plus the built React frontend. Playwright then clicks through it in Chromium the way a user would. They catch problems that the unit tests can't, such as the frontend expecting something the backend no longer sends.

| Test file | Journey |
|---|---|
| `tests/auth.spec.js` | Sign up, log out, log back in, protected pages, reload keeps you signed in, wrong password |
| `tests/tasks-kanban.spec.js` | Create a project, add a labelled task, move it on the Kanban board, check it was saved and logged in Activity, edit the label |
| `tests/dashboard.spec.js` | A task due tomorrow and assigned to me shows in Upcoming deadlines, My tasks and "Assigned to me"; completing a task updates "Tasks completed" |
| `tests/discover.spec.js` | A second user finds a Public project and its owner on Discover, never a Private one, and can open it |

`tests/helpers.js` has the shared steps (`signUp`, `logIn`, `createProject`, `addTask`, …).

## Run them on your computer

You need Node.js. **You don't need MongoDB installed:** if `E2E_MONGODB_URI` isn't set, a temporary in-memory database is started, so your real data is never touched.

```bash
npm install --prefix backend
npm install --prefix frontend
npm install --prefix e2e
cd e2e
npx playwright install chromium   # first time only, downloads the browser
npm test                          # starts API + frontend, runs all tests, stops everything
```

Other ways to run them:
- `npm run test:headed` watches the browser while it runs.
- `npm run test:ui` opens Playwright's UI: pick a test, step through it, see each screen.
- `npx playwright test tests/discover.spec.js` runs one file.
- `npm run report` opens the HTML report after a CI-style run.

Ports 5000 (API) and 5173 (frontend) must be free, so **stop `npm run dev` first**. If something else uses them (on macOS, port 5000 is often taken by AirPlay Receiver), pick other ports:
```bash
E2E_API_PORT=5055 E2E_WEB_PORT=5199 npm test
```
On Windows PowerShell: `$env:E2E_API_PORT=5055; $env:E2E_WEB_PORT=5199; npm test`

## In CI

The `e2e` job in `.github/workflows/ci.yml` runs after the unit-test job passes. It uses the MongoDB service container. If a test fails, download the **playwright-report** artifact from the run page: it has a screenshot, a video and a trace (open it with `npx playwright show-trace <file>.zip`) for each failure.

Commit `e2e/package-lock.json` after your first `npm install --prefix e2e`, so CI installs exactly the same versions.

## Adding tests each sprint

Add 1–2 tests for each sprint's main feature, for example Sprint 3: send a chat message, see the @mention notification. Keep E2E to **important user journeys**. Detailed rules and edge cases belong in the backend and Vitest unit tests.

Guidelines:
- **Every test creates its own users and projects.** Use `signUp()` and `unique()` from `helpers.js`, and never rely on data from another test.
- **Find elements the way a user would:** `getByRole`, `getByLabel`, `getByPlaceholder`, `getByText`. Avoid CSS classes where you can. If a button has no visible text, give it an `aria-label` in the component. That helps screen-reader users too.
- **Never use fixed waits** like `waitForTimeout`. `expect(...).toBeVisible()` already waits up to 10 seconds.
- **For two users at once**, open two contexts with `browser.newContext()` (see `discover.spec.js`).

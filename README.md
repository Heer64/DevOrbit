# DevOrbit

DevOrbit is a web app where student and developer teams can work on projects together. You can chat with your team, manage tasks, see your GitHub activity, and ask an AI assistant questions about your project. There is also a public side where people can post, vote, follow each other and find projects to join or collaborate.

This project is built for our Software Engineering course.

---

## What the app does

- **Accounts and profiles:** sign up, log in, and add a photo, bio and skills to your profile
- **Projects:** create public or private projects and give members roles (Owner, Admin, Contributor, Viewer)
- **Team chat:** project channels with @mentions, plus direct messages
- **Tasks:** create and assign tasks, group them into milestones, and track them on a Kanban board
- **Activity Feed:** one feed that shows messages, task updates and GitHub commits, issues and pull requests
- **AI Copilot:** ask questions about your project and get a "Catch Me Up" summary of what you missed
- **Public side:** discover public projects, share posts, vote, follow people, and build a portfolio

---

## Tech Stack

**Frontend**
- HTML
- CSS
- JavaScript
- React

**Backend**
- Node.js
- Express.js
- MongoDB

**Testing**
- Jest
- Vitest

**Tools and Hosting**
- Docker
- CI (automated tests before merging)
- Vercel (frontend hosting)
- Render (backend hosting)
- MongoDB Atlas (database hosting)

---

## Project Structure

```
devorbit/
├── client/        # Frontend (React)
├── server/        # Backend (Node + Express)
├── docs/          # Project documents
├── .env.example   # Example environment variables
└── README.md
```
---

## Getting Started

You will need Node.js and a MongoDB connection (local or Atlas).

```bash
# clone the repo
git clone <repo-link>
cd devorbit

# install dependencies
cd server && npm install
cd ../client && npm install
```

Copy `.env.example` to `.env` in the server folder and fill in your own values. Please don't push your `.env` file to GitHub.

Then start both parts:

```bash
# backend
cd server
npm run dev

# frontend (in a new terminal)
cd client
npm run dev
```

To run the tests:

```bash
cd server && npm test      # Jest
cd client && npm run test  # Vitest
```

---

## Deployment

- **Frontend:** hosted on Vercel
- **Backend:** hosted on Render
- **Database:** MongoDB Atlas

---

## Sprint 1

**Goal:** get the basics working so users can sign up, set up a profile, create a project, and have roles that control what they can do.

**User stories**

| Story | What it is |
|-------|-----------|
| US-01 | Register an account |
| US-02 | Log in |
| US-03 | Log out |
| US-05 | Edit my profile |
| US-08 | Create a project |
| US-09 | Assign project roles |

**What we will build**

- Project setup: repo, branches, and a basic way to run tests automatically
- Sign up, log in and log out, with passwords saved as a salted hash (never plain text)
- Profile page where users can add a photo (JPEG or PNG, up to 2 MB), a bio (up to 500 characters) and up to 10 skill tags
- Create a project with a name, description, domain and Public or Private visibility. The creator becomes the Owner

**Sprint 1 is done when**

- A new user can register, log in, edit their profile and create a project
- Role rules work (for example, a Viewer can't change roles)
- Tests pass and the setup steps work on a fresh clone

---

## Sprint 2 — Milestones and activity (Pair C)

**Milestones** (`/api/projects/:id/milestones`)

| Call | Who | Notes |
|------|-----|-------|
| `GET /` | Members, and visitors of a Public project | Each milestone has `taskCount`, `doneCount`, `progress` (0–100) and `completed`, worked out from its tasks |
| `POST /` | Owner, Admin | `{ title, description?, dueDate? }` |
| `PATCH /:milestoneId` | Owner, Admin | any of the fields above; `dueDate: null` clears it |
| `DELETE /:milestoneId` | Owner, Admin | tasks are kept and detached |

Tasks take an optional `milestone` (an ID from the same project) on create and edit, and `GET /api/projects/:id/tasks?milestone=<id>|none` filters by it.

**Activity**

| Call | Who | Notes |
|------|-----|-------|
| `GET /api/projects/:id/activity?limit=30&before=<date>` | Members only | newest first; pass `nextBefore` back as `before` for older events |
| `GET /api/activity/me?limit=10` | Signed-in user | latest events across all of your projects, with `project { name, color }` |

Events are written by `logActivity()` in `backend/src/lib/activity.js` for project create/update, member add/role change/remove/leave, task create/status/assign/edit/delete, and milestone create/edit/delete. Logging never breaks the main request.

## Sprint 2 — Kanban board (Pair D: US-27, US-28)

The Tasks tab has a **List / Board** switch. The board has four columns: **To Do, In Progress, Blocked, Done**. You can drag a card, or use its "Move to" menu, to change the status. Moves show up right away and are put back if the server refuses them. Clicking a card opens it (for now in the task edit modal, which is read-only for Viewers).

**Statuses:** `To do`, `In progress`, `Blocked`, `Done` (`Blocked` added for FR-7b).

**Versions:** every task has a `version` number. It starts at 0 and goes up by 1 on every saved change. Clients send the version they loaded, and a mismatch returns **409** so nothing is silently overwritten (NFR-5a).

| Call | Who | Notes |
|------|-----|-------|
| `GET /api/projects/:id/tasks/:taskId` | Members, and visitors of a Public project | `{ task }` |
| `PATCH /api/projects/:id/tasks/:taskId/status` | Owner, Admin, Contributor | body `{ status, version }` → `{ task }`; **409** `{ message: "This task was changed by someone else.", task: <latest> }`; 403 for Viewers and non-members |
| `PATCH /api/projects/:id/tasks/:taskId` | Owner, Admin, Contributor | unchanged, but now bumps `version` on every real change and accepts an optional `version` (409 when stale) |

**Live updates (Socket.IO, same port as the API):**

- Connect with `io(<API origin>, { auth: { token: <access token> } })`.
- Emit `project:join { projectId }`. The ack is `{ ok, role }`. Joining is allowed for members of any project and anyone for a Public project.
- Listen for `task:updated { projectId, task }`. It is sent after every saved status change or edit. Clients ignore events whose `task.version` is not newer than what they already have.
- The server code is in `backend/src/lib/realtime.js`. Add future real-time events (e.g. chat) there rather than starting a second Socket.IO server.

**Demo without a backend:** sample projects use `frontend/src/taskMock.js`. In the browser console, run `localStorage.setItem('devorbit_mock_move', 'reject')` to see a failed move roll back, or `'conflict'` to see the 409 message. Run `localStorage.removeItem('devorbit_mock_move')` to go back to normal.

**Tests:** `npm --prefix backend test` (includes `kanban.test.js`, `realtime.test.js`) and `npm --prefix frontend test` (Vitest).

## Sprint 2 — leftovers

These finish the parts of Sprint 2 that were still missing after Pairs A–D merged.

**Task label (US-21).** Tasks have an optional `label` (free text, trimmed, up to 30 characters, default `''`) next to the existing Priority. It is accepted by `POST` and `PATCH /api/projects/:id/tasks` (a longer label returns **400**), returned with every task, shown on list rows and Kanban cards, and edited in the task form. Changing it is logged as a `task.updated` activity.

**Dashboard task views** (`/api/tasks`, signed-in user, only projects you are a member of)

| Call | Returns | Notes |
|------|---------|-------|
| `GET /api/tasks/upcoming?days=7&limit=20` | `{ tasks, days }` | Open (not Done) tasks due from today up to `days` ahead (1–30, default 7), soonest first. Overdue tasks are not included. (US-23) |
| `GET /api/tasks/mine?limit=8` | `{ tasks, total }` | Open tasks assigned to you; dated tasks first, undated last |
| `GET /api/tasks/stats` | `{ completedLast7Days, openAssignedToMe }` | Used by the dashboard stat cards |

Each task includes `project { _id, name, color }` and `assignee`. The dashboard now shows **Upcoming deadlines** and **My tasks** panels, and the "Tasks completed" and "Assigned to me" cards use these numbers. Demo users still see sample data.

**Discover on real data.** For signed-in users the Discover page loads `GET /api/projects/discover?q=` (Public projects only) and `GET /api/profile/people?q=` (people with `profileDiscoverable` on, never yourself). Search is debounced (300 ms) and done by the API; the domain filter is built from the loaded projects; sort is "Recently active" or "Alphabetical". Follow and Save stay demo-only until those features have an API. Demo users keep the sample cards.

**CI** now runs the frontend tests (`npm test --prefix frontend`) before the frontend build.

**End-to-end tests** (`e2e/`, Playwright) run the real API, a real MongoDB and the built frontend in Chromium, and click through the main journeys: sign up and log in, a labelled task on the Kanban board, dashboard deadlines and stats, and Discover with two users. They run in CI as a second job after the unit tests pass, and locally with `npm run test:e2e` (no MongoDB install needed). See `e2e/README.md` for how to run them and how to add 1–2 tests per sprint.

**Tests:** `backend/test/tasks.test.js` (label), `backend/test/myTasks.test.js`, `backend/test/discover.test.js`; `frontend/src/components/TasksPanel.label.test.jsx`, `frontend/src/components/DashboardTasks.test.jsx`, `frontend/src/pages/DashboardPage.test.jsx`, `frontend/src/pages/DiscoverPage.test.jsx`.

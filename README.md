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

## Sprint 2 — final (channels and live task list)

This closes Sprint 2. It adds the project channels that Sprint 3 builds on (threads, mentions, feed, decisions).

**Project channels (US-16, FR-5)** (`/api/projects/:id/channels`, members only, even for a Public project)

| Call | Who | Notes |
|------|-----|-------|
| `GET /` | Members | `{ channels, membershipRole }`; `#general` is created the first time |
| `POST /` | Owner, Admin | `{ name, description? }` → 201 `{ channel }`; names are lowercase and unique per project |
| `GET /:channelId/messages?limit=50&before=<date>` | Members | `{ messages (oldest first), nextBefore }` |
| `POST /:channelId/messages` | Owner, Admin, Contributor | `{ body }` → 201 `{ message }`; Viewers get **403** but can still read |

The project page has a **Chat** tab. New messages are pushed live as `message:created { projectId, channelId, message }` to a members-only room. Visitors who are watching a Public project's board never receive messages.

**Links into the project:** `/project/<id>?tab=tasks&task=<taskId>` opens a task. `/project/<id>?tab=chat&channel=<channelId>` opens a channel.

**Live task list:** besides `task:updated`, the server now sends `task:created { projectId, task }` and `task:deleted { projectId, taskId }`. Tasks created or deleted by someone else appear or disappear without a reload. If the deleted task is open, its window closes with a notice.

**Tests:** `backend/test/channels.test.js`, `backend/test/realtime.test.js` (create/delete events), `frontend/src/components/ChatPanel.test.jsx`, `frontend/src/components/TasksPanel.board.test.jsx`.

## Sprint 3 — M7 Part 1: notification storage (US-30)

Storage and read access for in-app notifications. Creating them automatically (mentions, assignments, deadlines), pushing them live and the notification list UI come in M7 Part 2.

**Model** (`backend/src/models/Notification.js`): `recipient` (User), `type` (`mention` | `assignment` | `deadline`, shown as Mention / Assignment / Deadline), `project`, `actor` (User or `null` for system notifications such as Deadline), `summary` (≤ 300), `targetType` (`task` | `message` | `comment`), `targetId`, `targetLabel` (≤ 200), `link` (in-app path starting with one `/`), `read` (default `false`), `readAt` (default `null`), optional `dedupeKey`, `createdAt` / `updatedAt`.

**Storing one:** `createNotification({...})` in `backend/src/lib/notifications.js`. It only notifies current project members, skips the actor's own actions, never throws, and with a `dedupeKey` (e.g. `deadline:<taskId>:<dueDate>`) never stores the same notification twice for one user. `taskLink()` and `messageLink()` build the deep links ProjectPage already opens.

**API** (`/api/notifications`, signed-in user, own notifications only)

| Call | Response | Notes |
|------|----------|-------|
| `GET /api/notifications?limit=20&before=<date>&unread=true` | `{ notifications, nextBefore, unreadCount }` | newest first; `limit` 1–50; pass `nextBefore` back as `before`; each has `actor { name, username, avatarUrl }` and `project { name, color }` |
| `PATCH /api/notifications/:notificationId/read` | `{ notification, unreadCount }` | safe to repeat (keeps the first `readAt`); another user's notification answers **404** |

Only projects you are a member of **right now** count: if you are removed from a project or leave it, its notifications disappear from the list and from `unreadCount` (and marking one read answers **404**). The rows are kept, so they show again if you are added back.

**Tests:** `backend/test/notifications.test.js`.

## Sprint 3 — M3: remove a member and leave a project (US-13, US-14)

Builds on the existing `DELETE /api/projects/:id/members/:userId` (US-09), which already removed members, let members leave, protected the Owner and logged `member.removed` / `member.left`.

**What M3 adds**

- **Access ends at once, also live.** After a removal or a leave, the person's open browser tabs are taken out of the project's live rooms: no more chat messages or activity, and for a Private project no task updates either (a Public board stays watchable, like for any visitor). They receive `project:access-removed { projectId, reason: 'removed' | 'left' }`, and the project page tells them and reloads (Private → "no access", Public → visitor view). Rejoining a Private project's room is refused.
- **History stays.** Their messages, created/assigned tasks and activity remain and keep their name. Tasks still assigned to them can be edited normally.
- **Confirmation first.** Removing a member and leaving a project both open a confirmation dialog explaining what happens (`ConfirmDialog.jsx`). Errors from the server are shown in the dialog.
- **Only Owner.** The Owner cannot be removed (**403** "The project Owner cannot be removed. Every project needs an Owner."). If the Owner tries to leave, the dialog and the API (**403**) ask them to transfer ownership to another member first.

**Tests:** `backend/test/removeLeave.test.js`, `frontend/src/components/TeamPanel.test.jsx`.
## Sprint 3 — M2: join requests (US-12, US-47)

A signed-in non-member can ask to join a **Public** project; the project's Owner or an Admin approves or rejects it.

**Model** (`backend/src/models/JoinRequest.js`): `project`, `user` (who asked), `message` (optional, ≤ 500), `status` (`Pending` | `Approved` | `Rejected`, default `Pending`), `role` (set on approval), `decidedBy`, `decidedAt`, `createdAt` / `updatedAt`. A unique index allows only one pending request per person per project.

**API** (`/api/projects/:id/join-requests`, signed in)

| Call | Who | Notes |
|------|-----|-------|
| `POST /` | Non-member of a Public project | `{ message? }` → 201 `{ joinRequest }`. **409** if already a member, already pending, or rejected less than 7 days ago (then also `canRequestAgainAt`); **403** for a Private project; **400** message over 500 characters |
| `GET /me` | Anyone who can see the project | `{ joinRequest (latest or null), canRequestAgainAt, isMember }` |
| `GET /?status=Pending` | Owner, Admin | `{ joinRequests }`, oldest first; `status` = `Pending` (default), `Approved`, `Rejected` or `all` |
| `POST /:requestId/approve` | Owner, Admin | `{ role? }` (default `Contributor`; Owner may give Admin/Contributor/Viewer, Admin may give Contributor/Viewer) → `{ joinRequest }`; the person becomes a member |
| `POST /:requestId/reject` | Owner, Admin | → `{ joinRequest }`; the person cannot ask again for 7 days |

Approve/reject answer **409** if the request was already decided (only one decision wins, even if two managers click at once) and **404** if it belongs to another project. Each step is logged in the Activity Feed (`join_request.created`, `.approved`, `.rejected`).

**UI:** a visitor of a Public project sees a **Request to join** card (optional message, then "Request sent", or the date they can ask again after a rejection). Owners and Admins see a **Join requests** panel under Team & roles with a role picker, Approve and Reject; the team list reloads after an approval. A logged-out user who opens a project link is sent to log in and then returned to that page.

**Tests:** `backend/test/joinRequests.test.js`, `frontend/src/components/JoinRequests.test.jsx`, `frontend/src/pages/LoginPage.test.jsx`.

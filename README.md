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

You will need **Node.js 20.19 or newer** (22 recommended) and a MongoDB connection (local MongoDB or Atlas).

```bash
# clone the repo
git clone https://github.com/Heer64/DevOrbit.git
cd DevOrbit

# install dependencies (each folder has its own package.json)
npm install                    # root: lint and format tools
cd backend && npm install
cd ../frontend && npm install
cd ..
```

Copy `backend/.env.example` to `backend/.env` and fill in your own values (at least `MONGODB_URI` and a 32+ character `JWT_SECRET`). Please don't push your `.env` file to GitHub.

**Demo data (optional).** Fill an empty development database with a small team, two projects, milestones, tasks in every status and chat messages:

```bash
cd backend
npm run seed               # does nothing if the demo data is already there
npm run seed -- --reset    # removes only the demo accounts and their projects, then adds them again
```

It prints the demo logins (`aarav@seed.devorbit.test` and others, password `DevOrbit@2026`, or `SEED_PASSWORD` from `backend/.env`). It never touches other data and refuses to run when `NODE_ENV=production`.

Then start both parts:

```bash
# backend
cd backend
npm run dev

# frontend (in a new terminal)
cd frontend
npm run dev
```

To run the tests and checks:

```bash
cd backend && npm test     # node:test + supertest (starts an in-memory MongoDB)
cd frontend && npm test    # Vitest
npm run lint               # in the repository root: ESLint, errors must be 0
npm run test:e2e           # in the repository root: Playwright end-to-end tests (see e2e/README.md)
```

**Team conventions.** Every change goes through a branch and a pull request into `main` (the PR template in `.github/pull_request_template.md` lists the checks). Format the files you create or rewrite with `npm run format -- <file> <file>` in the root (Prettier settings: `.prettierrc.json`; editor basics: `.editorconfig`).

---

## Deployment

- **Frontend:** hosted on Vercel
- **Backend:** hosted on Render
- **Database:** MongoDB Atlas
- **Render environment:** set `TRUST_PROXY=1` on the API service (Render puts one proxy in front of it). Without it, every user shares one rate-limit bucket. See *Sprint 6 — M1* below.
- **AI Copilot:** set `LLM_API_KEY` (and `LLM_PROVIDER` / `LLM_MODEL` if not using the defaults) on the API service. Without a key the Copilot shows *AI temporarily unavailable* and everything else works. See *Sprint 6 — M3* below.

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

## Sprint 1 — remaining plan items (domain list, starting members, photo storage, team setup)

These close the Sprint 1 plan lines that were still open after Sprint 4.

**Domain from an agreed fixed list (line E).** The API now only accepts these domains: Developer tools, Education, Climate tech, Research, Design systems, Backend, Community, Other (`backend/src/lib/projectSetup.js`, same list as the create form in `frontend/src/domains.js`). Matching ignores letter case and spaces and stores the listed spelling; a missing domain becomes **Other**; anything else answers **400** `Domain must be one of: …`. On edit (`PATCH /api/projects/:id`) a new domain must be listed, but sending back a project's current domain unchanged is allowed, so projects saved before the list (e.g. "General") can still be edited.

**Optional starting members and roles (line E).** The create-project form has **Starting members (optional)**: add rows of *email or @username* + role (**Admin, Contributor, Viewer**; default Contributor; up to 20). `POST /api/projects` accepts them as `members: [{ identifier, role }]` and adds them straight away, like adding a member (US-09); each one gets a `member.added` feed entry. The whole list is checked before anything is saved: an unknown person (**404**, with `unknown: [...]`), the creator, the same person twice, the Owner role or a bad role (**400**) means **no project is created**. The response also has `startingMembers: [{ userId, name, username, role }]`.

**Profile photos in persistent storage (line D).** Photos were saved in `backend/uploads/avatars`, which Render wipes on every redeploy. They are now stored in **MongoDB GridFS** (bucket `avatars`), like project files (US-37). Rules (JPEG/PNG, 2 MB, checked by file signature) and the URL format `/uploads/avatars/<name>` are unchanged, so the frontend did not change. The server reads photos from GridFS first and falls back to the old folder for photos uploaded before the change. Replacing or removing a photo deletes it from GridFS (and from the old folder if it is there).

**Team setup (line A).**
- **Pull-request template:** `.github/pull_request_template.md` (what, stories, how to test, checklist).
- **Lint rules:** `eslint.config.mjs` (ESLint core rules that catch real mistakes; no style rules). Run `npm run lint` in the root; it must show **0 errors** (a few warnings for unused imports in older files are expected).
- **Format rules:** `.prettierrc.json`, `.prettierignore`, `.editorconfig`. Existing files were not reformatted, to avoid huge diffs; format the files you create or rewrite.
- **Database setup / seed:** `npm run seed` in `backend/` (see Getting Started). Code: `backend/src/seed/seedData.js`, `backend/scripts/seed.js`.

**Files:** `backend/src/lib/projectSetup.js` (new), `backend/src/routes/projects.js`, `backend/src/models/Project.js` (default domain Other), `backend/src/lib/avatar.js`, `backend/src/app.js` (photo route), `backend/src/seed/seedData.js` + `backend/scripts/seed.js` (new), `frontend/src/domains.js` (new), `frontend/src/components/AppShell.jsx`, `frontend/src/styles.css`; root `package.json`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `.editorconfig`, `.github/pull_request_template.md`. Two one-line lint fixes in `frontend/src/pages/ProjectPage.jsx` (duplicate import) and `frontend/src/components/markdown.jsx` (intended control-character check). `e2e/package.json` / `e2e/package-lock.json` no longer link the root folder as a dependency (`devorbit-workspace: file:..`, added by accident earlier); with the root now having its own dev tools, that link could make `npm ci` in `e2e/` fail.

**Tests:** `backend/test/projectSetup.test.js` (rules, no database), `backend/test/projectCreate.test.js` (API: domain list, edit, starting members, nothing created on a bad list), `backend/test/seed.test.js`, `backend/test/profile.test.js` (photos stored in GridFS, old folder still served, replace/remove clean up), `backend/test/avatar-lib.test.js`, `frontend/src/components/CreateProject.test.jsx`.

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

## Sprint 3 — M4: thread replies and task comments (US-17, US-20)

**Thread replies (US-17, FR-5).** Any channel message can get a thread. Replies are `Message` rows with `parentMessage` set, so they are left out of the channel history (`GET .../messages` now lists top-level messages only). The parent keeps `replyCount` and `lastReplyAt`, increased atomically (`$inc`) so replies sent at the same moment are all counted. Messages saved before threads existed count as top-level with 0 replies; nothing needs migrating. Threads are one level deep.

| Call (`/api/projects/:id/channels/:channelId/messages/:messageId/replies`) | Who | Notes |
|------|-----|-------|
| `GET /?limit=100&after=<date>` | Members | `{ parent, replies (oldest first), nextAfter }`; pass `nextAfter` back as `after` |
| `POST /` | Owner, Admin, Contributor | `{ body }` (≤ 4000) → 201 `{ reply, parent: { _id, replyCount, lastReplyAt } }`; Viewers **403**; replying to a reply **400** |

**Task comments (US-20, FR-7).** `backend/src/models/TaskComment.js`: `project`, `task`, `author`, `body` (≤ 2000), `mentions` (Users), `createdAt`. Comments are members-only, like channels: a Public project's visitors see its tasks but not the comments.

| Call (`/api/projects/:id/tasks/:taskId/comments`) | Who | Notes |
|------|-----|-------|
| `GET /?limit=100&after=<date>` | Members | `{ comments (oldest first), nextAfter }`; each has `author { name, username, avatarUrl }` and `mentions [{ name, username }]` |
| `POST /` | Owner, Admin, Contributor | `{ body }` → 201 `{ comment }`; Viewers **403** |

**@mentions.** Write `@username` in a comment. `backend/src/lib/mentions.js` matches only **current project members** (emails such as `a@b.com` are not mentions). Each mentioned member gets a **Mention** notification through `createNotification()` (M7 Part 1 storage) that opens the task. Mentioning yourself notifies no one, and mentioning someone twice notifies them once. The helper is ready for chat mentions (US-18).

**Live and feed.** New socket events, members only: `message:reply` `{ projectId, channelId, parentId, reply, replyCount, lastReplyAt }` and `comment:created` `{ projectId, taskId, comment }`. Replies are logged as `message.posted` ("replied in a thread in #general: …") and comments as `comment.created`.

**UI.** In Chat, each message shows **Reply** (on hover) or **N replies · Last reply …**. Clicking it opens the thread beside the channel (stacked below on small screens). The task window has a **Comments** section showing author, relative time (exact time on hover) and highlighted mentions. Typing `@` suggests project members (↑/↓, Enter/Tab to pick, Esc to close). Viewers read only. Demo projects (mock tasks) show no comments.

**Tests:** `backend/test/threads.test.js`, `backend/test/taskComments.test.js`, `frontend/src/components/Threads.test.jsx`, `frontend/src/components/TaskComments.test.jsx`.

## Sprint 3 — M4 extra: @mentions in chat (US-18)

**Mentions in chat.** The channel message box and the thread reply box suggest project members when you type `@`, the same as task comments. A sent message stores `mentions` (`[{ _id, name, username }]`, returned by the channel and thread APIs) and highlights them. Each mentioned member gets a **Mention** notification: from a channel message it opens `?tab=chat&channel=…&message=…`, and from a thread reply it adds `&thread=<parentId>`, so the thread opens too. Mentions and notifications use `backend/src/lib/mentions.js` (`findMentionedMembers`, `notifyMentions`).

**Tests:** `backend/test/mentionNotifications.test.js`, `frontend/src/components/ChatMentions.test.jsx`.

## Sprint 3 — M5: task due dates and the 24-hour deadline query (US-23)

**What a due date is.** A calendar day, not a moment. The API stores it as midnight UTC of that day (`"2026-10-28"` → `2026-10-28T00:00:00.000Z`), so every member sees the same day in any timezone. A task is due at the **end** of that day (UTC): it is overdue after that, unless it is Done. All rules are in `backend/src/lib/dueDates.js`.

**Setting and editing** (`POST` / `PATCH /api/projects/:id/tasks`, Owner, Admin, Contributor)

| `dueDate` sent | Result |
|------|--------|
| `"YYYY-MM-DD"` | saved as that day (leap days fine, `2026-02-30` is **400**) |
| a timestamp that is exactly midnight UTC (what the API returns) | same day, so a task can be sent back unchanged; sending the same day again is not a change (no new `version`) |
| any other timestamp, e.g. `2026-10-28T00:00:00+05:30` | **400** "Due date must be a calendar date (YYYY-MM-DD)." (turning local midnight into a day would quietly give 27 Oct) |
| a year before 2000 or after 2100 | **400** |
| `null` or `""` | clears it (`PATCH`) |

A due-date-only edit appears in the Activity Feed as `set the due date of "X" to Oct 28, 2026` or `removed the due date of "X"`.

**Deadline query: due within 24 hours, not Done (FR-10).** A task qualifies when it is not Done and `now < deadline < now + 24 h` (exactly 24 h away does not count; a passed deadline is overdue instead). With midnight-UTC dates this is the whole due day in UTC (05:30 to 05:30 in India).

- `findTasksDueSoon({ now, projectIds, assignee, assignedOnly = true, limit })` in `backend/src/lib/deadlines.js`, for **M7** to send Deadline notifications. Each task has `assignee`, `project { name, color }`, `deadline` and `dedupeKey` (`deadline:<taskId>:<dueDate ISO>`, ready for `createNotification`: one notification per task and day, and a new one if the date moves).
- `GET /api/tasks/due-soon` → `{ tasks, windowHours: 24, now }`: the caller's own open tasks in that window, from their current projects only.

**On screen.** The day is read in UTC (`formatDue`), so a teammate in California still sees Oct 28; "today", "tomorrow" and "overdue" use the viewer's own calendar day (`isOverdue`, `frontend/src/dueDates.js`). Task rows and Kanban cards now show `Oct 28 · due today` / `Oct 29 · due tomorrow` (orange) besides `Oct 27 · overdue` (red); Done tasks are never overdue. In the task form the date has a **Clear** button and a line underneath that says how the day will read ("Due tomorrow (Oct 29).", "Oct 20 has already passed."). Viewers see the date but cannot change it. The dashboard's Upcoming deadlines panel is unchanged.

**Tests:** `backend/test/dueDates.test.js` (parsing, timezones, leap days, exact 24-hour boundaries, the Mongo range checked against the rule for every hour of a month), `backend/test/dueDateApi.test.js` (set/clear/400s/activity, the deadline query with a fixed clock, `GET /api/tasks/due-soon`), `frontend/src/dueDates.test.js` (India, California, midnight and DST boundaries), `frontend/src/components/TaskDueDates.test.jsx` (rows, cards, form, Clear, Viewer).

## Sprint 3 — M1: project invitations (US-10, US-11)

An Owner or Admin invites an **existing** DevOrbit user with a role. The person joins only after they **accept**; they can also **decline**. A pending invitation expires after **7 days**.

**Model** (`backend/src/models/Invitation.js`): `project`, `invitee` (User), `invitedBy` (User), `role` (`Admin` | `Contributor` | `Viewer`, default `Contributor`), `status` (`Pending` | `Accepted` | `Declined` | `Expired`), `expiresAt` (sent + 7 days), `respondedAt`, `createdAt` / `updatedAt`. A unique index allows only one pending invitation per person per project. A Pending invitation past `expiresAt` is reported as `Expired` straight away; the row is stored as `Expired` the next time it is touched, which frees the slot for a new invitation.

**Owner / Admin** (`/api/projects/:id/invitations`)

| Call | Notes |
|------|-------|
| `POST /` | `{ identifier, role? }` → 201 `{ invitation }`. `identifier` is an email or username (`@name` is fine, any case). Owner may invite as Admin/Contributor/Viewer, Admin as Contributor/Viewer (same rules as US-09). **409** already a member or already has a pending invitation (nothing is created); **404** no such user; **400** no identifier or bad role; **403** Contributors, Viewers, non-members |
| `GET /?status=all` | `{ invitations }`, newest first; `status` = `all` (default), `Pending`, `Accepted`, `Declined`, `Expired`. This is where the inviter sees that an invitation was declined |

**Invited user** (`/api/invitations`)

| Call | Notes |
|------|-------|
| `GET /?status=Pending` | `{ invitations }` — my invitations, newest first (same status values) |
| `POST /:invitationId/accept` | → `{ invitation, project: { _id, name }, joined }`. I become a member with the invited role and the invitation is closed (`Accepted`). If I had joined some other way meanwhile, `joined` is `false` and my role is not changed |
| `POST /:invitationId/decline` | → `{ invitation }`. I am not added; the invitation is closed (`Declined`) |

Accept/decline answer **404** for an invitation that is not mine and **409** when it was already answered or has expired ("This invitation has expired. Ask the project team to invite you again."). Only one answer wins, even if Accept and Decline are clicked at once. Each invitation comes with `invitee` / `invitedBy` `{ name, username, avatarUrl }` and `project { name, color, visibility, description }` — never emails. Every step is logged in the Activity Feed (`invite.sent`, `invite.accepted`, `invite.declined`).

**UI.** On a project page, Owners and Admins get an **Invitations** panel under Team & roles: email-or-username box, role picker, **Send invite**, and the list of sent invitations with their state (Pending · expires …, Accepted, Declined, Expired). It replaces the old "Add to project" form in Team & roles, because people now join by accepting (the `POST /members` API from US-09 is unchanged). On the dashboard, **Your invitations** lists pending invitations (project, who invited you, role, days left) with **Accept** and **Decline**; after accepting, the project list reloads and **Open project** takes you there. The panel is hidden when there is nothing pending and for the demo account.

**Tests:** `backend/test/invitations.test.js`, `frontend/src/components/Invitations.test.jsx`, `frontend/src/pages/DashboardPage.test.jsx` (invitations panel).

## Sprint 3 — Decisions (M8: US-35, US-36)

Project members keep a record of **why** a choice was made: a title, a description, the people involved, the date, and optionally a link to the task or chat thread where it was discussed.

**Model** (`backend/src/models/Decision.js`): `project`, `title` (required, up to 120 characters), `description` (required, up to 2,000), `participants` (Users, at least one), `date` (required calendar day, `YYYY-MM-DD`, stored as midnight UTC like task due dates), `relatedTask` **or** `relatedMessage` + `relatedChannel` (a thread = its top-level channel message), `createdBy`, `updatedBy` (null until edited), `createdAt` / `updatedAt`. The field rules are in `backend/src/lib/decisions.js`.

**API** (`/api/projects/:id/decisions`, members only)

| Call | Who | Notes |
|------|-----|-------|
| `GET /` | All members (Viewers too) | `{ decisions }`, newest date first |
| `GET /:decisionId` | All members | `{ decision }` |
| `POST /` | Owner, Admin, Contributor | `{ title, description, participants: [userId], date, link? }` → 201 `{ decision }` |
| `PATCH /:decisionId` | Owner, Admin, Contributor | any of the same fields; `link: null` removes the link → `{ decision }` |

`link` is `{ type: 'task', id: <taskId> }` or `{ type: 'thread', id: <top-level messageId> }`. Each decision comes back with `participants` / `createdBy` / `updatedBy` `{ name, username, avatarUrl }` and `link: { type, id, label, href, missing }`, where `href` uses the existing deep links (`?tab=tasks&task=…`, `?tab=chat&channel=…&message=…&thread=…`). If the linked task or message is deleted later, the decision is kept and the link comes back with `missing: true` and `href: null`.

**Errors:** **400** for a missing or invalid field (nothing is saved, including on edit), a participant who is not a project member (on edit, people already on the decision may stay after they leave the project), a task or thread from another project, or a reply used instead of the thread's first message; **403** for Viewers on POST/PATCH and for non-members; **404** for a decision of another project. Recording and editing are logged in the Activity Feed as `decision.created` ("recorded decision …") and `decision.updated` ("updated decision …"); an edit that changes nothing is not logged.

**UI.** The project page has a **Decisions** tab (between Milestones and Activity). It lists every decision with its title, date, participants, description, link and "Recorded by … · Edited by …". Owners, Admins and Contributors get **Record decision** and an edit button. The form has title, description, date, participant checkboxes (project members), and **Related task or thread** (No link / Task / Channel thread → channel → message). Missing fields show an error in the form and nothing is sent. Viewers only see the list. Demo projects show a placeholder.

**Tests:** `backend/test/decisionRules.test.js` (field rules, dates, links; no database), `backend/test/decisions.test.js` (all five acceptance criteria, roles, participants, cross-project links, reply-as-thread, deleted task, activity events), `frontend/src/components/DecisionsPanel.test.jsx` (list, record, validation, server errors, edit, Viewer, link hrefs, thread picker).

## Sprint 3 — M7 Part 2: notification integration (US-30, FR-10, FR-33, NFR-6)

Builds on M7 Part 1 (storage + `/api/notifications`), M4's mention notifications and M5's deadline query.

**Generated automatically** (all through `createNotification()`, so only current project members are notified, nobody about their own action, and a failure never breaks the request)

| Type | When | Link | Duplicates |
|------|------|------|-----------|
| Mention | `@username` in a channel message, thread reply or task comment (M4, `lib/mentions.js`) | the message / thread / task | `mention:<type>:<id>` |
| Assignment | a task is created with an assignee, or its assignee changes (`lib/taskNotifications.js`, called from `routes/tasks.js`). Assigning yourself tells nobody | the task | `assignment:<taskId>:v<version>`: a retried request never notifies twice, a later re-assignment does |
| Deadline | an assigned task that is not Done is less than 24 hours from its deadline (M5 rules). Sent at once when a task is saved inside that window (create, edit, moved out of Done), and by a check every 5 minutes (`startDeadlineNotifier()`, started in `server.js`) for tasks that enter the window as time passes | the task | M5's `deadline:<taskId>:<due day>`: once per task and day; a new due date notifies again |

**Live.** Every authenticated socket now joins its own room `user:<id>` on connect (the id comes from the verified token). New notifications are pushed only there as `notification:created { notification, unreadCount }` (same shape as the REST list), and marking one read sends `notification:read { notificationId, unreadCount }` to the user's other tabs. A notification returned again for a repeated `dedupeKey` is not pushed again. Same shared Socket.IO server as before.

**UI.** The bell in the top bar (`NotificationBell.jsx`) shows the unread count (9+ above nine) and opens the newest notifications, labelled **Mention**, **Assignment** or **Deadline**, with who did it, the project and when. Selecting one marks it read and opens its task, message or thread. New ones appear live; "Show older" pages back. The demo workspace keeps the static bell.

**Tests:** `backend/test/notificationDelivery.test.js`, `frontend/src/components/NotificationBell.test.jsx`.

## Sprint 4 — M1: Authorize GitHub (US-31, FR-11, NFR-4)

A project **Owner** connects FORGE to their GitHub account with GitHub OAuth so FORGE can read their repositories. Picking the repository (US-32) and view / disconnect / re-authorize (US-33) build on this.

### GitHub OAuth setup (once per environment)

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App** (or the team organisation's settings).
2. **Homepage URL:** the frontend, e.g. `http://localhost:5173`. **Authorization callback URL:** the API callback, e.g. `http://localhost:5000/api/github/callback` (in production the HTTPS API URL + `/api/github/callback`).
3. Copy the Client ID and generate a Client secret, then add them to **`backend/.env` only** (never `frontend/.env`, never committed):

```
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_CALLBACK_URL=http://localhost:5000/api/github/callback   # must match the app's callback URL exactly
GITHUB_TOKEN_KEY=...   # 64 hex chars: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Until all four are set, the API logs which ones are missing (names only) and the panel says GitHub is not set up. Use one OAuth App per environment (local / deployed), because each has its own callback URL. Keep `GITHUB_TOKEN_KEY` the same once tokens are stored: a new key makes stored tokens unreadable.

### How it works

| Step | What happens |
|------|--------------|
| **Connect GitHub** (Owner only) | `POST /api/projects/:id/github/authorize` creates a random single-use **state** (stored only as a SHA-256 hash, expires after 10 minutes), puts the same state in an httpOnly cookie that is only sent to `/api/github/callback`, and returns the GitHub authorize URL (`scope=repo`, the fixed callback URL). The browser goes there. |
| Approve on GitHub | GitHub redirects to `GET /api/github/callback?code&state`. The state must exist, be unexpired and unused, **and** match the cookie (constant-time compare). It is deleted on first use. The user who started must still be the project Owner. The code is exchanged for a token server-side, the GitHub account is read, the token is **encrypted with AES-256-GCM** and saved in `GithubConnection`. Redirect to `/project/:id?github=connected`. |
| Deny on GitHub | `?error=access_denied` → nothing is stored (an earlier authorization is left as it was). Redirect to `?github=denied`. |
| Anything wrong | Missing/mismatched cookie → `invalid`; unknown, used or expired state → `expired`; Owner changed → `forbidden`; GitHub refused the code → `error`. Nothing is stored in any of these cases. |

The callback builds its redirect only from `CLIENT_ORIGIN` and the project stored with the state, never from the query string, and answers with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

**Token safety (NFR-4).** `encryptedToken` is `select: false` and removed from `toJSON` / `toObject`; it lives in its own collection (not on `Project`), so no project response can include it. No API response contains the token, and error logs contain only a short reason (for example `bad_verification_code`), never the token, the code or the client secret. `decryptToken()` in `lib/githubCrypto.js` is for server-side GitHub calls in US-32 / US-34.

**API**

| Call | Who | Answer |
|------|-----|--------|
| `GET /api/projects/:id/github` | Owner, Admin | `{ configured, canAuthorize, connection }`; `connection` is `null` or `{ githubLogin, scopes, authorizedAt, authorizedBy { _id, name, username } }` |
| `POST /api/projects/:id/github/authorize` | Owner | `{ url }`; 403 for others, 503 if the server is not configured |
| `GET /api/github/callback` | GitHub redirect | 303 to `/project/:id?github=connected\|denied\|invalid\|expired\|forbidden\|error` |

**UI.** Owners and Admins see a **GitHub** panel (Integrations) in the right column of the project page. The Owner gets **Connect GitHub**; Admins see the status only. After GitHub sends the Owner back, the panel shows "GitHub is connected…" or "The GitHub connection was not made … Nothing was saved." and removes `?github` from the URL. Once authorized it shows "Authorized as @login · by … · date".

**Files:** `backend/src/routes/github.js`, `backend/src/lib/githubOAuth.js`, `backend/src/lib/githubCrypto.js`, `backend/src/models/GithubConnection.js`, `backend/src/models/GithubOAuthState.js`, `frontend/src/components/GithubIntegrationPanel.jsx`, `githubApi` in `frontend/src/api.js`.

**Tests:** `backend/test/githubOAuth.test.js` (both acceptance criteria, encryption at rest, no token or secret in any response or log, state cookie + hash + single use + expiry, no open redirect, roles, missing config; GitHub is faked), `backend/test/githubCrypto.test.js` (encryption and state helpers, no database), `frontend/src/components/GithubIntegrationPanel.test.jsx`.

## Sprint 4 — M2: Connect a repository (US-32, FR-11)

After the Owner has authorized GitHub (US-31, M1), the **GitHub** panel on the project page offers **Choose repository**. The Owner picks one repository from the authorized GitHub account's list, and the panel shows it with an **Active** badge. Admins see the repository and the state but cannot change it. Picking again replaces the repository (a project always has at most one).

**When is the connection Active?** (`repositoryStatus()` in `backend/src/lib/githubRepos.js`)

| `connectionState` | Meaning |
|---|---|
| `not_connected` | GitHub has not been authorized for this project yet (US-31) |
| `unavailable` | an authorization is stored, but the server's GitHub settings are missing, so it cannot be used |
| `needs_repository` | authorized, but no repository is chosen, or it was chosen under a different GitHub account than the one authorized now |
| `active` | authorized, server configured, and a repository chosen under the current GitHub account |

The chosen repository is stored on the project's `GithubConnection` (`repository` field: GitHub repository ID, `owner/name`, link, private, default branch, whether the account can administer it, the GitHub account it was chosen under, who connected it and when). `Project.githubRepo` is set to `owner/name` so the project header shows it. Connecting or changing it is logged in the activity feed as `project.updated`.

**API** (Owner only; needs a stored authorization and the server GitHub settings)

| Call | Answer |
|------|--------|
| `GET /api/projects/:id/github` (M1, extended) | adds `{ repository, connectionState, active, canSelectRepository }`; Owner and Admin |
| `GET /api/projects/:id/github/repositories` | `{ githubLogin, repositories: [{ id, name, fullName, owner, private, htmlUrl, defaultBranch, description, archived, admin, updatedAt }], truncated, selectedId }`; up to 500, most recently updated first |
| `PUT /api/projects/:id/github/repository` | body `{ repositoryId }`; the server checks the ID against the authorized account's list, saves it, and answers with the status body (now `active: true`) |

Errors are `{ message, code }`: 403 `owner_only`, 503 `github_not_configured`, 409 `github_not_authorized`, 409 `github_reauthorize` (GitHub rejects the token, or it can no longer be decrypted), 409 `github_changed` (re-authorized while choosing), 400 `invalid_repository`, 400 `repository_not_available`, 503 `github_rate_limited` (with `Retry-After`), 502 `github_forbidden` / `github_unavailable`. The access token is decrypted only for the request to `api.github.com`; it is never returned or logged.

**Files:** `backend/src/lib/githubRepos.js`, `backend/src/routes/githubRepository.js`, the `repository` field in `backend/src/models/GithubConnection.js`, the status fields in `backend/src/routes/github.js`, `frontend/src/components/GithubRepositoryPicker.jsx`, the repository part of `frontend/src/components/GithubIntegrationPanel.jsx`, `githubApi.repositories` / `githubApi.selectRepository` in `frontend/src/api.js`.

**Tests:** `backend/test/githubRepos.test.js` (GitHub client and Active rule, no database), `backend/test/githubRepository.test.js` (API: acceptance criterion, Owner only, validation, persistence, GitHub errors, re-authorization; GitHub is faked), `frontend/src/components/GithubRepository.test.jsx`.

## Sprint 4 — M3: Manage the GitHub connection (US-33, FR-35)

> Owner/Admin can view status, disconnect and re-authorize. After disconnect, new events stop coming in but old feed entries stay.

Builds on M1 (US-31 OAuth, encrypted token) and M2 (US-32 repository, Active rule). It reuses M1's OAuth flow and M2's status function rather than adding new ones.

**What the Owner and Admins can do** (GitHub panel on the project page):

| Action | What happens |
|---|---|
| **View** | Repository name, "Connection status: …" and the badge. States are M2's `not_connected` / `unavailable` / `needs_repository` / `active`, plus `disconnected`, `needs_reauthorization` (GitHub rejected the token, or it cannot be decrypted), `repository_unavailable` (the account can no longer read the repository) and `unverified` (re-authorized, but the repository could not be checked yet). |
| **Check connection** | `POST /api/projects/:id/github/verify`. Checks the token (`GET /user`) **and** read access to the connected repository (`GET /repositories/{id}`). A good token alone never makes the connection Active. If GitHub is rate-limited or down, the request returns 503/502 and nothing changes (NFR-11b). |
| **Disconnect** | Confirmed in a dialog, then `POST /api/projects/:id/github/disconnect` with `{ confirm: true }`. This is a **soft disconnect**: <br>• `status` becomes `disconnected` and the encrypted token is deleted (and revoked on GitHub when possible). <br>• Pending Connect / Re-authorize attempts are cancelled. <br>• `Project.githubRepo` is cleared if it still names the repository. <br>• One `project.updated` feed entry is written. <br>• The GitHub account and repository are kept so re-authorizing can restore them. <br>• **No `Activity` document is ever deleted.** |
| **Re-authorize** | The same `POST /api/projects/:id/github/authorize` as M1. The first connection stays Owner only. Once a record exists (connected, expired or disconnected), the Owner **or an Admin** may run it again. <br>• The state stores `purpose: 'reauthorize'` and the callback re-checks the role for that purpose. <br>• The callback clears the disconnected / needs-re-authorization flags and checks the kept repository with the new token, then redirects with `?github=reauthorized`. <br>• Same GitHub account and the repository is readable: **Active** again. A different account: `needs_repository` (M2's rule). |

**Event gate — interface with M4 (US-34).** `backend/src/lib/githubEventGate.js`:

```js
projectsAcceptingGithubEvents(githubRepositoryId) // -> [projectId], [] after a disconnect
canRecordGithubEvent(projectId, githubRepositoryId?) // -> boolean
```

How it is wired into M4's webhook pipeline (US-34, already on `main`):

1. `activeProjectsFor()` in `routes/githubWebhook.js` keeps M2's Active rule and also applies the US-33 gate (`githubEventsAccepted()`). A delivery for a disconnected project is recorded as **ignored**, not retried.
2. `logActivity()` itself refuses every `github.*` event for a project whose connection does not accept events. So nothing can add a GitHub entry after a disconnect, even on another code path. `meta.repositoryId`, when present, must be the connected repository.
3. **Disconnect** calls M4's `removeProjectWebhook()` with the token before it is revoked, so the hook is taken off GitHub (unless another project still uses the repository), and clears `webhook` on the connection.
4. **Re-authorize / reconnect** sets the webhook up again with M4's `setupProjectWebhook()` once the kept repository is readable and has no active hook on it.
5. No `Activity` document is ever deleted, so earlier GitHub entries stay in the feed.

Known limit: `removeProjectWebhook()` keeps a hook while any other project's connection names the same repository, including a disconnected one, so in that rare case the hook stays on GitHub. The gate still drops its deliveries.

**Who:** Owner and Admin view, check, disconnect and re-authorize. Contributors, Viewers and visitors get 403. Choosing the repository stays Owner only (US-32).

**Token safety (NFR-4):** unchanged from M1. The token is decrypted only for the GitHub call or the revoke request. It is never returned or logged, and it is deleted on disconnect.

**Files:** `backend/src/lib/githubConnection.js` (rules: states, roles per OAuth purpose, verification, revoke; no database), `backend/src/lib/githubEventGate.js`. Marked additions in:
- `routes/github.js`: status body, Owner/Admin authorize + callback, `disconnect`, `verify`
- `routes/githubRepository.js`: disconnected → 409 `github_disconnected`, 401 / unreadable token recorded, shared status body
- `models/GithubConnection.js`: `status`, `disconnectedAt/By`, `needsReauthorization`, `reauthorizationReason`, `lastCheckedAt`, `repositoryCheck`, index on `repository.githubId`
- `models/GithubOAuthState.js`: `purpose`
- `lib/activity.js`: gate for `github.*`
- `routes/githubWebhook.js` (M4): `activeProjectsFor()` also applies the US-33 gate
- `lib/permissions.js`: `canManageGithubConnection`

Frontend: `components/GithubIntegrationPanel.jsx`, `githubApi.disconnect` / `githubApi.verify` in `api.js`, `styles.css`.

**Tests:**
- `backend/test/githubConnection.test.js`: rules, no database.
- `backend/test/githubConnectionManagement.test.js`: API, covering all three acceptance criteria, requirement 5, roles, in-flight OAuth after a disconnect, rate limits, and no secrets in responses or logs. GitHub is faked.
- `frontend/src/components/GithubConnectionManagement.test.jsx`.
- One assertion in `backend/test/githubOAuth.test.js`: M1's exact GET body now includes the US-33 fields (and M4's `webhook`).

## Sprint 4 — M4: GitHub events in the feed (US-34, FR-12, NFR-11a, NFR-11b)

When a repository is connected (US-32) and a commit is pushed, or an issue or pull request is opened or updated, a feed entry with the **event type, title, GitHub author and an "Open on GitHub" link** appears in the project's Activity feed. It is saved and pushed live over socket.io a moment after GitHub's delivery arrives, well within 60 seconds.

### Setup (once per environment)

Add to **`backend/.env` only**:

```
GITHUB_WEBHOOK_SECRET=...   # at least 20 characters: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
GITHUB_WEBHOOK_URL=https://<public API host>/api/github/webhook
```

On Render this is the API's public URL + `/api/github/webhook`. **GitHub cannot reach `localhost`**, so for local testing forward deliveries with one of these:

- **smee.io:** open https://smee.io, click *Start a new channel*, set `GITHUB_WEBHOOK_URL` to the channel URL, then run `npx smee-client --url <channel URL> --target http://localhost:5000/api/github/webhook`.
- **ngrok:** `ngrok http 5000`, then set `GITHUB_WEBHOOK_URL=https://<id>.ngrok-free.app/api/github/webhook`.

Restart the API, then (as the Owner) **choose the repository again** in the GitHub panel. That creates the webhook. GitHub's first delivery is a `ping`, which shows under **Recent deliveries**.

### How the webhook gets created

When the Owner chooses a repository (`PUT /api/projects/:id/github/repository`, M2), the API also calls `POST /repos/{owner}/{repo}/hooks` with the events `push`, `issues` and `pull_request`, `content_type: json` and the shared secret. If a hook with our URL already exists (another project connected the same repository, or an earlier attempt), it is reused and its secret/events refreshed. Changing to another repository removes our hook from the old one, unless another project still uses that repository. Choosing the repository **never fails because of the webhook**. The outcome is saved on `GithubConnection.webhook`, and the panel shows it:

| `webhook.status` | Panel shows |
|---|---|
| `active` | **Webhook active**: commits, issues and pull requests appear in the feed |
| `not_admin` | not set up: the authorized GitHub account is not an admin of the repository (GitHub only lets admins add webhooks) |
| `not_configured` | not set up: `GITHUB_WEBHOOK_SECRET` / `GITHUB_WEBHOOK_URL` missing on the server |
| `failed` | not set up: GitHub unreachable, rate limited or the authorization was revoked. Choose the repository again to retry |

For **US-33 (disconnect, M3):** call `removeProjectWebhook({ connection, accessToken })` from `backend/src/lib/githubWebhookSetup.js` before deleting the `GithubConnection` (load it with `.select('+encryptedToken')` and decrypt the token). It never throws. Even without it, a disconnected project gets **no new** entries, because the endpoint only adds entries for projects whose connection is still Active. Old entries are never touched.

### Receiving a delivery: `POST /api/github/webhook`

| Step | What happens |
|---|---|
| 1 | Mounted **before `express.json()`** and the `/api` rate limiter (it has its own: 300/min), using `express.raw()`, so the HMAC is computed on the exact bytes GitHub signed. |
| 2 | `503` if the webhook settings are missing. **`X-Hub-Signature-256` is verified first** (HMAC-SHA256 with `GITHUB_WEBHOOK_SECRET`, `crypto.timingSafeEqual`). Missing or wrong → `401`, nothing stored. |
| 3 | `400` for missing `X-GitHub-Event` / `X-GitHub-Delivery` or a body that is not JSON. |
| 4 | The delivery is recorded in **`WebhookDelivery`** (metadata only). `deliveryId` is unique: the same delivery again → `200 { duplicate: true }`, not processed twice. |
| 5 | `ping` → `200`. Everything else → `202` straight away (GitHub waits 10 s at most), then processed in the background. |
| 6 | Every project whose GitHub connection is **Active** for `repository.id` gets the mapped entries through `logActivity()` (saved + pushed live). Each entry first claims a **`GithubFeedKey`** (unique per project + event), so the same commit or issue update never shows twice, even under a new delivery ID. |

**Event mapping** (`backend/src/lib/githubEvents.js`)

| GitHub event | Actions | Feed type | Example sentence |
|---|---|---|---|
| `push` | each new commit on a branch (max 20 per push; branch deletes and tags skipped) | `github.commit` | *octocat pushed commit "Fix login bug" to main* |
| `issues` | `opened`, `edited`, `closed`, `reopened` | `github.issue` | *riya-gh opened issue #12 "Login fails on Safari"* |
| `pull_request` | `opened`, `edited`, `closed` (shown as *merged* when merged), `reopened`, `synchronize` | `github.pull_request` | *dev-gh merged pull request #7 "Add webhooks"* |

Other events and actions (labels, stars, ...) are recorded as `ignored`. `actor` is `null` (no FORGE user), and `meta` holds `{ author, title, url, action, repository, sha | number }`. `url` is only ever an `https://github.com/...` link, and the browser checks that again before showing **Open on GitHub** (`rel="noopener noreferrer"`).

### Retry, logging and rate limits

- **Retry (NFR-11a):** if processing fails (e.g. the database is briefly unavailable), it is retried **3 times with 1 s / 2 s / 4 s backoff**. Only the **final failure is logged**, as one line `GitHub webhook delivery <id> (<event>) failed after 4 attempts: <short reason>`, and the delivery is marked `failed` with `lastError`. Logs never contain the payload, the webhook secret or a token.
- **Delivery log:** `WebhookDelivery` keeps `deliveryId, event, action, repoFullName, projects, status (received | processed | ignored | failed), attempts, entries, reason, lastError, receivedAt, processedAt` for 30 days. Owner/Admin see the last 20 under **Recent deliveries** in the GitHub panel (`GET /api/projects/:id/github/deliveries`). To re-run a failed delivery, use **Redeliver** in GitHub → repository → Settings → Webhooks → Recent deliveries. GitHub sends it with a new delivery ID, and `GithubFeedKey` stops duplicates.
- **Rate limits (NFR-11b):** receiving webhooks makes **no** GitHub API calls. Only creating/removing the hook does. On a rate-limit answer (`403`/`429` with `x-ratelimit-remaining: 0` or `Retry-After`) it waits once if the reset is ≤ 10 s, otherwise it stops and records `failed` ("rate limit reached") instead of retrying hard.
- **Known gaps:** GitHub does not redeliver failed deliveries automatically, and the periodic reconciliation with the GitHub API that NFR-11a mentions is **not built** (not in the Sprint 4 plan for M4). A delivery whose processing was cut off by a server restart stays `received`. Use GitHub's **Redeliver**.

**Files:** `backend/src/routes/githubWebhook.js`, `backend/src/lib/githubEvents.js`, `backend/src/lib/githubWebhooks.js`, `backend/src/lib/githubWebhookSetup.js`, `backend/src/models/WebhookDelivery.js`, `backend/src/models/GithubFeedKey.js`, the `webhook` field in `backend/src/models/GithubConnection.js`, the hook call in `backend/src/routes/githubRepository.js`, `webhook` in `GET /api/projects/:id/github` (`routes/github.js`), mounting in `backend/src/app.js`, `frontend/src/components/GithubWebhookStatus.jsx`, the link in `frontend/src/components/ActivityPanel.jsx` + `activityGithubLink()` in `activityDisplay.js`, `githubApi.deliveries` in `frontend/src/api.js`.

**Tests:** `backend/test/githubEvents.test.js` (event mapping, no database), `backend/test/githubWebhooks.test.js` (signature, retry/backoff, rate limits, hook create/reuse/delete; GitHub faked; no database), `backend/test/githubWebhook.test.js` (API: acceptance criterion for commits, issues and PRs; bad/missing signature; duplicate and redelivered events; unconnected / disconnected / inactive repositories; retry + final failure log; hook creation on connect, not_admin, not_configured, GitHub failure, repository change; delivery log roles; no token or secret in responses or logs), `frontend/src/components/GithubEvents.test.jsx`.

## Sprint 4 — M7: project dashboard (US-39, FR-15)

A **Dashboard** tab on the project page (`/project/<id>?tab=dashboard`) shows, from live database data:

- **Milestone progress** — one progress bar per milestone: Done tasks ÷ tasks attached to it, rounded (a milestone with no tasks is 0%). Same calculation as the Milestones tab (both use `lib/projectDashboard.js`).
- **Open tasks** — the number of tasks that are not `Done` (`To do` + `In progress` + `Blocked`), with the per-status breakdown.
- **Due in the next 7 days** — open tasks due today up to and including 7 days ahead, soonest first, with title, due date, status, assignee and milestone. Click one to open it in the Tasks tab.

Due dates are calendar days stored as midnight UTC (see Sprint 3 — M5), so "today" is the UTC day. The 7-day window starts exactly where `isOverdue()` stops, so a dated open task is always either overdue (project health, US-40) or upcoming — never both. Rules and unit tests: `backend/src/lib/dashboardRules.js`, `backend/test/dashboardRules.test.js`. The tab reloads after your own task/milestone changes and when teammates' task changes arrive live.

| Call | Who | Response |
|---|---|---|
| `GET /api/projects/:id/dashboard` | Signed-in project members (any role). 401 not signed in, 400 bad ID, 404 no project, **403 non-members, even for a Public project** | `{ project: { _id, name, status }, membershipRole, milestones: { total, completed, items: [{ _id, title, description, dueDate, taskCount, doneCount, progress, completed }] }, tasks: { total, open, done, byStatus }, dueSoon: { days: 7, from, to, total, limit: 50, tasks: [{ _id, title, status, priority, dueDate, assignee, milestone }] }, generatedAt }` |

`from` / `to` are `YYYY-MM-DD`. `dueSoon.tasks` holds at most 50 tasks; `dueSoon.total` is the full count. Overdue and blocked lists and the activity level are project health (US-40, M8), not this endpoint.

**Files:** `backend/src/routes/dashboard.js`, `backend/src/lib/projectDashboard.js`, `backend/src/lib/dashboardRules.js` (milestone stats moved here from `routes/milestones.js`; `GET /api/tasks/upcoming` now uses the same 7-day window), `frontend/src/components/ProjectDashboard.jsx`, `dashboardApi` in `frontend/src/api.js`, the `Dashboard` tab in `frontend/src/pages/ProjectPage.jsx`.

**Tests:** `backend/test/dashboardRules.test.js` (rules, no database), `backend/test/projectDashboard.test.js` (API: auth, membership, calculations, 7-day boundaries with a fixed clock, empty project), `frontend/src/components/ProjectDashboard.test.jsx`, `frontend/src/pages/ProjectPage.tabs.test.js`, `e2e/tests/project-dashboard.spec.js`.

## Sprint 4 — M8: complete / reopen a project and project health (US-15, US-40, FR-3, FR-21, FR-22)

**Mark complete / reopen (US-15).** On a project page the **Owner** sees **Mark as completed** (or **Reopen project** once it is Completed) next to *Add task*, with a confirmation dialog. Completing sets `status: 'Completed'`, records `completedAt` and remembers the active status the project had (`reopenStatus`); reopening restores that status (`Planning` or `In progress`; "Active" in the user story means any status that is not Completed, which are the two this app already uses). Both actions appear in the activity feed (`project.completed`, `project.reopened`). Admins can still edit other details, but `PATCH /api/projects/:id` refuses to move a project into or out of Completed (403 for non-Owners, 400 for the Owner, who is pointed at the actions). **Archived** (FR-3) is not built: it is not in US-15 and the sprint plan says to confirm its scope first.

**Portfolio-ready (FR-21).** `GET /api/projects?status=Completed` returns my Completed projects (index on `members.user, status, completedAt`); without `?status` the list is unchanged.

**Project health (US-40).** Under the dashboard (Dashboard tab), Owners and Admins see:

- **Overdue tasks**: past their due day (UTC) and not Done — the same `isOverdue()` the dashboard uses, so a task is never both overdue and "due in the next 7 days".
- **Blocked tasks**: status `Blocked` **or** label `Blocked` (any letter case); Done tasks are left out.
- **Activity level**: activity feed events in the last 7 days (rolling): **Low** < 5, **Medium** 5–20, **High** > 20.

| Endpoint | Who | Response |
|---|---|---|
| `POST /api/projects/:id/complete` | Owner | `{ project }`; 403 others, 409 already Completed |
| `POST /api/projects/:id/reopen` | Owner | `{ project }`; 403 others, 409 not Completed |
| `GET /api/projects?status=Completed` | Signed in | `{ projects }` (my projects with that status); 400 unknown status |
| `GET /api/projects/:id/health` | Owner, Admin (403 Contributor, Viewer, non-members) | `{ project, membershipRole, overdue: { total, limit: 50, tasks: [{ _id, title, status, label, priority, dueDate, daysOverdue, assignee }] }, blocked: { total, limit, tasks }, activity: { days: 7, since, count, level, thresholds: { mediumFrom: 5, highAbove: 20 } }, generatedAt }` |

**Files:** `backend/src/lib/projectCompletion.js`, `backend/src/lib/healthRules.js`, `backend/src/lib/projectHealth.js`, `backend/src/routes/health.js`; small marked additions in `routes/projects.js`, `models/Project.js`, `models/Activity.js`, `lib/permissions.js`, `app.js`. Frontend: `components/ProjectCompletion.jsx`, `components/ProjectHealth.jsx`; marked additions in `pages/ProjectPage.jsx`, `api.js` (`projectCompletionApi`, `healthApi`), `roles.js`, `styles.css`.

**Tests:** `backend/test/projectCompletion.test.js`, `backend/test/projectHealth.test.js`, `frontend/src/components/ProjectCompletion.test.jsx`, `frontend/src/components/ProjectHealth.test.jsx`.

## Sprint 4 — M5: upload a project file (US-37, FR-14a, NFR-8)

The project page has a **Files** tab (`?tab=files`). Every project member sees the project's files (name, size, who uploaded it, when) and can download any of them. **Owners, Admins and Contributors** also get **Upload file**; Viewers see a note that they can download but not upload.

**10 MB limit (US-37 AC2, NFR-8).** One file per upload, at most **10 MB** (exactly 10 MB is allowed). The server enforces it: a bigger file answers **413** with `This file is larger than the 10 MB limit. Files must be 10 MB or smaller.` and nothing is stored. The Files tab checks the size before sending and shows the same message, so a too-big file is not even uploaded.

**Persistent storage (NFR-8).** File bytes are stored in **MongoDB GridFS** (bucket `projectFiles`, i.e. the `projectFiles.files` / `projectFiles.chunks` collections), in the same database as the rest of the app — MongoDB Atlas when deployed. Nothing is written to the server's disk, so files survive a Render redeploy. No new service, account or environment variable is needed. (Profile photos still use `UPLOAD_DIR` on disk; moving them is not part of US-37.)

| Call | Who | Notes |
|------|-----|-------|
| `GET /api/projects/:id/files` | Members (all roles) | `{ files, membershipRole, canUpload, maxBytes }`, newest first |
| `POST /api/projects/:id/files` | Owner, Admin, Contributor | `multipart/form-data`, one file in the field **`file`** → 201 `{ file }`. **413** `{ message, code: 'file_too_large', maxBytes }` over 10 MB; 400 no file / empty file / extra fields or files; 403 Viewer |
| `GET /api/projects/:id/files/:fileId/download` | Members (all roles) | The bytes, as an attachment with the file's name. 404 unknown file or a file of another project |

Each file: `{ _id, project, name, size, contentType, uploadedBy { _id, name, username, avatarUrl } | null, createdAt, downloadUrl }`. Non-members get **403 even for a Public project**; signed-out requests get 401.

**Safety.** Membership and role are checked *before* the upload is read. File names are cleaned (no folders, no control characters, max 200 characters; non-English names are kept). Downloads are always `application/octet-stream` + `Content-Disposition: attachment` + `nosniff`, so an uploaded HTML or SVG file can never run as a page on the API's address. The GridFS id is never sent to the browser. Downloads need the access token, so the Files tab fetches them through `fileApi.download()` (same token refresh as every other call) and hands the result to the browser as a normal download.

**Activity Feed.** Every upload is logged as `file.uploaded` (shown as "File uploaded").

**Files:** `backend/src/lib/projectFiles.js` (limit, messages, name cleaning, GridFS helpers), `backend/src/models/ProjectFile.js`, `backend/src/routes/projectFiles.js`; small marked additions in `lib/permissions.js` (`canUploadFiles`), `models/Activity.js` (`file.uploaded`, target `file`), `app.js`. Frontend: `components/FilesPanel.jsx`; marked additions in `api.js` (`fileApi`), `roles.js` (`canUploadFiles`), `components/activityDisplay.js`, `pages/ProjectPage.jsx` (`Files` tab).

**Tests:** `backend/test/projectFiles.test.js` (both acceptance criteria incl. exactly 10 MB and 10 MB + 1 byte, GridFS storage, every role, non-members, other project's file, bad input, name cleaning), `frontend/src/components/FilesPanel.test.jsx`, `frontend/src/pages/ProjectPage.tabs.test.js`.

## Sprint 4 — M6: Markdown documentation pages (US-38, FR-14b)

> Scope note: US-38 is **Should** in the user stories and **Could** in the corrected FR-14b; it is part of the Sprint 4 plan (M6).

The project page has a **Docs** tab (`?tab=docs`, and `?tab=docs&doc=<id>` opens one page). Every project member sees the list of pages (title, short preview, who created / last edited it, when) and can open any page; it is shown as **formatted text**. **Owners, Admins and Contributors** also get **New page** and **Edit**: a title, a Markdown box with **Write / Preview**, and a live **`1,234 / 10,000`** counter that turns red over the limit. Viewers only read.

**10,000-character limit.** The content may be at most **10,000 characters** (exactly 10,000 is allowed; Windows `\r\n` line endings count as one). The server enforces it: longer content answers **400** `Content must be 10,000 characters or fewer.` and nothing is saved. The Docs tab blocks saving over the limit with the same message.

| Call | Who | Notes |
|------|-----|-------|
| `GET /api/projects/:id/docs` | Members (all roles) | `{ docs }`, most recently updated first; each has `title`, `preview`, `length`, `createdBy`, `updatedBy`, `createdAt`, `updatedAt` (no full content) |
| `GET /api/projects/:id/docs/:docId` | Members (all roles) | `{ doc }` with the same fields plus `content` (Markdown text) |
| `POST /api/projects/:id/docs` | Owner, Admin, Contributor | `{ title, content }` → 201 `{ doc }` |
| `PATCH /api/projects/:id/docs/:docId` | Owner, Admin, Contributor | `{ title?, content? }` → `{ doc }`; `updatedBy` is set when something changed |

Title: required, up to 120 characters. Content: required Markdown. **400** missing / blank / too long (nothing is saved, also on edit), **403** Viewers on POST/PATCH and non-members (even for a Public project), **404** a page of another project, **400** bad ID.

**Safe rendering.** The server stores the Markdown as plain text and never turns it into HTML. The browser renders it with `frontend/src/components/markdown.jsx`, a small renderer that builds React elements only (no `dangerouslySetInnerHTML`, no new npm package). So any HTML in a page (`<script>`, `<img onerror=…>`, `<iframe>` …) is shown as text and never runs, and links are made only for `http:`, `https:` and `mailto:` (opened in a new tab with `rel="noopener noreferrer"`); `javascript:`, `data:` and other addresses stay plain text. Supported: `#`–`###` headings, paragraphs and line breaks, `**bold**`, `*italic*`, `` `code` ``, fenced code blocks, `-` / `1.` lists, `>` quotes, `---` and `[links](https://…)`.

**Files:** `backend/src/lib/docs.js` (rules, limit, messages, preview), `backend/src/models/DocPage.js`, `backend/src/routes/docs.js`; small marked additions in `lib/permissions.js` (`canWriteDocs`) and `app.js`. Frontend: `components/DocsPanel.jsx`, `components/markdown.jsx`; marked additions in `api.js` (`docApi`), `roles.js` (`canWriteDocs`), `pages/ProjectPage.jsx` (Docs tab, `?doc=`).

**Tests:** `backend/test/docRules.test.js` (rules, exactly 10,000 vs 10,001, `\r\n`, preview; no database), `backend/test/docs.test.js` (every acceptance criterion, every role, non-members, other project's page, bad input, edits that change nothing on error, list without content), `frontend/src/components/markdown.test.jsx` (each Markdown feature and the XSS cases), `frontend/src/components/DocsPanel.test.jsx` (list, read, `?doc=`, create, edit, counter and limit, Viewer, server errors), `frontend/src/pages/ProjectPage.tabs.test.js` (Docs tab).

## Sprint 5 — M1: Discover public projects (US-45, FR-18, FR-30)

**Discover works without logging in.** `/discover` is no longer behind the login screen. A logged-out **Visitor** sees it in a light public frame (`PublicShell`: logo, Discover, **Log in**, **Sign up**); a logged-in user sees the same page inside the normal app. Demo users keep the sample cards.

**Only public projects, with filters.** The project list comes from a no-login API that only ever returns **Public** projects. Visitors can search by **keyword** (the project's **name or description** contains it, any letter case) and filter by **domain** (the agreed list), **skill tag** and **status** (Planning / In progress / Completed). Filters combine, the list refreshes when one changes, and they are kept in the link (`/discover?q=&domain=&tag=&status=&page=`), so a filtered list can be shared. **Clear filters** resets them; with no match the page says "No public projects match these filters." 24 projects per page, most recently updated first. The People tab still needs an account; visitors see a log-in prompt there.

| Call | Who | Notes |
|------|-----|-------|
| `GET /api/public/projects` | Anyone (no login) | `?q=&domain=&tag=&status=&page=` → `{ projects, page, pageSize, total, filters }`. Each project: `{ _id, name, description, domain, tags, status, memberCount, createdAt, updatedAt }` |
| `GET /api/public/projects/filters` | Anyone (no login) | `{ domains, statuses, tags }`: the agreed domains, the status list, and the skill tags used by **public** projects only |

**Rules** (`backend/src/lib/publicDiscovery.js`): the filter always includes `visibility: 'Public'`, whatever is sent. `q` up to 100 characters, searched literally (regex symbols like `.` or `(` are plain text); `domain` must be on the agreed list and `status` one of the three statuses (any letter case); `tag` is an exact, case-insensitive match; `page` 1–1000. A bad value answers **400** with a clear message. Only the whitelisted fields above are sent: no member names, emails, roles or GitHub data. The router never reads the `Authorization` header, so a missing, expired or garbage token makes no difference. The old logged-in `GET /api/projects/discover` is unchanged.

**For M2 (US-46/US-47 public project page):** reuse `frontend/src/components/PublicShell.jsx` (layout route or children), add the public page's API as `GET /api/public/projects/:projectId` in `routes/publicProjects.js`, and change only `publicProjectPath(id)` in `frontend/src/lib/publicLinks.js` so every Discover card opens the new page.

**Files:** `backend/src/lib/publicDiscovery.js`, `backend/src/routes/publicProjects.js`; one marked mount in `app.js`. Frontend: `components/PublicShell.jsx`, `lib/publicLinks.js`; marked changes in `App.jsx` (`PublicOrAppShell`, `/discover` moved out of the protected routes), `api.js` (`publicApi`), `pages/DiscoverPage.jsx` (server-side filters in the URL, paging, visitor states).

**Tests:** `backend/test/publicDiscoveryRules.test.js` (every query rule; no database), `backend/test/publicProjects.test.js` (all three acceptance criteria with no token, private projects never listed whatever the filters, safe fields only, 400s, paging, garbage tokens, old endpoint unchanged), `frontend/src/pages/DiscoverPage.test.jsx` (updated for the public API + visitor, filter, URL, paging and card tests), `frontend/src/App.discover.test.jsx` (logged-out vs logged-in routing), `e2e/tests/discover-public.spec.js` (a logged-out visitor searches and filters in a real browser).

## Sprint 5 — M5: Generate my portfolio (US-49, FR-21, NFR-12)

A registered user's portfolio lists the projects they belong to that are marked **Completed**, with their **role** and their **contribution numbers** per project, and can be shared by link.

**Where to find it**
- **Profile page → My portfolio:** your Completed projects (each links to its workspace), totals, and the share link with **Copy link** / **Open**.
- **Shared link `/portfolio/<username>`:** opens for anyone, logged in or not, read-only (logged-out visitors get the public frame from Sprint 5 · M1).

**Per-project numbers (AC2)**

| Number | Counted as |
|---|---|
| Tasks completed | tasks in that project assigned to you whose status is Done |
| Decisions recorded | decisions you recorded in that project |
| Messages posted | channel messages and thread replies you posted in that project |

**At most 24 hours old (NFR-12).** Numbers are saved in `PortfolioStat` with the time they were counted, and counted again whenever a portfolio is opened and they are 24 hours old or older (or dated in the future). The page shows "Contribution numbers updated …".

**Privacy**
- Public or not is `User.portfolioPublic` (the switch belongs to the privacy settings, Sprint 5 · M3 / US-07). When it is off, the link answers **"This portfolio is not available."** (the same answer as for an unknown username), while you still see your own portfolio.
- The shared view never contains email, project IDs or other members. A **Private** project is still listed with your role, domain, date and numbers, but its name shows as "Private project" and its description and tags are hidden, because the other members never made them public.

**API**

| Call | Who | Answer |
|---|---|---|
| `GET /api/portfolio/me` | logged in | `{ user, projects, totals, statsUpdatedAt, isPublic, sharePath }` |
| `GET /api/public/portfolio/:username` | anyone (no login) | `{ user, projects, totals, statsUpdatedAt }`, or 404 "This portfolio is not available." |

Each project: `name, description, domain, tags, role, completedAt, visibility, isPrivate, stats { tasksCompleted, decisionsRecorded, messagesPosted, computedAt }` (plus `_id` in your own view only).

**For M3 (US-06 other user's profile):** show a portfolio with `<PortfolioView portfolio={data} />` from `frontend/src/components/PortfolioView.jsx`, loading `data` with `portfolioApi.shared(username)`.

**Files:** `backend/src/lib/portfolio.js`, `backend/src/lib/portfolioRules.js`, `backend/src/models/PortfolioStat.js`, `backend/src/routes/portfolio.js`, `backend/src/app.js` (2 routes); `frontend/src/components/PortfolioView.jsx`, `frontend/src/components/MyPortfolioPanel.jsx`, `frontend/src/pages/PortfolioPage.jsx`, `frontend/src/App.jsx` (route), `frontend/src/pages/ProfilePage.jsx` (one line), `portfolioApi` in `frontend/src/api.js`, styles in `frontend/src/styles.css`.

**Tests:** `backend/test/portfolio.test.js` (all three acceptance criteria, 24-hour recount, private-project hiding, "not available", no leaks, concurrent loads), `backend/test/portfolioRules.test.js` (rules, no database), `frontend/src/components/MyPortfolioPanel.test.jsx`, `frontend/src/pages/PortfolioPage.test.jsx`, `frontend/src/App.portfolio.test.jsx`.

## Sprint 5 — M3: View another user's profile and set privacy (US-06, US-07, FR-19, FR-21, FR-26)

A registered user can open another user's profile read-only, and every user controls two privacy switches.

**Where to find it**
- **Discover → People → View profile** opens `/people/<username>` (login required; logged-out visitors are sent to log in).
- **Profile page → Privacy settings:** two switches and **Save privacy settings**. Under them, **See how others view your profile** opens your own `/people/<username>`.

**US-06 View another user's profile**
- Shows **photo, bio, skill tags, follower count and score** (AC1), plus name, username and headline.
- **Hidden fields are never exposed (AC2).** The API builds the profile from an allow-list (`profileView` in `backend/src/lib/userProfileRules.js`) and only reads `name username headline bio avatarUrl skills portfolioPublic` from the database. Email, password data, login counters, the user ID and the privacy switches themselves are never sent.
- The portfolio (Sprint 5 · M5) is shown read-only when it is public. When its owner turned it off, the page says **"This portfolio is not available."** and the portfolio is never loaded.
- **Follower count and score (FR-26):** following (US-54) and posts with votes (US-50, US-52) are built in a later sprint and have no models yet, so both are 0 for now. When they are added, only `socialCountsFor` in `backend/src/lib/userProfile.js` changes.

**US-07 Set privacy preferences**

| Switch | Field | When off |
|---|---|---|
| Appear in collaborator search | `User.profileDiscoverable` | not returned by `GET /api/profile/people`, by name or skill tag (AC1). The profile still opens from a direct link. |
| Public portfolio | `User.portfolioPublic` | `/portfolio/<username>` shows "This portfolio is not available." (AC2), and the profile page shows the same. |

Both are on by default. They are saved with `PATCH /api/profile/me`. A value that is not `true` or `false` is refused with 400 "Privacy settings must be true or false." and nothing is saved (NFR-21). Saving shows "Privacy settings saved." or the error (NFR-26).

**API**

| Call | Who | Answer |
|---|---|---|
| `GET /api/profile/users/:username` | logged in | `{ profile: { name, username, headline, bio, avatarUrl, skills, followerCount, publicScore, portfolio: { available, path }, isMe } }`, or 404 "User not found." |
| `PATCH /api/profile/me` | logged in | also accepts `profileDiscoverable` and `portfolioPublic` (true/false) |

**Files:** `backend/src/lib/userProfileRules.js`, `backend/src/lib/userProfile.js`, `backend/src/routes/profile.js` (new route + privacy check); `frontend/src/pages/UserProfilePage.jsx`, `frontend/src/components/PrivacySettings.jsx`, `frontend/src/App.jsx` (route), `frontend/src/pages/ProfilePage.jsx` (privacy panel, preview link), `frontend/src/pages/DiscoverPage.jsx` (View profile button), `profileApi.user` in `frontend/src/api.js`, styles in `frontend/src/styles.css`.

**Tests:** `backend/test/userProfile.test.js` (both stories' acceptance criteria, no leaks, login required, bad values refused), `backend/test/userProfileRules.test.js` (rules, no database), `frontend/src/pages/UserProfilePage.test.jsx`, `frontend/src/components/PrivacySettings.test.jsx`, `frontend/src/App.userProfile.test.jsx`, `frontend/src/pages/DiscoverPage.profileLink.test.jsx`.

## Sprint 5 — M2: Public project page and Request to join (US-46, US-47, FR-20)

**Where to find it**
- **Discover → View project** on any real project opens `/discover/<projectId>`. It opens for anyone: logged-out visitors get the public frame (Sprint 5 · M1), logged-in users the normal app.
- A logged-in non-member who opens `/project/<id>` of a Public project is sent to `/discover/<id>` instead of the workspace.

**US-46 View a public project page**
- Shows only the project's **name, description, domain, status and member names** (AC1). Nothing on the page can be edited, and the public API has no write routes.
- **Channels, messages, tasks and files are not shown to non-members (AC2).** The public API never sends them, and the member APIs refuse non-members with 403, also on a Public project. Tasks were readable by any logged-in non-member of a Public project before; `GET /api/projects/:id/tasks` and `/tasks/:taskId` are now members-only ("Tasks are visible to project members only."), and only members can join a project's live room (Socket.IO `project:join`), so non-members get no live task events either.
- A Private project answers exactly like a missing one (404 "This project is not public or does not exist."), so a visitor cannot tell it exists. The page then says **"This project is not available."**

**US-47 Request to join (on the public page)**
- **Not logged in:** "Request to join" opens the login page, then comes back to the project page (AC3).
- **Logged in, not a member:** the Sprint 3 join request card: one pending request with an optional message (AC1); a second request is refused with "You already have a pending request for this project." (AC2). The Owner/Admin approves or rejects it in the workspace (Sprint 3 · M2).
- **Member:** an **Open workspace** link instead.

**API**

| Call | Who | Answer |
|---|---|---|
| `GET /api/public/projects/:projectId` | anyone (no login) | `{ project: { _id, name, description, domain, status, memberNames } }`; 404 for Private or missing; 400 for an invalid ID |

**Files:** `backend/src/lib/publicProjectPage.js` (new, rules), `backend/src/routes/publicProjects.js` (new route), `backend/src/routes/tasks.js` (task reads members-only), `backend/src/lib/realtime.js` (live room members-only); `frontend/src/pages/PublicProjectPage.jsx` (new), `frontend/src/App.jsx` (route), `frontend/src/lib/publicLinks.js` (Discover cards → `/discover/:id`), `frontend/src/pages/ProjectPage.jsx` (non-members sent to the public page), `frontend/src/components/JoinRequestCard.jsx` (optional `onStatus`), `publicApi.project` in `frontend/src/api.js`.

**Tests:** `backend/test/publicProjectPage.test.js` (US-46 and US-47 acceptance criteria end to end), `backend/test/publicProjectPageRules.test.js` (rules, no database), `frontend/src/pages/PublicProjectPage.test.jsx`, `frontend/src/lib/publicLinks.test.js`, new cases in `frontend/src/App.discover.test.jsx` and `frontend/src/pages/DiscoverPage.test.jsx`, `e2e/tests/public-project-page.spec.js`. Existing tests that expected non-members to read a Public project's tasks or join its live room were updated to the members-only rule (`channels`, `joinRequests`, `removeLeave`, `taskComments`, `threads`).
## Sprint 5 — M6: Create, edit and delete public posts (US-50, US-51, FR-23, NFR-16, NFR-26)

A logged-in user can publish a public post that belongs to **no project**, and can edit or delete their own posts.

**Where to find it:** sidebar → **Community feed** (`/feed`). Posts are listed newest first; Sprint 5 M8 switches the feed to the trending order (US-53) and M7 adds voting (US-52).

**Rules (the same numbers are used by the server, the browser and the tests)**

| Rule | Value | When broken |
|---|---|---|
| Text | required, 1–500 characters after trimming (line breaks kept) | 400 with the reason |
| Image | optional, **one** JPEG, PNG or WebP image, decided by the file's real bytes (not its name or Content-Type) | 400 "Only JPEG, PNG or WebP images…" |
| Image size | at most **5 MB** | 413 "Images must be 5 MB or smaller." (nothing is stored) |
| Rate limit | at most **10 posts per user in any rolling hour** | 429 "You can create up to 10 posts per hour. Please try again in N minutes." + `Retry-After` |
| Edit / delete | the **author only** | 403 "You can only edit or delete your own posts." |

- Refused posts do not use up the hourly limit. Deleting a post does **not** give the slot back (so delete-and-repost cannot flood the feed). Edits do not count.
- An edited post shows **"edited"**. Saving the same text again is not an edit.
- Delete asks for confirmation in the app; the post and its image are removed, so it leaves every feed and its votes no longer count.
- Images are stored in MongoDB GridFS (bucket `postImages`), like project files, so they survive a redeploy. They are served with their checked type, `nosniff` and a sandbox CSP.
- Post text is shown as plain text, so HTML in a post is displayed, never run.

**API** (login needed except for the image)

| Call | Who | Answer |
|---|---|---|
| `GET /api/posts?limit=&before=&author=` | logged in | `{ posts, nextBefore }` newest first, 20 per page (max 50) |
| `GET /api/posts/:postId` | logged in | `{ post }` |
| `POST /api/posts` | logged in | multipart `text` + optional `image`, or JSON `{ text }` → 201 `{ post, message: "Your post is published." }` |
| `PATCH /api/posts/:postId` | author | JSON `{ text }` → `{ post, message }` with `edited: true` |
| `DELETE /api/posts/:postId` | author | `{ postId, message }` |
| `GET /api/posts/:postId/image` | anyone | the image bytes (404 once the post is deleted) |

Each post: `_id, author { _id, name, username, avatarUrl }, text, imageUrl, image { contentType, size }, edited, editedAt, createdAt, updatedAt, upvotes, downvotes, score, isMine`.

**For M7 (US-52 voting):** `Post` already has `upvotes`, `downvotes` and `score` (all 0). Keep `score = upvotes − downvotes`. If votes get their own collection, delete a post's votes in `DELETE /api/posts/:postId` (marked in `backend/src/routes/posts.js`). Add the vote buttons to `frontend/src/components/PostCard.jsx`.
**For M8 (US-53 trending, US-54 total vote score):** add the trending order to `GET /api/posts` (or a new `/api/posts/trending`); a user's total vote score is the sum of `score` over `Post.find({ author })`.

**Files:** `backend/src/lib/postRules.js`, `backend/src/lib/postImages.js`, `backend/src/models/Post.js`, `backend/src/models/PostCreateLog.js`, `backend/src/routes/posts.js`, `backend/src/app.js` (1 route); `frontend/src/posts.js`, `frontend/src/components/PostComposer.jsx`, `frontend/src/components/PostCard.jsx`, `frontend/src/pages/FeedPage.jsx`, `frontend/src/App.jsx` (route), `frontend/src/components/AppShell.jsx` (sidebar link), `postApi` in `frontend/src/api.js`, styles in `frontend/src/styles.css`.

**Tests:** `backend/test/posts.test.js` (all acceptance criteria of US-50 and US-51, 5 MB edge, fake image types, concurrent posting, pages), `backend/test/postRules.test.js` (rules, no database), `frontend/src/components/PostComposer.test.jsx`, `frontend/src/components/PostCard.test.jsx`, `frontend/src/pages/FeedPage.test.jsx`.

## Sprint 5 — M7: Vote on a post (US-52, FR-24, NFR-13, NFR-14, NFR-16)

A logged-in user can **upvote or downvote** any public post, **change** the vote, or **take it back**. A user has at most **one active vote per post**, and a post's **score = upvotes − downvotes**.

**Where to find it:** Community feed (`/feed`). Every post card has ▲ score ▼ at the bottom.
- Click ▲ or ▼ to vote. The score changes at once and the server's numbers replace it when it answers.
- Click the **other** arrow to change the vote, or the **lit** arrow again to remove it.
- If the server refuses (deleted post, rate limit), the old score comes back and the reason is shown.

**Rules (the same numbers are used by the server, the browser and the tests)**

| Rule | Value | When broken |
|---|---|---|
| Value | exactly `1` (up), `-1` (down) or `0` (remove) | 400 "Send "value": 1 to upvote, -1 to downvote or 0 to remove your vote." |
| One vote per user per post | unique index on `PostVote { post, user }` | a second vote **replaces** the first; voting the same way again changes nothing |
| Rate limit | at most **30 vote requests per user in any rolling minute** (casting, changing and removing all count) | 429 "You can vote up to 30 times per minute. Please try again in N seconds." + `Retry-After` |
| Who | any logged-in user, on any post (their own included; FR-24 has no exception) | 401 without login, 404 unknown or deleted post |

**How the count stays right when many votes arrive at once (NFR-13, NFR-14)**

1. The user's vote is a `PostVote` row. Changing it is a **compare-and-swap**: the write only happens if the row is still exactly what was read (same `_id` and same `value`). A first vote is an insert, and the unique index refuses a second one.
2. **Only the request whose write succeeded** moves the post's counters, with **one atomic `$inc`** of `upvotes`, `downvotes` and `score` together.
3. A request that lost the race reads the row again and decides again. So the same vote sent 10 times at once is counted once, and 24 users voting at once are each counted exactly once.

No MongoDB transaction is needed, so it works on the in-memory test server and on Atlas alike. `recountPostVotes(postId)` in `backend/src/lib/postVotes.js` recounts a post from its vote rows. The tests use it to check the counters, and it can repair a post after restoring a backup.

Deleting a post (US-51) also removes its votes.

**API** (login needed)

| Call | Body | Answer |
|---|---|---|
| `PUT /api/posts/:postId/vote` | JSON `{ value: 1 \| -1 \| 0 }` | `{ post, vote, previous, outcome, message }` |
| `DELETE /api/posts/:postId/vote` | none | same as `PUT { value: 0 }` |

`outcome` is `cast`, `changed`, `retracted` or `unchanged` (the same vote again: nothing was counted). `post` has the new `upvotes`, `downvotes`, `score` and `myVote`. Every post returned by `GET /api/posts` and `GET /api/posts/:postId` now also has **`myVote`** (`1`, `-1` or `0`): the logged-in user's own vote.

**For M8 (US-53 trending, US-54 total vote score):** `Post.score` is always up to date, so the trending score can read it directly, and a user's total vote score is the sum of `score` over their posts. The `socialCountsFor` function in `backend/src/lib/userProfile.js` is still 0 and is M8's to fill.

**Files:** `backend/src/lib/voteRules.js`, `backend/src/lib/voteEngine.js`, `backend/src/lib/postVotes.js`, `backend/src/models/PostVote.js`, `backend/src/models/PostVoteLog.js`, `backend/src/routes/postVotes.js`, `backend/src/app.js` (1 route), `backend/src/routes/posts.js` (`myVote` on posts, votes removed on delete); `frontend/src/votes.js`, `frontend/src/components/PostVotes.jsx`, `frontend/src/components/PostCard.jsx` (vote bar), `postApi.vote` / `postApi.unvote` in `frontend/src/api.js`, styles in `frontend/src/styles.css`.

**Tests:** `backend/test/postVotes.test.js` (all three acceptance criteria against MongoDB: a first vote moves the score by one, a repeated vote is counted once, many users at the same moment; also change, retract, `myVote`, bad values, deleted posts, the 30-per-minute limit and bursts), `backend/test/voteEngine.test.js` (the race logic without a database: thousands of interleaved votes in random orders), `backend/test/voteRules.test.js` (rules), `frontend/src/components/PostVotes.test.jsx`.

## Sprint 5 — M8: Trending feed, follow users, total vote score (US-53, US-54, FR-25, FR-26, NFR-1a, NFR-15)

**Trending feed (US-53).** The Community feed (`/feed`) opens on **Trending**; **Latest** is M6's newest-first list, unchanged.

- `trendingScore = (upvotes − downvotes) / (ageHours + 2)^1.5`, highest first; equal scores → the **newer** post first (`createdAt`, then `_id`). The votes are M7's counters on `Post` (US-52); M8 only reads them.
- The score depends on the clock, so it is stored on each post (`Post.trendingScore`, index `{ trendingScore: -1, createdAt: -1, _id: -1 }`) and recalculated by `lib/trending.js`: once at server start, **every 4 minutes**, and by the feed itself first when the last run is **5 minutes** old or missing (NFR-15). Concurrent requests share one run; a failed run never breaks the feed.
- Votes cast after the last run show on the post straight away (its score), and move it in the ranking at the next recalculation (US-53 AC2).
- Speed (NFR-1a): one indexed, limited query per page + one author populate + one "my votes" query. The API test loads the first page for 100 users at once over 2,000 posts in under 3 s.

| Call | Who | Response |
|---|---|---|
| `GET /api/posts/trending?limit=1..50&cursor=` | logged in | `{ posts: [post + myVote + trendingScore], nextCursor, rankedAt, maxRankAgeSeconds: 300, recalculatedEverySeconds: 240 }`; 400 bad cursor |

**Follow users and see public counts (US-54).** Other people's profiles (`/people/:username`) get a **Follow / Unfollow** button. The profile shows the real follower count and the **total vote score**: the sum of the net scores (upvotes − downvotes) of all the user's posts. It is never "likes" (corrected FR-26, NFR-27; the older US-54 story text said "total likes").

| Call | Who | Response |
|---|---|---|
| `PUT /api/profile/users/:username/follow` | logged in | `{ following: true, followerCount, changed, message }`; 400 `self_follow`, 404 unknown user |
| `DELETE /api/profile/users/:username/follow` | logged in | `{ following: false, followerCount, changed, message }` |
| `GET /api/profile/users/:username` (M3) | logged in | now with the real `followerCount` and `publicScore` (= total vote score), plus `isFollowing` |

- One `Follow` row per pair, unique index `{ follower, following }`. Following is an atomic upsert, so repeating it or sending it twice at once never counts twice (`changed: false`). Unfollowing twice is harmless. You cannot follow yourself.
- Privacy (M3): anyone logged in can open a profile by its link, so they can follow it; "appear in collaborator search" only affects search. Followers are counted, never listed, and no user IDs or emails are sent.
- **From a post to a profile:** on every post card (Trending and Latest) the author's photo, name and @username open `/people/:username`, where they can be followed (`PostCard.jsx`). A deleted author stays plain text.
- The vote buttons show 👍 (upvote) and 👎 (downvote) instead of arrows (`PostVotes.jsx`). Behaviour and the names "Upvote" / "Downvote" are unchanged; it is still a **vote score**, never "likes".

**Files:** `backend/src/lib/trendingRules.js`, `lib/trendingRanker.js`, `lib/trending.js`, `routes/trending.js`, `models/Follow.js`, `lib/followRules.js`, `lib/follows.js`, `routes/follows.js`; integration edits in `models/Post.js` (`trendingScore` + index), `lib/userProfile.js` (real counts, `isFollowing`), `app.js`, `server.js`, `seed/seedData.js` (removes seed users' follows). Frontend: `components/TrendingFeed.jsx`, `components/FollowButton.jsx`, the author links in `components/PostCard.jsx` (M6), the 👍/👎 symbols in `components/PostVotes.jsx` (M7), the tabs in `pages/FeedPage.jsx`, the button and "Total vote score" in `pages/UserProfilePage.jsx`, `postApi.trending`, `profileApi.follow` / `unfollow`.

**Tests:** `backend/test/trendingRules.test.js`, `trendingRanker.test.js`, `followRules.test.js` (no database), `trending.test.js`, `follows.test.js` (API + MongoDB), `frontend/src/components/TrendingFeed.test.jsx`, `frontend/src/pages/UserProfilePage.follow.test.jsx`, `frontend/src/components/PostCard.profileLink.test.jsx`.

---

## Sprint 6 — M1: fixes D1 (`trust proxy`) and D2 (issue title)

Both defects come from the **Sprint 4 GitHub exit checks** (`Documents/Sprint4-Final-Testing/sprint4-exit-checks.pdf`, section *Observations and defects found*).

### D1 (Medium): rate limits behind a proxy

**Problem.** When a request comes through a proxy (Render's load balancer, or smee forwarding GitHub deliveries), the client's real address is in the `X-Forwarded-For` header. Express did not trust that header, so `req.ip` was the **proxy's** address: every user shared one rate-limit bucket (120 requests per minute for the whole site, 30 logins per 15 minutes for everyone), and `express-rate-limit` logged `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`.

**Fix.** `createApp()` now calls `app.set('trust proxy', …)` before any middleware, with the value read from the new `TRUST_PROXY` environment variable by `backend/src/lib/trustProxy.js`:

| `TRUST_PROXY` | Express setting | When |
|---|---|---|
| not set, `false`, `0` | `false` (default, unchanged behaviour) | local development, nothing in front of the API |
| `1` … `10` | that many proxy hops | **Render: `1`** |
| `loopback` | trust proxies on the same machine | local testing with smee-client / ngrok |
| `10.0.0.0/8,127.0.0.1` | a list of IPs / subnets | a proxy with known addresses |

`TRUST_PROXY=true` is **refused** (logged, falls back to `false`): it would trust any `X-Forwarded-For` value, so a client could pick a new fake IP on every request and never be rate limited. Anything else the parser does not understand also falls back to `false` with a warning in the log, so a typo never makes the API less safe.

**Set it on Render:** *Dashboard → the API service → Environment → Add Environment Variable* → `TRUST_PROXY` = `1` → *Save Changes* (Render redeploys).

### D2 (Low): "GitHub issue updated" on an issue that was opened

**Problem.** The Activity title came only from the entry type, so every issue entry said *GitHub issue updated* (and every pull request *Pull request updated*), even when the sentence below said *opened issue #1*.

**Fix.** `activityLook()` in `frontend/src/components/activityDisplay.js` now uses `meta.action`, which the backend already stores for every GitHub entry (`backend/src/lib/githubEvents.js`). No backend or database change, so existing entries get the right title too.

| Type | `meta.action` → title |
|---|---|
| `github.issue` | opened → *GitHub issue opened*, edited → *GitHub issue updated*, closed → *GitHub issue closed*, reopened → *GitHub issue reopened* |
| `github.pull_request` | opened → *Pull request opened*, edited / synchronize → *Pull request updated*, closed → *Pull request closed*, merged → *Pull request merged*, reopened → *Pull request reopened* |

A missing or unknown action shows the neutral *GitHub issue* / *Pull request*, which is also what the Activity type filter lists. Pull requests had the same wording problem, so they were fixed the same way.

### Tests

- `backend/test/trustProxy.test.js`: the parser (off values, hop counts, `true` refused, lists, bad input), and the real app: with `TRUST_PROXY=1` or `loopback`, one client using up the 120-request limit does **not** block a second client behind the same proxy, and no `ERR_ERL_…` error is logged. Needs no MongoDB.
- `frontend/src/components/GithubEvents.test.jsx`: titles by action, neutral fallback, and the exact exit-check case (an opened issue shows *GitHub issue opened*).

```
npm test --prefix backend -- test/trustProxy.test.js
npm test --prefix frontend -- GithubEvents
```

---

## Sprint 6 — M3: Ask the Copilot (US-41, FR-16a, NFR-9, NFR-10a, NFR-10b)

Project members (every role, Viewer included) type a question of up to **500 characters** in the **Ask the Copilot** panel on the project page and get an answer, typically within 10 seconds. If the answer takes longer than **2 seconds**, a loading indicator shows until the answer or an error arrives. If the AI provider is down, slow or not set up, the panel says **AI temporarily unavailable** and chat, tasks and feeds keep working.

This PR also adds the **shared LLM client** (`backend/src/lib/llmClient.js`) that M4 (US-42, US-43) and M5 (US-44 Catch Me Up) build on.

### Setup (once per environment)

In `backend/.env` (locally) or the Render API service's *Environment* (deployed):

| Setting | Value |
|---|---|
| `LLM_PROVIDER` | `anthropic` (Claude, default) or `openai` (OpenAI, or any OpenAI-compatible API) |
| `LLM_API_KEY` | the provider's API key. **Server only**, never in `frontend/.env`. Empty = AI off (the Copilot answers *AI temporarily unavailable*). |
| `LLM_MODEL` | optional for `anthropic` (default `claude-haiku-5-5`), **required** for `openai`: the model ID from your provider's docs |
| `LLM_BASE_URL` | only for an OpenAI-compatible provider other than OpenAI (must be `https://`) |
| `LLM_TIMEOUT_MS` | optional, 1000–60000, default `15000` |
| `LLM_MAX_OUTPUT_TOKENS` | optional, 50–4000, default `500` (short answers keep the reply near 10 seconds) |

On start, the API logs `AI Copilot is turned off until these are set in backend/.env: …` (names only, never values) when something is missing.

### API: `POST /api/projects/:id/copilot/ask`

Body `{ "question": "…" }`. Signed-in project members only.

| Status | Body | When |
|---|---|---|
| 200 | `{ question, answer, shortened, askedAt, answeredAt, durationMs }` | answered. `question` is what was sent (trimmed); `shortened` is true when the answer was cut |
| 400 | `{ code: "QUESTION_REQUIRED", message }` | missing, empty or blank question |
| 400 | `{ code: "QUESTION_TOO_LONG", message }` | more than 500 characters after trimming |
| 401 / 403 / 404 | `{ message }` | not signed in / not a member (Public projects too) / no such project (400 for an invalid ID) |
| 503 | `{ code: "AI_UNAVAILABLE", message }` + `Retry-After: 30` | the AI provider failed, timed out, refused the request, or no key is set |

The Copilot **only answers**: this route writes nothing (no database change, no activity entry, no notification), and the question and answer are not stored or logged.

### How the outage handling works (NFR-9)

- Every request has one deadline, `LLM_TIMEOUT_MS`, for the whole reply.
- Every failure (no key, timeout, network error, HTTP 429 / 5xx / other 4xx, empty or unreadable reply) becomes `AiUnavailableError`, which the route turns into 503.
- After **3 failures in a row** the client **pauses for 30 seconds**: calls fail at once instead of each one waiting for the timeout, so an outage cannot tie up the API. The first call after the pause is a trial; success resumes normal calls.
- Log lines name only the provider, the reason and the HTTP status. The API key, the question, the prompt and the answer are never logged or returned.

### For M4 and M5: using the shared client

```js
import { getLlmClient, isAiUnavailable } from '../lib/llmClient.js';

try {
  const { text, truncated, usage } = await getLlmClient().complete({ system, messages: [{ role: 'user', content }] });
} catch (error) {
  if (isAiUnavailable(error)) return res.status(503).json({ code: 'AI_UNAVAILABLE', message: '…' });
  throw error;
}
```

`usage.inputTokens` / `usage.outputTokens` come from the provider. In tests, replace the client with `setLlmClient(fake)` and restore it with `setLlmClient(null)` (see `backend/test/copilot.test.js`). M4 adds the permitted project records and the 8,000-token budget where `buildCopilotPrompt()` is called in `backend/src/routes/copilot.js`; until then the prompt tells the model that no project records are attached, so it does not invent project facts.

### Tests

- `backend/test/llmClient.test.js` (no MongoDB): settings, both providers' request and reply formats, error → reason mapping, the timeout, the pause after 3 failures and the trial call, the API key never in errors, logs or `status()`.
- `backend/test/copilotRules.test.js` (no MongoDB): the 500 / 501 boundary, trimming, blank and non-text questions, the prompt (question only in the user message), long answers.
- `backend/test/copilot.test.js`: the API with a fake AI client: 401 / 400 / 404 / 403 (Public projects too), every role can ask, 200 shape, 500 vs 501 characters, 503 + `Retry-After`, **tasks, chat, activity, posts and dashboard still work while the AI is down**, the real client with no key fails fast, nothing is written to the database.
- `frontend/src/components/CopilotPanel.test.jsx`: counter and limit, Enter / Shift+Enter, one question at a time, **no indicator before 2 s, indicator from 2 s until the answer or error**, AI-unavailable message with the question kept for a retry, plain-text answers, switching projects.

```
npm test --prefix backend -- test/llmClient.test.js test/copilotRules.test.js test/copilot.test.js
npm test --prefix frontend -- CopilotPanel
```

---

## Sprint 6 — M2: Direct messages (US-19, FR-6, NFR-1b)

**What it does.** Any logged-in user can talk privately with another user, outside every project channel.

- **AC1.** Another user's profile (`/people/:username`) has a **Message** button next to Follow (not on your own profile). It opens the conversation with that person at `/messages/:conversationId`, creating it the first time. There is exactly one conversation per pair of users (unique `pairKey`), whoever presses Message first, even if both press it at the same moment.
- **AC2.** A sent message is saved, then pushed over the existing Socket.IO server to the two participants' own rooms (`user:<id>`) only: the recipient sees it live, and the sender's other tabs too. Delivery is measured under 1 second in `backend/test/directMessagesRealtime.test.js`. Anyone else asking for the conversation gets **404**, the same answer as for one that does not exist.
- **Separate from projects.** Own collections (`directconversations`, `directmessages`) with no project or channel field. Nothing is written to channels, the Activity Feed or notifications, so no project query (chat, feed, Copilot) can pick up a DM.
- **Messages page** (`/messages`, sidebar link **Messages**): inbox newest first with a one-line preview ("You: …" when you wrote last) and unread counts; the open conversation with "Show older messages", Enter to send, Shift+Enter for a new line. The sidebar badge shows unread direct messages and updates live. On a phone the inbox and the conversation are shown one at a time.
- **Unread** = messages from the other person after your last read. It is counted from the messages themselves (never a stored counter that can drift). Opening a conversation, or replying in it, marks it read.
- **Limits (NFR-21, spam guard):** 1–4,000 characters of text (trimmed, line breaks kept); at most **30 messages per minute** per user (429 with `Retry-After`). A conversation without messages shows only in the inbox of the person who opened it.

| Call | Who | Response |
|---|---|---|
| `GET /api/direct-messages` | logged in | `{ conversations, unreadTotal }`, newest activity first (max 50) |
| `GET /api/direct-messages/unread-count` | logged in | `{ unreadTotal }` |
| `POST /api/direct-messages` `{ username }` | logged in | `{ conversation }`; 400 no username, 400 `self_message`, 404 unknown user |
| `GET /api/direct-messages/:conversationId` | the 2 participants | `{ conversation }`; 400 bad ID, 404 otherwise |
| `GET /api/direct-messages/:conversationId/messages?limit=1..100&before=<messageId>` | the 2 participants | `{ messages (oldest first), nextBefore }` |
| `POST /api/direct-messages/:conversationId/messages` `{ body }` | the 2 participants | 201 `{ message, conversation }`; 400 empty / too long / not text, 429 too fast, 410 the other account no longer exists |
| `POST /api/direct-messages/:conversationId/read` | the 2 participants | `{ unreadCount: 0, unreadTotal }` |

`conversation = { _id, otherUser: { _id, name, username, avatarUrl }, lastMessage: { preview, at, fromMe } | null, unreadCount, activityAt, createdAt }` and `message = { _id, conversation, sender: { _id, name, username, avatarUrl }, body, createdAt }`. No email or other private field is ever sent.

**Live events** (`lib/realtime.js`, new `emitToUser`): `dm:message { conversationId, message, conversation, unreadTotal }` to each participant with their own view, and `dm:read { conversationId, unreadTotal }` to the reader's other tabs.

**Files:** backend `models/DirectConversation.js`, `models/DirectMessage.js`, `lib/directMessageRules.js`, `lib/directMessages.js`, `routes/directMessages.js`; small edits in `app.js` (mount), `lib/realtime.js` (`emitToUser`), `seed/seedData.js` (removes seed users' DMs). Frontend `pages/MessagesPage.jsx`, `components/DmInbox.jsx`, `components/DmConversation.jsx`, `components/MessageUserButton.jsx`, `components/DmUnreadBadge.jsx`, `directMessages.js`, `directMessageApi` in `api.js`; edits in `App.jsx` (routes), `components/AppShell.jsx` (sidebar link + badge), `pages/UserProfilePage.jsx` (Message button), `styles.css`.

**Tests:** `backend/test/directMessageRules.test.js` (no database), `directMessages.test.js` (API + MongoDB), `directMessagesRealtime.test.js` (Socket.IO, under 1 second, privacy); `frontend/src/directMessages.test.js`, `pages/MessagesPage.test.jsx`, `pages/UserProfilePage.message.test.jsx`, `components/DmUnreadBadge.test.jsx`; `e2e/tests/direct-messages.spec.js` (two browsers + a third user).

```
npm test --prefix backend -- test/directMessageRules.test.js test/directMessages.test.js test/directMessagesRealtime.test.js
npm test --prefix frontend -- directMessages MessagesPage UserProfilePage DmUnreadBadge
```

---

## Sprint 6 — M4: Copilot answers grounded in project data (US-42, US-43, FR-16b, FR-16c, FR-36, NFR-10b)

Builds on M3's **Ask the Copilot** (same panel, same `POST /api/projects/:id/copilot/ask`). Answers now come only from the project's own data, show their sources, and say so when the data cannot answer.

**What the Copilot may read (US-42 AC1).** Only after the member check, and only from **this** project: tasks (with assignee, due date, milestone), task comments, decisions, channel messages and thread replies, and GitHub activity (commits, issues, pull requests from the signed webhook). Every member role, Viewer included, can read all of these, so they all get the same data. Never used: direct messages, notifications, files, docs, other projects, e-mail addresses (people appear as `Name (@username)`). Every query is filtered by project, and `permittedRecords()` checks the result again before anything is ranked or sent.

**8,000-token limit (US-42 AC2, NFR-10b).** Each request (system prompt + records + question) is kept within **8,000 input tokens** (`COPILOT_MAX_INPUT_TOKENS` in `backend/.env` can lower it to 2,000–8,000; higher values are ignored). How it is trimmed, the same way every time:

1. The newest rows of each kind are read: up to 200 tasks, 150 comments, 100 decisions, 300 messages, 150 GitHub events. Older rows are counted as left out.
2. Long fields are cut to a fixed length: task description 400 characters, decision description 600, message 500, comment 400, titles 200.
3. Records are ranked: a word of the question in a record's title scores 3, elsewhere 1, and +2 when the question names the record's kind ("tasks", "commits", "decided" …). Ties: newest first, one of each kind in turn.
4. Records are added in that order while the estimate stays within the budget; a record that does not fit is left out whole. Tokens are estimated on the safe side (about 30 % above a real tokenizer for English), and the provider's own count is returned as `context.providerInputTokens` for checking.

The answer says how many records it used and how many were left out (`context`), and the panel shows it: *"Based on 46 of 312 project records you can see. The rest were left out to stay within the 8,000-token AI input limit (least related and oldest first)."*

**Sources (US-42 AC1, FR-16c).** Records are given ids (`T1` task, `D1` decision, `M1` message, `C1` comment, `G1` GitHub) and the AI must cite them, e.g. `… is blocked [T2].` Ids it made up are removed. The panel turns each citation into a numbered link and lists the sources under the answer. Links: a task or comment opens the task, a message opens it in its channel (a thread reply opens the thread), a decision opens the Decisions tab scrolled to it (**new link:** `/project/<id>?tab=decisions&decision=<decisionId>`), a GitHub event opens github.com in a new tab.

**Not enough project data (US-43, FR-36).** If the AI answers `NOT_ENOUGH_PROJECT_DATA`, or gives an answer that cites no record, the member sees a fixed *"I don't have enough project data to answer that…"* in a **Not enough project data** box, with no sources, so no unsupported project-specific claim is shown. A project with no records gets this at once, without asking the AI.

**Read-only.** The Copilot never creates or changes data: the route only reads, and its tests check that no collection changes.

**API change** (`200` response, new fields): `insufficient` (boolean), `sources` (`[{ ref, type, label, detail, link, external, at }]`, in order of first use), `context` (`{ budgetTokens, estimatedTokens, providerInputTokens, included, available, leftOut, trimmed }`, counts per kind plus `total`). Errors are unchanged from M3 (400 / 401 / 403 / 404 / 503).

**Files:** backend `lib/copilotGrounding.js` (pure rules: records, permission filter, ranking, budget, prompt, reading the answer), `lib/copilotContext.js` (loads the project's records), `routes/copilot.js` (uses them); small edits in `lib/copilotRules.js` (comment), `.env.example`. Frontend `copilotAnswer.js` (citations, safe links, context line), `components/CopilotPanel.jsx` (sources, citations, not-enough-data box), `components/DecisionsPanel.jsx` + `pages/ProjectPage.jsx` (`?decision=` link), `styles.css`.

**Tests:** `backend/test/copilotGrounding.test.js` (no database), `backend/test/copilotGrounded.test.js` (API + MongoDB, fake AI), `backend/test/copilot.test.js` (M3's tests, updated: answers now cite a record); `frontend/src/copilotAnswer.test.js`, `components/CopilotPanel.sources.test.jsx`, `components/DecisionsPanel.highlight.test.jsx`.

```
npm test --prefix backend -- test/copilotGrounding.test.js test/copilotGrounded.test.js test/copilot.test.js
npm test --prefix frontend -- copilotAnswer CopilotPanel DecisionsPanel
```

---

## Sprint 6 — M6: Report a public post (US-55, FR-27, NFR-19, NFR-21, NFR-26)

A logged-in user can **report someone else's public post**, choosing a reason. The report is stored as **open**, which is what puts it in the **moderator queue** (US-56). Reporting the same post a second time tells the user **"You have already reported this post."**

**Where to find it:** Community feed (`/feed`), Trending or Latest. Every post that is **not yours** has a 🚩 **Report post** button at the top right (your own posts have Edit/Delete instead).
1. Click 🚩 → **Report this post** opens. It first asks the server whether you already reported this post (*Checking…*).
2. Pick one reason, optionally add details, click **Send report**.
3. The dialog closes and the card says *"Thanks. Your report was sent to the moderators."* The post itself does not change (same text, votes and score; a report alone hides nothing, only a moderator's **Remove** does, US-56).
4. Click 🚩 again (now red) → *"You have already reported this post."* with an **OK** button and no form. After a reload the server says the same.

**Rules (the same values are used by the server, the browser and the tests)**

| Rule | Value | When broken |
|---|---|---|
| Reason | exactly one of `spam` (Spam or misleading), `harassment` (Harassment or bullying), `hate` (Hate speech or symbols), `violence` (Violence or threats), `explicit` (Sexual or explicit content), `other` (Something else) | 400 "Choose a reason for your report." |
| Details | optional text, up to **300** characters after trimming; **required** for *Something else* | 400 "Report details must be 300 characters or fewer." / "Tell the moderators what is wrong with this post." |
| One report per user per post | unique index on `PostReport { post, reporter }` | 409 "You have already reported this post." (also when the first report was already resolved) |
| Own post | you cannot report your own post | 400 `own_post` |
| Who | any logged-in user | 401 without login, 404 unknown or deleted post |

- The same report sent many times at the same moment is stored **once** (the unique index decides, not a read-then-write check); the others get the 409 answer.
- If the author **deletes** a reported post (US-51), its **open** reports leave the queue (nothing is left to review). Reports a moderator already resolved stay as history.
- Reporters are never shown to anyone in any response; the report count is only for moderators.

**API** (login needed)

| Call | Body | Answer |
|---|---|---|
| `GET /api/posts/:postId/report` | none | `{ reported: true \| false, report \| null }` (only your own report) |
| `POST /api/posts/:postId/report` | JSON `{ reason, details? }` | 201 `{ report, message: "Thanks. Your report was sent to the moderators." }`; 400 `{ message, field }` or `{ message, code: 'own_post' }`; 404; 409 `{ message: "You have already reported this post.", code: 'already_reported', report }` |

`report`: `{ _id, post, reason, reasonLabel, details, status: 'open' | 'resolved', createdAt }`.

**For M7 (US-56 moderator queue):** the data is ready in `backend/src/lib/postReports.js`:
- `openReportQueue({ limit, postId })` → `[{ postId, reportCount, reasons: [{ reason, label, count }], firstReportedAt, lastReportedAt }]`, one entry per post with **open** reports, the one waiting longest first. This is exactly "each reported post with its reason and report count" (US-56 AC1); add the moderator check (403) and the page on top.
- After **Remove / Warn / Dismiss**, set the post's open reports to `status: 'resolved'` (add `resolvedBy`, `resolvedAt`, `action` to `models/PostReport.js` if you need them). Resolved reports leave the queue automatically.
- If **Remove** deletes the post through your own code, mark the reports resolved *before* deleting (the author-delete route removes only open reports).

**Files:** backend `lib/reportRules.js` (rules, no database), `models/PostReport.js`, `lib/postReports.js`, `routes/postReports.js`; small edits in `app.js` (1 route, before `/api/posts`) and `routes/posts.js` (open reports removed when the author deletes the post). Frontend `reports.js` (same rules), `components/ReportPostDialog.jsx`, the 🚩 button and success message in `components/PostCard.jsx`, `postApi.reportStatus` / `postApi.report` in `api.js`, styles at the end of `styles.css`.

**Tests:** `backend/test/reportRules.test.js` (no database), `backend/test/postReports.test.js` (API + MongoDB: both acceptance criteria, the moderator-queue data, 8 identical reports at once, bad input, own post, deleted post, and that reporting does not change the post, its votes or the feed); `frontend/src/reports.test.js`, `components/ReportPostDialog.test.jsx`, `components/PostCard.report.test.jsx`; `e2e/tests/report-post.spec.js` (two users in a real browser).

```
npm test --prefix backend -- test/reportRules.test.js test/postReports.test.js test/posts.test.js test/postVotes.test.js test/trending.test.js
npm test --prefix frontend -- reports ReportPostDialog PostCard FeedPage TrendingFeed
```

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

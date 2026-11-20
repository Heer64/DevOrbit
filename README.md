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
npm run seed -- --reset    # removes the demo accounts, their projects and what was made with them, then adds them again
```

It prints the demo logins (`aarav@seed.devorbit.test` and others, password `DevOrbit@2026`, or `SEED_PASSWORD` from `backend/.env`). `admin@seed.devorbit.test` is the Platform Admin (Sprint 6 M8). It never touches other data and refuses to run when `NODE_ENV=production`.

### Resetting demo data on Windows PowerShell

On Windows PowerShell, the standalone `--` separator may not be forwarded correctly by npm. Open PowerShell in the `backend` folder and run either:

```powershell
npm run seed '--' --reset
```

Or run the script directly:

```powershell
node scripts/seed.js --reset
```

Both commands pass `--reset` to the seed script.

**Warning:** Reset deletes and recreates the demo accounts, their projects and associated test data. Use only with a development database. The seed script refuses to run when `NODE_ENV=production`.

`--reset` also removes everything made with the demo accounts or inside the demo projects while you tested: decisions, docs, task comments, files (and their stored bytes), invitations, join requests, notifications, GitHub connection records, posts (with images), votes, reports, post comments and replies, follows, direct messages, sessions, password reset links and profile photos. A real post a demo account voted on or commented on is recounted (a demo comment that a real user replied to stays as "Comment deleted", so the real reply is kept). A GitHub webhook created for a demo project is not removed on GitHub (the seed works offline): delete it in the repository's Settings → Webhooks.

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
- **Platform Admin:** set `PLATFORM_ADMIN_EMAIL` and `PLATFORM_ADMIN_PASSWORD` on the API service to create the first Platform Admin when the server starts (the seed script never runs in production). See *Sprint 6 — M8* below.

---

## Sprints at a glance

DevOrbit was built in six sprints. Sprint 2 was split into pairs (one backend and one frontend developer each). From Sprint 3 on, each sprint was split into eight parts, **M1 to M8**, one per developer, plus two testers who tested and deployed each sprint.

| Sprint | Focus | User stories |
|---|---|---|
| [Sprint 1](#sprint-1--accounts-profiles-and-projects) | Accounts, profiles, projects and roles | US-01, US-02, US-03, US-05, US-08, US-09 |
| [Sprint 2](#sprint-2--tasks-milestones-kanban-board-and-channels) | Tasks, milestones, Kanban board, activity log, project channels | US-16, US-21, US-23, US-27, US-28 |
| [Sprint 3](#sprint-3--team-collaboration) | Invitations, join requests, members, threads, comments, @mentions, due dates, decisions, notifications | US-10, US-11, US-12, US-13, US-14, US-17, US-18, US-20, US-23, US-30, US-35, US-36, US-47 |
| [Sprint 4](#sprint-4--github-integration-dashboard-files-and-docs) | GitHub OAuth, repository, webhooks into the feed, project dashboard and health, files, docs | US-15, US-31, US-32, US-33, US-34, US-37, US-38, US-39, US-40 |
| [Sprint 5](#sprint-5--the-public-side) | Discover, public project page, profiles and privacy, portfolio, posts, votes, trending feed, follows | US-06, US-07, US-45, US-46, US-47, US-48, US-49, US-50, US-51, US-52, US-53, US-54 |
| [Sprint 6](#sprint-6--final-sprint-ai-copilot-messages-moderation-and-fixes) | Defect fixes, password reset, direct messages, AI Copilot, Catch Me Up, reporting and moderation, platform roles | US-04, US-19, US-41, US-42, US-43, US-44, US-55, US-56, US-57, US-58 |

---

## Sprint 1 — Accounts, profiles and projects

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

**What we built**

- Project setup: repo, branches, and a basic way to run tests automatically
- Sign up, log in and log out, with passwords saved as a salted hash (never plain text)
- Profile page where users can add a photo (JPEG or PNG, up to 2 MB), a bio (up to 500 characters) and up to 10 skill tags
- Create a project with a name, description, domain and Public or Private visibility. The creator becomes the Owner
- Project roles (Owner, Admin, Contributor, Viewer), checked by the server. For example, a Viewer can't change roles
- **Finished later (after Sprint 5):** the last Sprint 1 plan items. The API now only accepts domains from a fixed list, a new project can start with members, profile photos are kept in MongoDB GridFS so a redeploy doesn't delete them, and the team setup was added: PR template, ESLint, Prettier, `.editorconfig` and the `npm run seed` demo data.

**Sprint 1 was done when**

- A new user can register, log in, edit their profile and create a project
- Role rules work (for example, a Viewer can't change roles)
- Tests pass and the setup steps work on a fresh clone

---

## Sprint 2 — Tasks, milestones, Kanban board and channels

**Focus:** plan and track the team's work inside a project, see what changed, and talk in project channels.

**User stories**

| Story | What it is |
|-------|-----------|
| US-16 | Project channels (Chat tab) |
| US-21 | Task label |
| US-23 | Upcoming deadlines on the dashboard |
| US-27, US-28 | Kanban board |

**What we built**

- **Tasks:** create, assign, edit and delete tasks with priority, status, an optional label (up to 30 characters) and an optional milestone
- **Milestones** (Pair C): create, edit and delete. Each milestone shows its progress, worked out from its tasks, and tasks can be filtered by milestone.
- **Activity log** (Pair C): project, member, task and milestone changes are recorded. Each project has its own feed, and there is a list of your latest activity across all your projects
- **Kanban board** (Pair D): a List / Board switch with four columns: To Do, In Progress, Blocked and Done. You can drag a card or use **Move to**. A move shows at once and is undone if the server refuses it. Each task has a `version` number, so saving an out-of-date copy returns **409** instead of overwriting someone else's change.
- **Live updates** with Socket.IO: tasks that teammates create, change or delete appear without reloading the page
- **Dashboard task views:** Upcoming deadlines, My tasks, and the "Tasks completed" and "Assigned to me" cards.
- **Discover uses real data:** public projects and people search now come from the API
- **Project channels:** `#general` is created automatically and Owners and Admins can add more channels. Viewers can only read. Messages are pushed live to members only, and there are links that open a task or a channel directly.
- **Testing:** CI now runs the frontend tests, and Playwright end-to-end tests run in CI as a second job

---

## Sprint 3 — Team collaboration

**Focus:** bring people into a project and let the team work together: invitations, join requests, threads, comments, @mentions, deadlines, decisions and notifications.

| Part | User stories | What we built |
|---|---|---|
| M1 | US-10, US-11 | Owners and Admins invite an existing user with a role. The invited user accepts or declines, and an invitation expires after 7 days |
| M2 | US-12, US-47 | A non-member asks to join a Public project. An Owner or Admin approves it (choosing a role) or rejects it, and a rejected user can ask again after 7 days |
| M3 | US-13, US-14 | Remove a member or leave a project, after a confirmation dialog. Access ends at once, live connections included. The Owner can't be removed. The person's earlier messages and tasks stay |
| M4 | US-17, US-20 | Thread replies with a reply count, and task comments showing the author, the time and @mentions |
| M4 extra | US-18 | @mentions in channel messages and thread replies, with suggestions while you type and a Mention notification |
| M5 | US-23 | Due dates are stored as calendar days (UTC), so every member sees the same day. Tasks show *due today*, *due tomorrow* or *overdue*, and the server can list tasks that are due within 24 hours |
| M7 Part 1 | US-30 | Storage and an API for notifications: list them, count unread ones and mark them read |
| M7 Part 2 | US-30 | Mention, Assignment and Deadline notifications are created automatically and pushed live to the bell in the top bar |
| M8 | US-35, US-36 | A Decisions tab where members record and edit decisions: title, description, people involved, date and a link to a task or chat thread |

---

## Sprint 4 — GitHub integration, dashboard, files and docs

**Focus:** connect each project to its GitHub repository, give Owners and Admins an overview of the project, and add files and documentation pages.

| Part | User stories | What we built |
|---|---|---|
| M1 | US-31 | The Owner connects GitHub with OAuth. The callback checks a one-time state value, and the access token is encrypted (AES-256-GCM). It is never sent to the browser or written to the logs |
| M2 | US-32 | The Owner picks one repository from their GitHub account, and the connection shows as **Active** |
| M3 | US-33 | Owners and Admins can see the connection status, check it, disconnect and re-authorize. After a disconnect, new events stop and old feed entries stay |
| M4 | US-34 | Signed GitHub webhooks put commits, issues and pull requests into the Activity feed live. Failed deliveries are retried, duplicates are dropped, and Owners and Admins can see a delivery log |
| M5 | US-37 | A Files tab: upload a file of up to 10 MB, stored in MongoDB GridFS, and download it safely |
| M6 | US-38 | A Docs tab: Markdown pages of up to 10,000 characters, shown with a safe renderer (no HTML runs) |
| M7 | US-39 | A Dashboard tab: progress of each milestone, the number of open tasks and the tasks due in the next 7 days |
| M8 | US-15, US-40 | The Owner marks a project complete or reopens it. Owners and Admins see the project's health: overdue tasks, blocked tasks and how active the project is |

---

## Sprint 5 — The public side

**Focus:** the public, social side of DevOrbit: discovering projects, public profiles and portfolios, and a community feed with posts, votes, trending and follows.

| Part | User stories | What we built |
|---|---|---|
| M1 | US-45 | Discover public projects without logging in. Search by keyword and filter by domain, skill tag and status; the filters are kept in the link, and results come in pages |
| M2 | US-46, US-47 | A public project page (`/discover/:id`) where visitors can ask to join. Tasks and live updates are now for members only |
| M3 | US-06, US-07 | View another user's profile (read-only). Each user has two privacy switches: appear in collaborator search, and a public portfolio |
| M4 | US-48 | Find a collaborator by skill tag: the search ignores letter case, people with more matching tags come first, and people who turned off collaborator search are left out |
| M5 | US-49 | A portfolio of the user's Completed projects with their role and contribution numbers (counted again if more than 24 hours old), shareable at `/portfolio/:username` |
| M6 | US-50, US-51 | Community feed: post up to 500 characters with an optional image of up to 5 MB, edit or delete your own posts, at most 10 posts per hour |
| M7 | US-52 | Upvote or downvote a post, change your vote or take it back. Each user has one vote per post, and the counts stay correct when many people vote at once |
| M8 | US-53, US-54 | A Trending feed, Follow / Unfollow, and each profile shows its follower count and total vote score |

---

## Sprint 6 — Final sprint: AI Copilot, messages, moderation and fixes

**Focus:** the final sprint. It fixed the defects found in the Sprint 4 exit checks and added password reset, direct messages, the AI Copilot and Catch Me Up, and reporting and moderation for the community feed.

| Part | User stories | What we built |
|---|---|---|
| M1 | D1, D2 | D1: rate limits now work behind Render's proxy (`TRUST_PROXY`). D2: GitHub issue and pull request entries now show the right title (*opened*, *closed*, *merged* …) |
| M1 | US-04 | Reset your password by email. The link works once and expires after 1 hour, an unregistered email gets the same message, and a reset logs the user out on every device |
| M2 | US-19 | Private direct messages between two users, delivered live, with an inbox and an unread badge |
| M3 | US-41 | **Ask the Copilot** (questions of up to 500 characters) and a shared AI client. If the AI provider fails, the panel says *AI temporarily unavailable* and the rest of the app keeps working |
| M4 | US-42, US-43 | Copilot answers use only this project's data, stay within an 8,000-token budget and cite their sources. When the data can't answer the question, the Copilot says so |
| M5 | US-44 | **Catch me up:** an AI summary of what other members did since your previous login |
| M6 | US-55 | Report someone else's public post with a reason. The report goes to the moderator queue, and reporting the same post twice says *already reported* |
| M7 | US-56 | Moderator queue with **Remove**, **Warn** and **Dismiss**, and a log of moderation decisions. Requesters are also notified when their join request is approved or declined |
| M8 | US-57, US-58 | Platform roles and an Admin panel: make or remove Content Moderators, suspend and reactivate accounts. The first Platform Admin comes from the seed script or environment variables |

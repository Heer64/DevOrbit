# DevOrbit — Original UI + Backend Integration

This version preserves the original multi-component DevOrbit interface and wires the requested features to the Express/MongoDB backend. The login, signup, dashboard, profile, discovery, and project-workspace screens remain separate React components.

## Implemented

- Email/password signup and login using MongoDB-backed accounts and `bcryptjs` password hashing.
- Protected React routes and protected Express APIs.
- 15-minute access JWTs held in frontend memory, with a rotating 7-day refresh session in a Secure/HttpOnly cookie in production.
- Session restoration when the page reloads, plus server-side logout/revocation.
- Profile read/update through `/api/profile/me`; bio (max 500 characters), skills (max 10), GitHub URL, and LinkedIn URL are persisted.
- Profile photo upload (JPEG or PNG, max 2 MB). The server checks the file's real bytes, not just its name or type, and stores it under `backend/uploads/` (override with `UPLOAD_DIR`).
- Project create/list/read/update endpoints backed by MongoDB. The create form asks for name, description, domain and Public/Private visibility; the creator becomes the Owner.
- Project roles (Owner, Admin, Contributor, Viewer) enforced on the server with a 403 for anything not allowed, plus a "Team & roles" panel on the project page to add members and change roles.
- Automated backend tests and a GitHub Actions workflow (`.github/workflows/ci.yml`) that runs them on every push and pull request.
- The interactive demo remains available through the existing login screen.

## Still demo/static by design

This iteration does not implement GitHub OAuth/live commits, persistent tasks and chat, notifications, or the AI Copilot. Discovery cards, project activity cards, task lists and commit recaps retain the existing prototype sample data until those APIs are added. Google/GitHub sign-in, email verification, password recovery, and 2FA are also deferred.

## Roles

| Role | Can do |
| --- | --- |
| Owner | Everything. Each project has exactly one Owner (its creator). The Owner role cannot be changed, removed or given to someone else yet. |
| Admin | Edit project details. Add Contributors and Viewers, change their roles, remove them. Cannot create other Admins or touch the Owner or other Admins. |
| Contributor | Open the project and see the team. Cannot edit settings or roles. |
| Viewer | Open the project and see the team. Read only. |

Anyone can leave a project they are a member of (except the Owner). Private projects return 403 to people who are not members.

API endpoints (all need a signed-in user):

- `GET /api/projects/:id/members` (any member)
- `POST /api/projects/:id/members` with `{ "identifier": "email or username", "role": "Viewer" }` (Owner/Admin)
- `PATCH /api/projects/:id/members/:userId` with `{ "role": "Contributor" }` (Owner/Admin)
- `DELETE /api/projects/:id/members/:userId` (Owner/Admin, or yourself to leave)
- `POST /api/profile/me/avatar` (multipart field `avatar`) and `DELETE /api/profile/me/avatar`

## Requirements

- Node.js 20+
- MongoDB running locally, or a MongoDB Atlas connection string

## Setup

### 1. Environment files

From this folder, copy the backend environment template:

```powershell
Copy-Item backend/.env.example backend/.env
```

Edit `backend/.env`:

```env
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/devorbit
JWT_SECRET=replace-with-a-random-secret-at-least-32-characters-long
CLIENT_ORIGIN=http://localhost:5173
NODE_ENV=development
```

Generate a new random secret for your own local environment. Never commit `.env` to Git. If you use MongoDB Atlas, put its connection string in `MONGODB_URI`.

Optional frontend override: copy `frontend/.env.example` to `frontend/.env` and set `VITE_API_URL=http://localhost:5000/api` if needed.

### 2. Install dependencies

Run from this folder:

```powershell
npm run install:all
```

### 3. Start backend and frontend

Open two terminals in this folder.

Terminal 1:

```powershell
npm run dev:backend
```

Terminal 2:

```powershell
npm run dev:frontend
```

Open the URL Vite prints, usually <http://localhost:5173>.

Backend health check: <http://localhost:5000/api/health>.

## Running the automated tests

```powershell
npm test
```

The tests start the API in-process and talk to a real MongoDB. Two ways to give them one:

- Do nothing: `mongodb-memory-server` downloads a temporary MongoDB the first time (needs internet, about 100 MB, cached afterwards) and runs it in memory.
- Or use a MongoDB you already run: set `MONGODB_URI_TEST` (for example `mongodb://127.0.0.1:27017`). Each test run uses its own throwaway database and never touches `devorbit`.

They cover sign up, log in and log out (including hashed passwords), profile limits, photo upload rules, project creation and the role rules (for example a Viewer getting 403 when changing roles). `npm run ci` does a clean install, runs the tests and builds the frontend, which is what GitHub Actions does.

## Testing the database-backed flow

1. Register through the signup screen.
2. Create a project from the dashboard or sidebar.
3. Edit your profile bio, skills and social URLs.
4. Open a project, add a second account by email or username from "Team & roles", change their role, then sign in as them and check that a Viewer sees the team but has no controls.
5. Refresh the browser — the session should be restored from the HttpOnly refresh cookie, and the profile/project data should be loaded from MongoDB.
6. Log out and verify protected pages return to the login screen.

## Notes

- The backend uses `MONGODB_URI` (not `MONGO_URI`).
- The frontend stores the short-lived access token in memory; it does not persist the token in localStorage.
- Project role checks are enforced in Express. Only project Owners/Admins can edit project metadata or manage members; see the Roles section.
- See `CONTRIBUTING.md` for the branch and pull request workflow.

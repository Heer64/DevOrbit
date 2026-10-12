
# DevOrbit

DevOrbit is a web app where student and developer teams can work on projects together. You can chat with your team, manage tasks, see your GitHub activity, and ask an AI assistant questions about your project. There is also a public side where people can post, vote, follow each other and find projects to join.

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

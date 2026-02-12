# Module 00 — Roadmap & Philosophy

## What This Course Is

A progressive, hands-on course that takes you from an empty directory to a **deployed, production-ready** kanban app called **Flat Earth** — inspired by Fizzy (37signals' internal tool). Every module produces something you can see running in the browser.

You're a CS engineer. You know how software works. This course skips "what is a variable" and focuses on what's *different* about this stack: real-time by default, no REST API layer, no ORM, no migrations, no WebSocket plumbing, and a frontend that's always wired to live data.

## Core Principle

**"Running app first, vertical slices always."**

- You scaffold a running app in Module 01 — before writing a single line of backend code.
- Every module after that builds a complete feature: backend logic AND the UI that uses it.
- TypeScript is learned in context, not in isolation. You'll pick up union types while modeling card status, generics while using `Doc<"cards">`, and async/await while writing your first Convex mutation.

## What We're Building

Fizzy is a kanban tool built with Rails 8, MySQL, Hotwired, and Solid Queue. It has:

- 74 database tables, 161 model files, 56 Stimulus controllers
- Passwordless auth, multi-tenancy, real-time updates via Action Cable
- A card lifecycle state machine (drafted → published → triaged → closed/postponed)
- An entropy system that auto-postpones stale cards
- Webhooks, search, notifications, email bundling

**Flat Earth** rebuilds this with:

| Fizzy (Rails)             | Flat Earth                    |
|---------------------------|-------------------------------|
| Ruby on Rails 8.2         | TypeScript + Convex           |
| MySQL + SQLite            | Convex (document DB)          |
| ActiveRecord ORM          | Convex schema + functions     |
| Solid Queue (jobs)        | Convex scheduled functions    |
| Action Cable (WebSocket)  | Convex real-time (built-in)   |
| Turbo + Stimulus          | TanStack Start + React        |
| Magic links (custom)      | Clerk (auth provider)         |
| ERB templates             | React + Tailwind + shadcn/ui  |
| Kamal (Docker deploy)     | Vercel + Convex Cloud         |

The Convex stack eliminates most infrastructure: no ORM, no migrations, no WebSocket setup, no job queue, no separate search engine. Every query is automatically a real-time subscription.

> **Reference:** [docs/fizzy-analysis/00-overview.md](../fizzy-analysis/00-overview.md) for a complete breakdown of Fizzy's architecture.

## Prerequisites

### Install Bun

We use [Bun](https://bun.sh) as our runtime and package manager (not npm/node).

```bash
curl -fsSL https://bun.sh/install | bash
```

Verify:

```bash
bun --version  # Should print 1.x
```

### Editor Setup

Any editor works. VS Code with the following extensions is recommended:

- **TypeScript** — built in
- **Convex** — `convex.convex` (snippets, schema validation)
- **Tailwind CSS IntelliSense** — `bradlc.vscode-tailwindcss`
- **ESLint** — `dbaeumer.vscode-eslint`

### Accounts You'll Need

Create these before starting Module 01:

- **Convex** — [convex.dev](https://convex.dev) (free tier, no credit card)
- **Clerk** — [clerk.com](https://clerk.com) (free tier for development)
- **Vercel** — [vercel.com](https://vercel.com) (free tier, used in Module 12 for deployment)

## Course Structure

### Phase 1 — Scaffold & Connect (Modules 01–03)

Get a running app with real-time data and authentication in the first three modules.

| Module | Topic | What You'll See Running |
|--------|-------|------------------------|
| [01](./01-project-scaffolding.md) | Project Scaffolding & First Page | Styled landing page in the browser |
| [02](./02-adding-convex.md) | Adding Convex: First Real-Time Data | Two tabs syncing messages in real time |
| [03](./03-authentication.md) | Authentication with Clerk | Sign-in flow, protected routes |

### Phase 2 — Data Model & Core Features (Modules 04–06)

Build the schema, multi-tenancy, and the kanban board — backend and frontend together.

| Module | Topic | What You'll See Running |
|--------|-------|------------------------|
| [04](./04-schema-and-tenancy.md) | Schema Design & Multi-Tenancy | Account picker, tenant-scoped data |
| [05](./05-boards-and-columns.md) | Boards & Columns | Board list, create board, column management |
| [06](./06-cards-and-kanban.md) | Cards & the Kanban Board | Full kanban board with drag-and-drop |

### Phase 3 — Domain Logic & Access Control (Modules 07–08)

Implement the card state machine and permission system.

| Module | Topic | What You'll See Running |
|--------|-------|------------------------|
| [07](./07-card-lifecycle.md) | Card Lifecycle: State Machine | Status badges, action buttons, filtered views |
| [08](./08-permissions.md) | Permissions & Access Control | Role-based UI, public board sharing |

### Phase 4 — Collaboration & Polish (Modules 09–11)

Add the features that make a kanban tool actually useful, then polish for production.

| Module | Topic | What You'll See Running |
|--------|-------|------------------------|
| [09](./09-collaboration.md) | Collaboration Features | Comments, reactions, mentions, tags |
| [10](./10-background-jobs.md) | Background Jobs & Entropy | Auto-postpone warnings, notification list |
| [11](./11-production-patterns.md) | Production Patterns & Polish | Skeleton screens, search, pagination |

### Phase 5 — Ship It (Modules 12–13)

Deploy to production and explore what's next.

| Module | Topic | What You'll See Running |
|--------|-------|------------------------|
| [12](./12-deployment.md) | Deployment to Production | Your app live on a real URL |
| [13](./13-whats-next.md) | What's Next | Pointers for continued development |

## Using the Fizzy Analysis Docs

The `docs/fizzy-analysis/` directory contains a complete reverse-engineering of Fizzy:

| Document | What It Covers | Used In Modules |
|----------|---------------|-----------------|
| [00-overview.md](../fizzy-analysis/00-overview.md) | Product overview, tech stack, architecture | 00 |
| [01-database-schema.md](../fizzy-analysis/01-database-schema.md) | 74 tables, every column, every index | 04, 05, 06 |
| [02-domain-models.md](../fizzy-analysis/02-domain-models.md) | 161 model files, associations, state machines | 07, 09, 10 |
| [03-authentication-and-sessions.md](../fizzy-analysis/03-authentication-and-sessions.md) | Passwordless auth, magic links, sessions | 03 |
| [04-permissions-and-access-control.md](../fizzy-analysis/04-permissions-and-access-control.md) | Roles, board access, public boards | 08 |
| [05-multi-tenancy.md](../fizzy-analysis/05-multi-tenancy.md) | URL path tenanting, data isolation | 04 |
| [06-features.md](../fizzy-analysis/06-features.md) | Complete feature inventory | 05, 06, 09 |
| [07-dev-vs-production.md](../fizzy-analysis/07-dev-vs-production.md) | Environment config, deployment, CI | 12 |
| [08-frontend-and-realtime.md](../fizzy-analysis/08-frontend-and-realtime.md) | Hotwired, Stimulus, Action Cable | 06, 11 |

Each module references specific fizzy-analysis docs where relevant. You don't need to read them all upfront — the course introduces concepts progressively.

## Conventions

- All commands use `bun`
- Code examples show the Convex way of doing things (not Express, not Prisma)
- UI examples use Tailwind CSS and shadcn/ui components
- Exercises build on each other — complete them in order
- Every module has a "What you'll see running" section at the top
- When we say "query," we mean a Convex query function (reactive, read-only). When we say "mutation," we mean a Convex mutation function (transactional, read-write)

Let's start with [Module 01 — Project Scaffolding & First Page](./01-project-scaffolding.md).

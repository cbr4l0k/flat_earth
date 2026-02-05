# Module 00 — Roadmap

## What This Course Is

A progressive learning path that takes you from zero TypeScript/Convex experience to building **Flat Earth** — a kanban project management app inspired by Fizzy (37signals' internal tool). By the end, you'll have a production-ready app with real-time collaboration, multi-tenancy, and a full card lifecycle system.

You're a CS engineer. You know how software works. This course skips "what is a variable" and focuses on what's *different* about TypeScript, what's *unusual* about Convex, and how they fit together to replace a 74-table Rails monolith.

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
| ERB templates             | React components              |
| Kamal (Docker deploy)     | Vercel + Convex Cloud         |

The Convex stack eliminates most infrastructure: no ORM, no migrations, no WebSocket setup, no job queue, no separate search engine. Every query is automatically a real-time subscription.

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
- **ESLint** — `dbaeumer.vscode-eslint`

### Accounts You'll Need

- **Convex** — [convex.dev](https://convex.dev) (free tier, no credit card)
- **Clerk** — [clerk.com](https://clerk.com) (free tier for development)

## Course Phases

### Phase 1 — Foundations (Modules 01–02)

Get comfortable with TypeScript and understand what Convex is.

| Module | Topic | Key Outcome |
|--------|-------|-------------|
| [01](./01-typescript-essentials.md) | TypeScript Essentials | Read and write typed async code |
| [02](./02-convex-fundamentals.md) | Convex Fundamentals | First query + mutation running |

### Phase 2 — Core (Modules 03–06)

Build the data layer: schema, auth, multi-tenancy, CRUD.

| Module | Topic | Key Outcome |
|--------|-------|-------------|
| [03](./03-schema-design.md) | Schema Design | Full Convex schema defined |
| [04](./04-authentication.md) | Authentication | Clerk + Convex auth working |
| [05](./05-multi-tenancy.md) | Multi-Tenancy | Account isolation enforced |
| [06](./06-crud-operations.md) | CRUD Operations | Boards, columns, cards CRUD |

### Phase 3 — Domain Logic (Modules 07–09)

Implement the card lifecycle, real-time patterns, and permissions.

| Module | Topic | Key Outcome |
|--------|-------|-------------|
| [07](./07-card-lifecycle.md) | Card Lifecycle | State machine transitions |
| [08](./08-realtime.md) | Real-Time Updates | Reactive queries optimized |
| [09](./09-permissions.md) | Permissions | Role-based access control |

### Phase 4 — Advanced + Frontend (Modules 10–12)

Add collaboration features, background jobs, and wire up the frontend.

| Module | Topic | Key Outcome |
|--------|-------|-------------|
| [10](./10-advanced-features.md) | Advanced Features | Comments, tags, assignments |
| [11](./11-background-jobs.md) | Background Jobs | Entropy cron, notifications |
| [12](./12-tanstack-integration.md) | TanStack Integration | Frontend wired to Convex |

## Using the Fizzy Analysis Docs

The `docs/fizzy-analysis/` directory contains a complete reverse-engineering of Fizzy:

| Document | What It Covers | Used In Modules |
|----------|---------------|-----------------|
| [00-overview.md](../fizzy-analysis/00-overview.md) | Product overview, tech stack, architecture | All |
| [01-database-schema.md](../fizzy-analysis/01-database-schema.md) | 74 tables, every column, every index | 03, 05, 06 |
| [02-domain-models.md](../fizzy-analysis/02-domain-models.md) | 161 model files, associations, concerns, state machines | 07, 10, 11 |
| [03-authentication-and-sessions.md](../fizzy-analysis/03-authentication-and-sessions.md) | Passwordless auth, magic links, sessions | 04 |
| [04-permissions-and-access-control.md](../fizzy-analysis/04-permissions-and-access-control.md) | Roles, board access, public boards | 09 |
| [05-multi-tenancy.md](../fizzy-analysis/05-multi-tenancy.md) | URL path tenanting, data isolation, Current context | 05 |
| [06-features.md](../fizzy-analysis/06-features.md) | Complete feature inventory | 06, 07, 10 |
| [08-frontend-and-realtime.md](../fizzy-analysis/08-frontend-and-realtime.md) | Hotwired, Stimulus, Action Cable, Turbo | 08, 12 |

Each module references specific fizzy-analysis docs where relevant. You don't need to read them all upfront — the course introduces concepts progressively.

## Conventions

- All commands use `bun` 
- Code examples show the Convex way of doing things (not Express, not Prisma)
- Exercises build on each other — complete them in order
- When we say "query," we mean a Convex query function (reactive, read-only). When we say "mutation," we mean a Convex mutation function (transactional, read-write)

Let's start with [Module 01 — TypeScript Essentials](./01-typescript-essentials.md).

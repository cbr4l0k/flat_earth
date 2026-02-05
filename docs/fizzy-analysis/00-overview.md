# Fizzy - Product Overview

## What is Fizzy?

Fizzy is a collaborative project management and issue tracking application built by 37signals (the creators of Basecamp). It is a kanban-style tool for teams to create and manage cards (tasks/issues) across boards, organize work into columns representing workflow stages, and collaborate via comments, mentions, and assignments.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Ruby on Rails 8.2 (edge/main branch) |
| **Language** | Ruby 3.4.7 |
| **Primary Database** | MySQL 8 (via Trilogy adapter) or SQLite 3 |
| **Background Jobs** | Solid Queue (database-backed, no Redis) |
| **WebSocket/Realtime** | Solid Cable (database-backed Action Cable) |
| **Caching** | Solid Cache (database-backed) |
| **Frontend** | Hotwired (Turbo + Stimulus), no Node.js build step |
| **Asset Pipeline** | Propshaft + Importmap |
| **Rich Text** | Action Text (Trix editor) |
| **File Storage** | Active Storage (S3 or local disk) |
| **Image Processing** | libvips via image_processing gem |
| **Deployment** | Kamal 2 (Docker-based) |
| **Web Server** | Puma (behind Thruster reverse proxy) |
| **Search** | 16-shard MySQL full-text search (no Elasticsearch) |
| **Email** | Action Mailer with SMTP |
| **Push Notifications** | Web Push (VAPID) |

## Architectural Diagram

```
                          +------------------+
                          |   Browser/Client |
                          +--------+---------+
                                   |
                          HTTP / WebSocket
                                   |
                     +-------------+-------------+
                     |     Thruster (Proxy)       |
                     +-------------+-------------+
                                   |
                     +-------------+-------------+
                     |     Puma (App Server)      |
                     +-------------+-------------+
                                   |
              +--------------------+--------------------+
              |                    |                     |
    +---------+--------+  +--------+---------+  +--------+---------+
    | Turbo/Stimulus   |  | Action Cable     |  | Solid Queue      |
    | (HTTP responses) |  | (WebSocket)      |  | (Background Jobs)|
    +---------+--------+  +--------+---------+  +--------+---------+
              |                    |                     |
              +--------------------+--------------------+
                                   |
              +--------------------+--------------------+
              |                    |                     |
    +---------+--------+  +--------+---------+  +--------+---------+
    | MySQL (Primary)  |  | SQLite (Cable)   |  | SQLite (Queue)   |
    | 74 tables        |  | WebSocket state  |  | Job persistence  |
    +------------------+  +------------------+  +------------------+
              |
    +---------+--------+
    | 16 Search Shards |
    | (MySQL FULLTEXT)  |
    +------------------+
```

## Key Design Decisions

### 1. URL Path-Based Multi-Tenancy
Instead of subdomains or separate databases, Fizzy uses URL path prefixes (`/{account_id}/boards/...`) for tenant isolation. A Rack middleware extracts the account ID and moves it to `SCRIPT_NAME`, making Rails think the app is "mounted" at that prefix. All models include `account_id` for data isolation.

### 2. No External Dependencies for Infrastructure
Fizzy uses "Solid" gems (Solid Queue, Solid Cable, Solid Cache) that are all database-backed. This eliminates the need for Redis, Memcached, or any message broker. The entire application runs on just a database and an app server.

### 3. Passwordless Authentication
No passwords anywhere. Users authenticate via magic links (6-digit codes sent to email, valid for 15 minutes). API access uses bearer tokens with read/write scoping.

### 4. UUID Primary Keys (UUIDv7)
All tables use UUIDs as primary keys, encoded as base36 25-character strings. UUIDv7 provides chronological ordering, so `.first`/`.last` work correctly. Fixture UUIDs are generated deterministically to always sort before runtime records.

### 5. REST-Modeled Everything
Actions are modeled as CRUD operations on resources. Instead of `POST /cards/:id/close`, there's `POST /cards/:id/closure`. Instead of custom controller actions, new resource controllers are introduced (e.g., `Cards::ClosuresController`, `Cards::GoldnessesController`).

### 6. Server-Rendered SPA Feel
Using Turbo (Turbo Drive, Turbo Frames, Turbo Streams), the app delivers an SPA-like experience while being entirely server-rendered. No client-side routing or state management. Real-time updates are pushed via Action Cable + Turbo Streams.

### 7. Entropy (Auto-Postponement)
A unique feature where cards automatically move to "Not Now" after a configurable period of inactivity (default 30 days). This prevents boards from accumulating stale items. Configurable at both account and board level.

### 8. Sharded Full-Text Search
Instead of Elasticsearch, Fizzy uses 16 MySQL tables with FULLTEXT indexes. Shard selection is based on `CRC32(account_id) % 16`. This keeps the stack simple while providing adequate search performance.

## Core Concepts

- **Account**: The tenant/organization. Each account has a unique 7+ digit external ID used in URLs.
- **Identity**: A global user identified by email. Can belong to multiple Accounts.
- **User**: An Identity's membership in a specific Account. Has a role (owner/admin/member/system).
- **Board**: The primary organizational unit. Contains columns and cards. Can be "all access" or selective.
- **Column**: A workflow stage within a board. Has a name, color, and position.
- **Card**: The main work item. Has a title, rich text description, due date, assignments, steps, tags, and comments. Follows a lifecycle: drafted -> published -> triaged -> closed/not_now.
- **Event**: An audit log entry. Records all significant actions with JSON metadata.
- **Filter**: A saved search with multiple criteria (boards, tags, assignees, etc.).

## Repository Structure

```
app/
  controllers/       # ~50 controllers, concern-based mixins
  jobs/              # 16 job classes (notifications, webhooks, storage, etc.)
  javascript/
    controllers/     # 56 Stimulus controllers
  models/            # 161 model files across 16 subdirectories
  views/             # 345 templates (316 ERB, 28 JBuilder, 1 JS)
config/
  environments/      # dev/prod/test configurations
  initializers/      # tenanting, active_job, action_text, etc.
  deploy.yml         # Kamal deployment config
  recurring.yml      # Scheduled job definitions
db/
  schema.rb          # 74 tables (including 16 search shards)
```

---

## Convex Translation Notes

### Stack Mapping

| Fizzy (Rails) | Convex/TypeScript Equivalent |
|---------------|------------------------------|
| MySQL tables | Convex documents (tables) |
| ActiveRecord models | Convex schema + query/mutation functions |
| Solid Queue jobs | Convex scheduled functions / cron jobs |
| Action Cable + Solid Cable | Convex real-time subscriptions (built-in) |
| Turbo/Stimulus | React/Next.js with Convex hooks |
| Active Storage | Convex file storage |
| Action Text (Trix) | TipTap or Slate.js with Convex documents |
| ERB templates | React components |
| Importmap | npm/Vite bundler |
| Kamal deployment | Vercel (frontend) + Convex (backend) |

### Key Differences

1. **No ORM needed**: Convex uses a document model with built-in queries. Instead of ActiveRecord associations, you define relationships via ID references and query them with Convex's query functions.

2. **Real-time is free**: Convex provides real-time subscriptions out of the box. No need for a separate WebSocket layer. Every query automatically becomes a real-time subscription.

3. **No background job infrastructure**: Convex has built-in scheduled functions (`ctx.scheduler`) and cron jobs. No need for Solid Queue or any job queue system.

4. **No search sharding**: Convex has built-in full-text search indexes. Define a search index on your table and query it directly. No sharding strategy needed.

5. **Auth integration**: Instead of magic links, you'd typically integrate Clerk or Auth0 with Convex. Convex provides `ctx.auth` for identity management.

6. **Multi-tenancy via organization**: In Convex, multi-tenancy is typically achieved via an `organizationId` field on documents, similar to `account_id` in Fizzy. Convex's query filters handle isolation.

7. **Transactions built-in**: Every Convex mutation is automatically transactional. No need for explicit `transaction do` blocks.

8. **No migrations**: Convex schema is declarative. You define the schema and Convex handles the rest. No migration files to manage.

# Database Schema

Fizzy's database consists of 74 tables (including 16 search shard tables) in a MySQL 8 primary database, with separate SQLite databases for Action Cable (Solid Cable) and background jobs (Solid Queue).

All tables use **UUID primary keys** (UUIDv7 format, base36-encoded as 25-character strings). Every tenant-scoped table includes a non-nullable `account_id` column for multi-tenancy isolation.

## UUID Strategy

- Format: UUIDv7 encoded in base36 as 25-character strings
- Ordering: Chronologically sortable (`.first`/`.last` work correctly)
- Fixtures: Deterministic UUID generation ensures fixture records always sort before runtime records
- No auto-increment IDs anywhere in the schema

## Multi-Database Setup

| Database | Adapter | Purpose |
|----------|---------|---------|
| Primary | MySQL (Trilogy) or SQLite | Application data (74 tables) |
| Cable | SQLite | Solid Cable WebSocket state |
| Queue | SQLite | Solid Queue job persistence |
| Cache | SQLite | Solid Cache storage |

---

## Tables by Domain

### Core Domain

#### `accounts`
The tenant/organization table. Top-level entity for multi-tenancy.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `name` | string | NOT NULL | Organization name |
| `external_account_id` | bigint | UNIQUE | 7+ digit ID used in URLs |
| `cards_count` | bigint | NOT NULL, default: 0 | Counter cache |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `external_account_id` (unique)

#### `boards`
Primary organizational unit. Contains columns and cards.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `name` | string | NOT NULL | Board name |
| `all_access` | boolean | NOT NULL, default: false | If true, all users can access |
| `creator_id` | uuid | NOT NULL | FK to users |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `creator_id`

#### `columns`
Workflow stages within a board. Ordered by position.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `board_id` | uuid | NOT NULL | FK to boards |
| `name` | string | NOT NULL | Column name |
| `color` | string | NOT NULL | Hex color code |
| `position` | integer | NOT NULL, default: 0 | Sort order |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `board_id`, `(board_id, position)`

#### `cards`
The main work item (task/issue). Sequential numbering per account.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `board_id` | uuid | NOT NULL | FK to boards |
| `column_id` | uuid | nullable | FK to columns (null = triage) |
| `creator_id` | uuid | NOT NULL | FK to users |
| `title` | string | nullable | Card title |
| `number` | bigint | NOT NULL | Sequential per account |
| `status` | string | NOT NULL, default: "drafted" | "drafted" or "published" |
| `due_on` | date | nullable | Optional due date |
| `last_active_at` | datetime | NOT NULL | Drives entropy calculation |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `(account_id, number)` unique, `(account_id, last_active_at, status)`, `board_id`, `column_id`

#### `comments`
Rich text comments on cards.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `card_id` | uuid | NOT NULL | FK to cards |
| `creator_id` | uuid | NOT NULL | FK to users |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `card_id`

Note: Comment body is stored in `action_text_rich_texts` via Action Text.

#### `steps`
Checklist/subtask items within a card.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `card_id` | uuid | NOT NULL | FK to cards |
| `content` | text | NOT NULL | Step description |
| `completed` | boolean | NOT NULL, default: false | Completion status |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `card_id`, `(card_id, completed)`

---

### Card Lifecycle Tables

#### `closures`
Records when a card is closed (moved to "Done").

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `card_id` | uuid | NOT NULL, UNIQUE | FK to cards (one closure per card) |
| `user_id` | uuid | nullable | Who closed it (null = system) |
| `created_at` | datetime | NOT NULL | When it was closed |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `card_id` (unique), `(card_id, created_at)`, `user_id`

#### `card_not_nows`
Records when a card is postponed ("Not Now" status).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `card_id` | uuid | NOT NULL, UNIQUE | FK to cards |
| `user_id` | uuid | nullable | Who postponed (null = auto) |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `card_id` (unique), `user_id`

#### `card_goldnesses`
Marks a card as "golden" (highlighted/important).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `card_id` | uuid | NOT NULL, UNIQUE | FK to cards |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `card_id` (unique)

#### `card_activity_spikes`
Tracks significant activity bursts on a card.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `card_id` | uuid | NOT NULL, UNIQUE | FK to cards |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `card_id` (unique)

#### `card_engagements`
Tracks user engagement status with cards.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `card_id` | uuid | nullable | FK to cards |
| `status` | string | NOT NULL, default: "doing" | "doing" or "on_deck" |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `(account_id, status)`, `card_id`

---

### Collaboration

#### `assignments`
Links users to cards as assignees. Max 100 per card.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `card_id` | uuid | NOT NULL | FK to cards |
| `assignee_id` | uuid | NOT NULL | FK to users (who is assigned) |
| `assigner_id` | uuid | NOT NULL | FK to users (who assigned them) |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `(assignee_id, card_id)` unique, `card_id`

#### `watches`
Tracks which users are watching which cards for notifications.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `card_id` | uuid | NOT NULL | FK to cards |
| `user_id` | uuid | NOT NULL | FK to users |
| `watching` | boolean | NOT NULL, default: true | Active watch status |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `card_id`, `user_id`, `(user_id, card_id)`

#### `pins`
User-specific pinned cards for quick access.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `card_id` | uuid | NOT NULL | FK to cards |
| `user_id` | uuid | NOT NULL | FK to users |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `(card_id, user_id)` unique, `card_id`, `user_id`

#### `mentions`
Records @-mentions in rich text content.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `source_type` | string | NOT NULL | Polymorphic (Card or Comment) |
| `source_id` | uuid | NOT NULL | Polymorphic FK |
| `mentioner_id` | uuid | NOT NULL | FK to users (who mentioned) |
| `mentionee_id` | uuid | NOT NULL | FK to users (who was mentioned) |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `mentionee_id`, `mentioner_id`, `(source_type, source_id)`

#### `reactions`
Emoji reactions on comments.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `comment_id` | uuid | NOT NULL | FK to comments |
| `reacter_id` | uuid | NOT NULL | FK to users |
| `content` | string(16) | NOT NULL | Emoji character(s) |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `comment_id`, `reacter_id`

---

### Tags & Filtering

#### `tags`
Account-scoped labels for cards.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `title` | string | nullable | Tag name (normalized lowercase) |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `(account_id, title)` unique

#### `taggings`
Join table between cards and tags.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `card_id` | uuid | NOT NULL | FK to cards |
| `tag_id` | uuid | NOT NULL | FK to tags |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `(card_id, tag_id)` unique, `tag_id`

#### `filters`
Saved search/filter configurations.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `creator_id` | uuid | NOT NULL | FK to users |
| `params_digest` | string | NOT NULL | Deduplication hash |
| `fields` | json | NOT NULL, default: {} | Filter criteria |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `(creator_id, params_digest)` unique

#### Filter Join Tables (no primary key)

These are HABTM join tables for filter criteria:

| Table | Columns | Purpose |
|-------|---------|---------|
| `assignees_filters` | `assignee_id`, `filter_id` | Filter by assignee |
| `assigners_filters` | `assigner_id`, `filter_id` | Filter by assigner |
| `boards_filters` | `board_id`, `filter_id` | Filter by board |
| `closers_filters` | `closer_id`, `filter_id` | Filter by closer |
| `creators_filters` | `creator_id`, `filter_id` | Filter by creator |
| `filters_tags` | `filter_id`, `tag_id` | Filter by tag |

All have indexes on both columns.

---

### Events & Audit Log

#### `events`
Records all significant actions in the system (audit log).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `board_id` | uuid | NOT NULL | FK to boards |
| `creator_id` | uuid | NOT NULL | FK to users |
| `action` | string | NOT NULL | e.g., "card_published", "comment_created" |
| `eventable_type` | string | NOT NULL | Polymorphic (Card, Comment, etc.) |
| `eventable_id` | uuid | NOT NULL | Polymorphic FK |
| `particulars` | json | default: {} | Action-specific metadata |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `(account_id, action)`, `(board_id, action, created_at)`, `board_id`, `creator_id`, `(eventable_type, eventable_id)`

---

### Notifications

#### `notifications`
In-app notifications for users.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `user_id` | uuid | NOT NULL | FK to users (recipient) |
| `creator_id` | uuid | nullable | FK to users (who caused it) |
| `source_type` | string | NOT NULL | Polymorphic (Event, Mention) |
| `source_id` | uuid | NOT NULL | Polymorphic FK |
| `read_at` | datetime | nullable | Null = unread |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `creator_id`, `(source_type, source_id)`, `(user_id, read_at, created_at)` desc, `user_id`

#### `notification_bundles`
Aggregation windows for batching email notifications (30-minute cycles).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `user_id` | uuid | NOT NULL | FK to users |
| `starts_at` | datetime | NOT NULL | Window start |
| `ends_at` | datetime | NOT NULL | Window end |
| `status` | integer | NOT NULL, default: 0 | 0=pending, 1=processing, 2=delivered |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `(ends_at, status)`, `(user_id, starts_at, ends_at)`, `(user_id, status)`

#### `push_subscriptions`
Web push notification subscriptions (VAPID).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `user_id` | uuid | NOT NULL | FK to users |
| `endpoint` | text | | Push service endpoint |
| `p256dh_key` | string | | Encryption key |
| `auth_key` | string | | Auth secret |
| `user_agent` | string(4096) | | Client identifier |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `(user_id, endpoint)` unique (endpoint limited to 255 chars)

---

### Authentication & Identity

#### `identities`
Global user identity (email-based). Not tenant-scoped.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `email_address` | string | NOT NULL, UNIQUE | Normalized email |
| `staff` | boolean | NOT NULL, default: false | Internal staff flag |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `email_address` (unique)

#### `users`
Account membership. Links an Identity to an Account with a role.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `identity_id` | uuid | nullable | FK to identities |
| `name` | string | NOT NULL | Display name |
| `role` | string | NOT NULL, default: "member" | owner/admin/member/system |
| `active` | boolean | NOT NULL, default: true | Soft delete flag |
| `verified_at` | datetime | nullable | Email verification timestamp |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `(account_id, identity_id)` unique, `(account_id, role)`, `identity_id`

#### `sessions`
Active browser sessions. Not tenant-scoped (global to identity).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `identity_id` | uuid | NOT NULL | FK to identities |
| `ip_address` | string | nullable | Client IP |
| `user_agent` | string(4096) | nullable | Browser user agent |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `identity_id`

#### `magic_links`
Passwordless authentication tokens (6-digit codes, 15-minute expiry).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `identity_id` | uuid | nullable | FK to identities |
| `code` | string | NOT NULL, UNIQUE | 6-digit auth code |
| `purpose` | integer | NOT NULL | 0=sign_in, 1=sign_up |
| `expires_at` | datetime | NOT NULL | 15 minutes from creation |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `code` (unique), `expires_at`, `identity_id`

#### `identity_access_tokens`
API bearer tokens for programmatic access.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `identity_id` | uuid | NOT NULL | FK to identities |
| `token` | string | | Secure random token |
| `permission` | string | | "read" or "write" |
| `description` | text | | User-provided label |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `identity_id`

---

### Access Control

#### `accesses`
Board-level access records. Determines which users can access which boards.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `board_id` | uuid | NOT NULL | FK to boards |
| `user_id` | uuid | NOT NULL | FK to users |
| `involvement` | string | NOT NULL, default: "access_only" | "access_only" or "watching" |
| `accessed_at` | datetime | nullable | Last board access time |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `(account_id, accessed_at)`, `(board_id, user_id)` unique, `board_id`, `user_id`

#### `account_join_codes`
Invitation codes for joining an account.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `code` | string | NOT NULL | Join code string |
| `usage_count` | bigint | NOT NULL, default: 0 | Times used |
| `usage_limit` | bigint | NOT NULL, default: 10 | Max uses |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `(account_id, code)` unique

#### `account_external_id_sequences`
Monotonic sequence generator for account external IDs.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `value` | bigint | NOT NULL, default: 0, UNIQUE | Current sequence value |

---

### Board Publishing

#### `board_publications`
Makes a board publicly accessible via a shareable key.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `board_id` | uuid | NOT NULL | FK to boards |
| `key` | string | nullable | Secure random shareable key |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `(account_id, key)`, `board_id`

---

### Entropy (Auto-Postponement)

#### `entropies`
Configurable auto-postponement periods. Polymorphic (belongs to Account or Board).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `container_type` | string | NOT NULL | "Account" or "Board" |
| `container_id` | uuid | NOT NULL | Polymorphic FK |
| `auto_postpone_period` | bigint | NOT NULL, default: 2592000 | Seconds (default 30 days) |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `(container_type, container_id)` unique, `(container_type, container_id, auto_postpone_period)`

---

### Webhooks

#### `webhooks`
Outgoing webhook configurations per board.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `board_id` | uuid | NOT NULL | FK to boards |
| `name` | string | nullable | Webhook name |
| `url` | text | NOT NULL | Endpoint URL |
| `signing_secret` | string | NOT NULL | HMAC signing key |
| `subscribed_actions` | text | nullable | JSON array of action types |
| `active` | boolean | NOT NULL, default: true | Enabled flag |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `(board_id, subscribed_actions)` (subscribed_actions limited to 255 chars)

#### `webhook_deliveries`
Log of webhook delivery attempts.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `webhook_id` | uuid | NOT NULL | FK to webhooks |
| `event_id` | uuid | NOT NULL | FK to events |
| `state` | string | NOT NULL | pending/in_progress/completed/errored |
| `request` | text | nullable | JSON request details |
| `response` | text | nullable | JSON response details |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `event_id`, `webhook_id`

#### `webhook_delinquency_trackers`
Tracks consecutive webhook failures for auto-deactivation.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `webhook_id` | uuid | NOT NULL | FK to webhooks |
| `consecutive_failures_count` | integer | default: 0 | Failure counter |
| `first_failure_at` | datetime | nullable | When failures started |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `webhook_id`

---

### Search (16-Shard Architecture)

#### `search_records_0` through `search_records_15`
16 identical tables for sharded full-text search. Shard determined by `CRC32(account_id) % 16`.

Each shard table has identical structure:

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `account_key` | string | NOT NULL, default: "" | "account{id}" prefix for search |
| `board_id` | uuid | NOT NULL | FK to boards |
| `card_id` | uuid | NOT NULL | FK to cards |
| `searchable_type` | string | NOT NULL | "Card" or "Comment" |
| `searchable_id` | uuid | NOT NULL | FK to source record |
| `title` | string | nullable | Stemmed title text |
| `content` | text | nullable | Stemmed content text |
| `created_at` | datetime | NOT NULL | |

**Indexes per shard:**
- `account_id`
- `(account_key, content, title)` FULLTEXT
- `(searchable_type, searchable_id)` unique

#### `search_queries`
User search history for autocomplete/recent searches.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `user_id` | uuid | NOT NULL | FK to users |
| `terms` | string(2000) | NOT NULL | Search query text |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `(user_id, terms)` (terms limited to 255), `(user_id, updated_at)` unique, `user_id`

---

### Storage Tracking

#### `storage_entries`
Log of storage operations (uploads/deletes) for usage tracking.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `board_id` | uuid | nullable | FK to boards |
| `user_id` | uuid | nullable | FK to users |
| `blob_id` | uuid | nullable | FK to active_storage_blobs |
| `recordable_type` | string | nullable | Polymorphic |
| `recordable_id` | uuid | nullable | Polymorphic FK |
| `operation` | string | NOT NULL | Operation type |
| `delta` | bigint | NOT NULL | Bytes added/removed |
| `request_id` | string | nullable | HTTP request ID |
| `created_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `blob_id`, `board_id`, `(recordable_type, recordable_id)`, `request_id`, `user_id`

#### `storage_totals`
Materialized storage usage totals per owner (Account or Board).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `owner_type` | string | NOT NULL | "Account" or "Board" |
| `owner_id` | uuid | NOT NULL | Polymorphic FK |
| `bytes_stored` | bigint | NOT NULL, default: 0 | Current total bytes |
| `last_entry_id` | uuid | nullable | Last processed entry |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `(owner_type, owner_id)` unique

---

### User Settings

#### `user_settings`
Per-user configuration within an account.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `user_id` | uuid | NOT NULL | FK to users |
| `bundle_email_frequency` | integer | NOT NULL, default: 0 | Email notification frequency |
| `timezone_name` | string | nullable | User timezone |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `(user_id, bundle_email_frequency)`, `user_id`

---

### Account Exports

#### `account_exports`
Tracks account data export requests.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `user_id` | uuid | NOT NULL | FK to users (who requested) |
| `status` | string | NOT NULL, default: "pending" | pending/completed |
| `completed_at` | datetime | nullable | When export finished |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `user_id`

---

### Rails Framework Tables

#### `action_text_rich_texts`
Action Text rich text content storage.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `name` | string | NOT NULL | Association name (e.g., "body", "description") |
| `record_type` | string | NOT NULL | Polymorphic owner type |
| `record_id` | uuid | NOT NULL | Polymorphic owner FK |
| `body` | longtext | nullable | HTML content |
| `created_at` | datetime | NOT NULL | |
| `updated_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `(record_type, record_id, name)` unique

#### `active_storage_blobs`
File metadata for uploaded files.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `key` | string | NOT NULL, UNIQUE | Storage key |
| `filename` | string | NOT NULL | Original filename |
| `content_type` | string | nullable | MIME type |
| `byte_size` | bigint | NOT NULL | File size |
| `checksum` | string | nullable | MD5 checksum |
| `metadata` | text | nullable | JSON metadata |
| `service_name` | string | NOT NULL | Storage service |
| `created_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `key` (unique)

#### `active_storage_attachments`
Links blobs to model records.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `name` | string | NOT NULL | Association name |
| `record_type` | string | NOT NULL | Polymorphic owner type |
| `record_id` | uuid | NOT NULL | Polymorphic owner FK |
| `blob_id` | uuid | NOT NULL | FK to blobs |
| `created_at` | datetime | NOT NULL | |

**Indexes:** `account_id`, `blob_id`, `(record_type, record_id, name, blob_id)` unique

#### `active_storage_variant_records`
Processed image variant tracking.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK | |
| `account_id` | uuid | NOT NULL | Tenant scope |
| `blob_id` | uuid | NOT NULL | FK to blobs |
| `variation_digest` | string | NOT NULL | Variant configuration hash |

**Indexes:** `account_id`, `(blob_id, variation_digest)` unique

---

## Convex Translation Notes

### Document Model Mapping

In Convex, each table maps to a document collection. Key differences:

1. **No join tables needed**: Convex handles many-to-many relationships via arrays of IDs stored in documents. The 6 filter join tables (`assignees_filters`, etc.) would become array fields on the `filters` document.

2. **No separate search tables**: Convex has built-in search indexes. Instead of 16 `search_records_*` tables, define a search index on `cards` and `comments` tables directly:
   ```typescript
   defineTable({...}).searchIndex("search_title_content", {
     searchField: "title",
     filterFields: ["accountId", "boardId"]
   })
   ```

3. **Polymorphic associations become union types**: Instead of `source_type`/`source_id` polymorphic columns, use a discriminated union or separate fields:
   ```typescript
   sourceType: v.union(v.literal("event"), v.literal("mention")),
   sourceId: v.id("events") // or v.id("mentions")
   ```

4. **No `account_id` on every table**: In Convex, you'd still need `accountId` (or `organizationId`) on every document for tenant isolation, and use `.filter()` or index-based queries to scope reads.

5. **Rich text storage**: Instead of a separate `action_text_rich_texts` table, store rich text content directly in the document (e.g., `card.description` as a JSON structure compatible with your editor).

6. **File storage**: Use Convex's built-in file storage API instead of Active Storage. Store `storageId` references in documents instead of separate attachment/blob tables.

7. **Counter caches**: Convex doesn't have built-in counter caches. Either compute counts on-read via aggregation, or maintain a separate count document updated via mutations.

8. **Unique constraints**: Convex doesn't enforce unique constraints at the database level. Enforce uniqueness in your mutation functions using index lookups before insert.

# Features

Comprehensive inventory of every feature in Fizzy, organized by domain.

---

## 1. Boards

### CRUD Operations
- **Create**: Any authenticated user can create a board. Creator gets "watching" involvement.
- **Read**: Users see only boards they have Access records for.
- **Update**: Name, access mode. Admins or board creator only.
- **Delete**: Admins or board creator only. Cascades to all cards, columns, webhooks.

### Columns
- Each board has ordered columns representing workflow stages
- Columns have: `name`, `color` (hex), `position` (integer)
- Position management: move left/right via dedicated controllers (`Columns::LeftPositionController`, `Columns::RightPositionController`)
- When a column is renamed or recolored, all its cards are touched (triggering Turbo refreshes)
- When a column is deleted, its cards become unassigned (column_id set to null, back to triage)

### Colors
- Columns have configurable colors
- A default color is applied when none specified
- Cards inherit their column's color for display

### Access Modes
- **All Access** (`all_access: true`): Every active user auto-gets Access
- **Selective** (`all_access: false`): Explicit grant/revoke per user
- Access management UI shows selected/unselected users for toggling

### Board Publishing
- Boards can be published with a shareable key (`has_secure_token :key`)
- Published boards are viewable without authentication at `/public/boards/{key}`
- Public view shows: columns, cards (title, column, status), card details, comments
- Public view is read-only (no write operations)
- Boards can have a rich text `public_description`
- Unpublishing destroys the key (old links stop working)

### Board Subscriptions (Watching)
- Users can subscribe/unsubscribe from board-level notifications
- Subscribers (`involvement: "watching"`) get notified of all board activity
- Board creator is auto-subscribed on creation

### Entropy Configuration
- Per-board entropy override via `Entropy` record (polymorphic)
- UI control (knob) to adjust auto-postpone period
- Falls back to account-level default if no board-level config

---

## 2. Cards

### Card Lifecycle

```
           +----------+
           | drafted  |  (card created but not yet submitted)
           +----+-----+
                | publish
                v
           +----------+
           | active   |  (published, open, not postponed)
           | awaiting |  (if no column assigned = "Maybe?" / triage)
           | triage   |
           +----+-----+
                | triage_into(column)
                v
           +----------+
           | triaged  |  (active, assigned to a column)
           +----+-----+
                |
       +--------+--------+
       |                  |
       v                  v
  +----+-----+     +------+---+
  | not_now   |     | closed   |
  | (postponed|     | (done)   |
  +-----------+     +----------+
       |                  |
       | resume           | reopen
       +--------+---------+
                |
                v
           +----------+
           | active   |
           +----------+
```

### Card Creation
- Cards start as "drafted" (not visible to others)
- `publish` transitions to "published" and tracks a `card_published` event
- Sequential numbering per account (`number` field, auto-incremented)
- Cards are identified in URLs by number (not UUID): `/cards/42`

### Card Properties
| Property | Type | Details |
|----------|------|---------|
| Title | string | Optional until published, default set on save |
| Description | rich text | Action Text (Trix editor), supports images, embeds |
| Image | attachment | Single image per card (Active Storage) |
| Due date | date | Optional `due_on` field |
| Number | integer | Sequential per account, unique, used in URLs |
| Status | enum | "drafted" or "published" |
| Board | FK | Can be moved between boards |
| Column | FK (optional) | Null = awaiting triage ("Maybe?") |
| Last active at | datetime | Drives entropy calculation, updated on events |

### Closing Cards
- `close(user:)` - Creates `Closure` record, tracks `card_closed` event
- `reopen(user:)` - Destroys `Closure`, tracks `card_reopened` event
- Scopes: `closed`, `open`, `recently_closed_first`, `closed_at_window(window)`, `closed_by(users)`
- Closed cards appear in a dedicated "Done" column view

### Postponing Cards ("Not Now")
- `postpone(user:)` - Creates `Card::NotNow` record, sends back to triage, reopens if closed
- `auto_postpone(user:)` - Same as postpone but with "auto_postponed" event action
- `resume` - Destroys `NotNow`, reopens, clears activity spike
- Postponed cards appear in a dedicated "Not Now" column view
- Scopes: `postponed`, `active`

### Triaging Cards
- New published cards start in "Maybe?" (triage) - no column assigned
- `triage_into(column)` - Assigns card to a column, resumes if postponed, tracks event
- `send_back_to_triage` - Removes column assignment, tracks event
- Scopes: `awaiting_triage`, `triaged`

### Moving Cards Between Boards
- `move_to(new_board)` - Changes board, tracks `card_board_changed` event
- Grants access to assignees on the new board
- Cards appear in triage on the new board (column cleared unless matching column exists)

### Drag and Drop
- Cards can be dropped between:
  - **Columns** - Triages card into the target column
  - **Not Now** - Postpones the card
  - **Stream/Triage** - Sends back to triage
  - **Done/Closure** - Closes the card
- Implemented via `Columns::Cards::Drops::*` controllers

### Assignments (Max 100)
- Cards can have up to 100 assignees (`Assignment::LIMIT = 100`)
- `toggle_assignment(user)` - Assign/unassign toggle
- Assigning auto-watches the card for the assignee
- Events tracked: `card_assigned`, `card_unassigned`
- Scopes: `unassigned`, `assigned_to(users)`, `assigned_by(users)`
- Each assignment records both `assignee` and `assigner`

### Steps/Checklists
- Cards have multiple `Step` records (subtasks)
- Each step has: `content` (text, required), `completed` (boolean)
- Steps are ordered by creation
- Scope: `completed`
- Card is touched when steps change

### Due Dates
- Optional `due_on` date field
- No automatic actions on due date (purely informational)

### Card Image
- Single image attachment per card via Active Storage
- Managed via `Cards::ImagesController`
- Image variants: small (800x600), large (1024x768) via libvips

### Rich Text Description
- Full rich text editing via Action Text (Trix editor)
- Supports:
  - Text formatting (bold, italic, headings, lists)
  - File attachments (embedded in rich text)
  - Remote images (URL-based)
  - @mentions (user attachments in rich text)

### Golden Status
- Cards can be marked as "golden" (highlighted/important)
- `gild` / `ungild` toggle
- Golden cards sort first in listings (`with_golden_first` scope)
- Stored as `Card::Goldness` record (one per card)

### Activity Spikes
- System detects bursts of activity on a card
- `Card::ActivitySpike::Detector` runs after card updates (via background job)
- `stalled?` - True if activity spike is older than 14 days with no updates
- Scope: `stalled` - Open, active cards with old activity spikes

### Card Pinning
- Users can pin cards for quick access
- Pins are per-user (not global)
- Pinned cards appear in the user's personal pin tray (`/my/pins`)
- Pin broadcasts update the tray in real-time when pinned cards change

### Card Watching
- Users can watch/unwatch cards for notifications
- Creator auto-watches on creation
- Assignees auto-watch when assigned
- Mentionees auto-watch when mentioned
- Commenters auto-watch when they comment
- `watchers` returns active users with `watching: true`

### Card Export
- Individual card export to JSON format
- Includes: number, title, board, status, creator, description, comments, attachments
- Attachments collected from both card and comment rich text

### Card Reading (Notification Management)
- `read_by(user)` - Marks unread notifications as read for that user
- `unread_by(user)` - Marks all notifications as unread
- `remove_inaccessible_notifications` - Cleanup when access changes

---

## 3. Comments

### Rich Text Comments
- Full rich text via Action Text (Trix editor)
- Supports file attachments (uploaded and embedded)
- Supports remote images (URL-based)
- Supports @mentions (user attachables)

### System Comments
- Certain events generate system comments on cards (`Card::Eventable::SystemCommenter`)
- System comments appear differently in the UI (by_system scope)

### Comment Ordering
- Comments displayed chronologically (oldest first)
- Scope: `chronologically`, `preloaded`

### Auto-Watch on Comment
- Creating a comment automatically watches the card for the commenter

### Emoji Reactions
- Users can add emoji reactions to comments
- `Reaction` model: `belongs_to :comment`, `belongs_to :reacter`
- Emoji stored as string (max 16 chars)
- Reactions ordered by creation time
- Adding a reaction registers card activity (for entropy/staleness tracking)

### @Mentions in Comments
- Users can @mention other users in comment body
- Implemented via Action Text attachments (user attachables)
- `Comment::Mentions` concern scans rich text for mention attachments
- Creates `Mention` records asynchronously via `Mention::CreateJob`
- Mentionees receive notifications
- Mentionees auto-watch the card

---

## 4. Tags

### Account-Scoped Labels
- Tags belong to an account (not a board)
- Same tag can be applied across multiple boards
- Title normalized to lowercase, cannot start with `#`
- Created on-demand when tagging a card

### Tagging Cards
- `toggle_tag_with(title)` - Find or create tag, toggle on/off
- Scope: `tagged_with(tags)` - Cards with specific tags
- Tag changes touch the card (Turbo refresh)

### Tag Display
- `hashtag` method returns `#title` for display
- Tags shown as `#bug`, `#feature`, etc.

### Unused Tag Cleanup
- Recurring job (`DeleteUnusedTagsJob`) runs daily at 04:02
- Removes tags with no taggings (orphan cleanup)
- Scope: `unused` - Tags with zero taggings

### Filtering by Tag
- Tags participate in the Filter system
- `has_and_belongs_to_many :filters` (via `filters_tags` join table)

---

## 5. Filters (Saved Search)

### Multi-Criteria Filtering
Filters can combine:
| Criterion | Join Table | Description |
|-----------|------------|-------------|
| Boards | `boards_filters` | Filter to specific boards |
| Tags | `filters_tags` | Filter by tag labels |
| Assignees | `assignees_filters` | Filter by assigned users |
| Assigners | `assigners_filters` | Filter by who assigned |
| Closers | `closers_filters` | Filter by who closed |
| Creators | `creators_filters` | Filter by card creator |

Additional filter fields (stored in JSON `fields` column):
- Text search terms
- Status filters (open, closed, not_now)
- Workflow state

### Filter Persistence
- Filters are deduplicated via `params_digest` (hash of filter criteria)
- `Filter.from_params(params)` - Build from URL parameters
- `Filter.remember(attrs)` - Persist for reuse
- Per-user, per-account

### Filter UI
- Filter settings panel with toggles for each criterion
- `FilterScoped` controller concern handles filter setup
- `User::Filtering` model wraps filter logic for display
- Expandable/collapsible view modes

### Filter Cards Query
- `filter.cards` - Returns scoped card query matching all criteria
- Supports combining multiple boards, tags, users
- Can include/exclude closed and not_now cards

---

## 6. Search

### 16-Shard Full-Text Search
- MySQL FULLTEXT indexes across 16 shard tables
- Shard selection: `CRC32(account_id) % 16`
- Both cards and comments are indexed

### Search Indexing
- Content stemmed via `Search::Stemmer` before storage
- Account key prefix (`"account{id}"`) for query isolation within shards
- Lifecycle hooks: create/update/destroy sync search records

### Search Records
Each search record contains:
| Field | Source |
|-------|--------|
| `title` | Card title (stemmed) |
| `content` | Card description plain text or comment body plain text (stemmed) |
| `card_id` | FK to parent card |
| `board_id` | FK to board (for access filtering) |
| `searchable_type` | "Card" or "Comment" |

### Search Query Processing
- `Search::Query` wraps and validates user input
- `Search::Stemmer` stems query terms for matching
- MySQL BOOLEAN MODE matching with account key prefix
- Results filtered by user's accessible board IDs

### Search Results
- `Search::Highlighter` highlights matching terms in results
- Shows card title, description snippet, and comment body snippet
- Results include source card with board and creator

### Search History
- `Search::Query` model tracks user search history
- Recent queries shown in search UI for quick re-execution
- Per-user, per-account

---

## 7. Notifications

### In-App Notifications
- `Notification` records created for relevant users when events occur
- Sources: Events (card actions) and Mentions (@-mentions)
- Read/unread state via `read_at` timestamp

### Notification Routing (Notifier)
Factory pattern determines recipients:

| Source | Notifier | Recipients |
|--------|----------|------------|
| Event (card_assigned) | CardEventNotifier | Assignees (excluding creator) |
| Event (card_published) | CardEventNotifier | Board watchers + assignees (excluding creator, mentionees) |
| Event (comment_created) | CommentEventNotifier | Card watchers (excluding creator, mentionees) |
| Event (other card action) | CardEventNotifier | Board watchers (excluding creator) |
| Mention | MentionNotifier | The mentionee (unless self-mention) |

### Notification Tray
- Real-time notification tray in the UI header
- Broadcasts unread count updates via Action Cable
- `notifications/trays#show` - Renders tray content
- Stimulus controller: `notifications_tray_controller.js`

### Read/Unread Management
- `notification.read` - Sets `read_at` to now
- `notification.unread` - Clears `read_at`
- `Notification.read_all` - Marks all as read (class method)
- `card.read_by(user)` - Marks all notifications for that card as read
- Bulk reading via `Notifications::BulkReadingsController`

### Email Bundling (30-Minute Cycles)
- `Notification::Bundle` aggregates notifications into time windows
- Default window: 30 minutes (configurable via user settings)
- Recurring job (`Notification::Bundle::DeliverAllJob`) runs every 30 minutes
- Bundle states: `pending` → `processing` → `delivered`
- Only delivers if user has email bundling enabled AND has unread notifications
- Validates no overlapping windows

### Web Push Notifications
- VAPID-based web push via `web-push` gem
- `Push::Subscription` model stores endpoint, p256dh_key, auth_key
- `PushNotificationJob` sends push notification after notification creation
- `NotificationPusher` handles the delivery

### Notification Settings
- Per-user notification preferences
- Email bundling frequency configuration
- Unsubscribe mechanism

---

## 8. Webhooks

### Configuration
- Webhooks are per-board
- Properties: name, URL, signing_secret, subscribed_actions, active flag
- `has_secure_token :signing_secret` for HMAC signing

### Subscribed Actions
Available webhook triggers:
- `card_assigned`, `card_unassigned`
- `card_closed`, `card_reopened`
- `card_postponed`, `card_auto_postponed`, `card_resumed`
- `card_published`, `card_title_changed`
- `card_triaged`, `card_sent_back_to_triage`
- `card_board_changed`
- `comment_created`

### Delivery Process
1. Event created → `after_create_commit :dispatch_webhooks`
2. `Event::WebhookDispatchJob` finds active webhooks triggered by this event
3. Creates `Webhook::Delivery` record for each matching webhook
4. `Webhook::DeliveryJob` performs HTTP POST

### Payload Format
Adapts based on webhook URL:

| Target | Content-Type | Format |
|--------|-------------|--------|
| Default | `application/json` | JBuilder JSON |
| Slack (`hooks.slack.com`) | `application/json` | `{text: mrkdwn}` |
| Campfire | `text/html` | HTML |
| Basecamp Campfire | `application/x-www-form-urlencoded` | Form data |

### Security
- Signed payloads: `X-Webhook-Signature` header contains HMAC-SHA256 of payload
- `X-Webhook-Timestamp` header for replay protection
- SSRF protection: `SsrfProtection.resolve_public_ip` validates target IP is public
- Timeout: 7 seconds per delivery
- Max response: 100KB

### Delinquency Tracking
- `Webhook::DelinquencyTracker` monitors consecutive failures
- Thresholds: 10 consecutive failures within 1 hour
- Auto-deactivates webhook when delinquent
- Resets on successful delivery

### Delivery Cleanup
- Stale deliveries (> 7 days) cleaned up by recurring job (`cleanup_webhook_deliveries`)

---

## 9. Entropy (Auto-Postponement)

### Concept
Cards automatically move to "Not Now" after a configurable period of inactivity. This prevents boards from accumulating stale items that no one is actively working on.

### Configuration Hierarchy
1. **Board-level**: `Entropy` record with `container_type: "Board"`
2. **Account-level** (fallback): `Entropy` record with `container_type: "Account"`
3. **Default**: 30 days (2,592,000 seconds)

### How It Works
- Card has `last_active_at` timestamp, updated whenever an event is created
- Recurring job (`Card.auto_postpone_all_due`) runs every hour
- Finds cards where `last_active_at + auto_postpone_period < now`
- Uses COALESCE to prefer board-level config, falling back to account-level
- Auto-postponed cards get `card_auto_postponed` event (distinct from manual postpone)
- System user performs the auto-postpone action

### Postponing Soon
- Cards approaching their entropy deadline (within 75% of period elapsed)
- Scope: `postponing_soon`
- Shown in UI as a warning (cards about to be auto-postponed)

### UI Controls
- Entropy "knob" control in board settings and account settings
- Adjustable period per board or account-wide
- When entropy config changes, all cards are touched (recalculates timers)

---

## 10. Events (Audit Log)

### Event Tracking
Every significant action creates an Event record:

| Action | Trigger |
|--------|---------|
| `card_published` | Card transitions from drafted to published |
| `card_closed` | Card closed (moved to Done) |
| `card_reopened` | Closed card reopened |
| `card_postponed` | Card manually postponed |
| `card_auto_postponed` | Card auto-postponed by entropy system |
| `card_resumed` | Postponed card resumed |
| `card_title_changed` | Card title edited (stores old/new title) |
| `card_board_changed` | Card moved to different board (stores new board name) |
| `card_triaged` | Card assigned to column (stores column name) |
| `card_sent_back_to_triage` | Card removed from column |
| `card_assigned` | User assigned to card (stores assignee_ids) |
| `card_unassigned` | User unassigned from card (stores assignee_ids) |
| `comment_created` | New comment on card |

### Event Particulars (JSON Metadata)
- `assignee_ids` - Array of user IDs (for assignment events)
- `column` - Column name (for triage events)
- `old_title` / `new_title` - For title change events
- `new_board` - For board change events

### Event Descriptions
`Event::Description` generates human-readable text:
- Context-aware: "You commented on Card Title" vs "Alice commented on Card Title"
- HTML and plain text variants

### Activity Timeline
- Events displayed in chronological order
- Grouped by day (`Events::DaysController`)
- Day timeline with column view (`Events::DayTimeline::ColumnsController`)
- Filterable by action type
- Paginated (geared pagination)

### System Comments
Certain events create automatic system comments on cards to maintain a visible history in the card's comment thread.

---

## 11. Exports

### Account Data Export
- Admin users can request a full account data export
- `Account::Export` model tracks export status: `pending` → `completed`
- Background job (`ExportAccountDataJob`) generates the export
- Each card exported as JSON with all metadata, comments, and attachments
- Attachments packaged into a ZIP file
- Export download link emailed to requester when complete

---

## 12. Storage Tracking

### Usage Monitoring
- `Storage::Entry` records every file upload/delete operation
- Tracks: account, board, user, blob, operation, delta (bytes), request_id
- `Storage::Total` materializes cumulative usage per account and per board
- `Storage::MaterializeJob` computes totals from entries
- `Storage::ReconcileJob` ensures consistency (retries on snapshot failures)

---

## 13. QR Codes

- QR code generation for shareable links
- `QrCodesController` generates QR code images
- Uses `rqrcode` gem

---

## 14. User Management

### User Profiles
- Name, role, active status, verification
- Avatar (via Active Storage on Identity)
- Email address change flow with confirmation
- Timezone preference

### User Deactivation
- Soft delete: `user.deactivate` sets `active: false`
- Deactivated users can't log in but their data is preserved
- Closures become `user_id: null` (nullified)

### User Verification
- `verified_at` timestamp
- `verify` method sets the timestamp
- `verified?` / `setup?` checks

---

## 15. Personal Area (/my)

### Identity
- View global identity info (email, accounts)

### Access Tokens
- CRUD for API bearer tokens
- Read or write permission
- Description for identification

### Pins Tray
- Quick access to pinned cards across all boards
- Real-time updates when pinned cards change

### Timezone
- Set personal timezone
- Affects notification bundling windows
- Cookie-based detection

### Menu
- Account switcher (for multi-account users)
- Board list, custom views, tags, people, shortcuts

---

## 16. Prompts (Autocomplete)

### Command Palette / Autocomplete
- `Prompts::CardsController` - Card search autocomplete
- `Prompts::TagsController` - Tag autocomplete
- `Prompts::UsersController` - User mention autocomplete
- `Prompts::BoardsController` - Board selection
- `Prompts::Boards::UsersController` - Board-specific user list
- Used by Stimulus controllers for combobox/autocomplete UI

---

## Convex Translation Notes

### Feature Mapping Summary

| Fizzy Feature | Convex Approach |
|---------------|----------------|
| Rich text (Action Text) | TipTap/Slate.js editor with JSON storage in Convex documents |
| File uploads (Active Storage) | Convex file storage API (`ctx.storage.store()`) |
| Real-time updates (Turbo Streams) | Convex real-time subscriptions (automatic) |
| Background jobs (Solid Queue) | Convex scheduled functions (`ctx.scheduler`) |
| Search (16-shard MySQL) | Convex search indexes (built-in, no sharding needed) |
| Email notifications | Convex actions calling email API (SendGrid, Resend, etc.) |
| Web push | Convex actions calling web-push library |
| Webhooks | Convex HTTP actions for outbound webhooks |
| Entropy (auto-postpone) | Convex cron job querying by lastActiveAt |
| Drag and drop | Client-side DnD library (dnd-kit) calling Convex mutations |
| Autocomplete | Convex queries with prefix matching or search indexes |

### Key Feature Implementation Notes

1. **Card lifecycle**: Model as a state machine in mutations. Each transition (publish, close, reopen, postpone, resume, triage) is a separate mutation that validates the transition and creates an event document.

2. **Assignments with limit**: Enforce the 100-assignee limit in the mutation by counting existing assignments before insert.

3. **Entropy system**: Create a Convex cron job that runs hourly:
   ```typescript
   // convex/crons.ts
   export default cronJobs();
   crons.interval("auto-postpone", { hours: 1 }, api.entropy.autoPostponeAll);
   ```

4. **Notification bundling**: Use Convex scheduled functions with delays instead of time-windowed bundles:
   ```typescript
   // When notification created, schedule delivery for 30 min later
   await ctx.scheduler.runAfter(30 * 60 * 1000, api.notifications.deliverBundle, {
     userId, organizationId
   });
   ```

5. **Webhook delivery**: Implement as Convex HTTP actions with retry logic. Store delivery logs in a `webhookDeliveries` table.

6. **Search**: Define search indexes directly on the schema:
   ```typescript
   cards: defineTable({...})
     .searchIndex("search_cards", {
       searchField: "searchableText",
       filterFields: ["accountId", "boardId"]
     })
   ```

7. **Golden cards sort-first**: In Convex, you'd handle this in the query by fetching golden and non-golden cards separately and concatenating, or by using a composite sort field.

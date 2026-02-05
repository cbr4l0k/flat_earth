# Domain Models

Fizzy has 161 model files across 16 subdirectories. This document covers every model, its associations, concerns, validations, scopes, callbacks, and lifecycle states.

## Entity-Relationship Diagram (Text-Based)

```
Identity (global, email-based)
  |-- has_many Sessions
  |-- has_many Users (across Accounts)
  |-- has_many AccessTokens
  |-- has_many MagicLinks
  |
  +-- User (per-account membership)
        |-- belongs_to Account
        |-- belongs_to Identity
        |-- has_many Comments (as creator)
        |-- has_many Filters (as creator)
        |-- has_many Closures
        |-- has_many Pins --> Cards
        |-- has_many Exports
        |-- has_many Watches
        |-- has_many Assignments (as assignee)
        |-- has_many Notifications
        |-- has_many NotificationBundles
        |-- has_many PushSubscriptions
        |-- has_one UserSettings
        |-- has_many Accesses --> Boards

Account (tenant)
  |-- has_many Users
  |-- has_many Boards
  |-- has_many Cards
  |-- has_many Tags
  |-- has_many Columns
  |-- has_many Webhooks
  |-- has_one JoinCode
  |-- has_one Entropy (auto-postpone config)
  |-- has_many Exports

Board
  |-- belongs_to Account
  |-- belongs_to Creator (User)
  |-- has_many Columns
  |-- has_many Cards
  |-- has_many Accesses --> Users
  |-- has_many Events
  |-- has_many Webhooks
  |-- has_many Tags (through Cards)
  |-- has_one Entropy
  |-- has_one Publication
  |-- has_rich_text PublicDescription

Card
  |-- belongs_to Account
  |-- belongs_to Board
  |-- belongs_to Column (optional)
  |-- belongs_to Creator (User)
  |-- has_many Comments
  |-- has_many Assignments --> Users (assignees)
  |-- has_many Steps
  |-- has_many Tags (through Taggings)
  |-- has_many Watches
  |-- has_many Pins
  |-- has_many Events
  |-- has_many Mentions
  |-- has_one Closure
  |-- has_one NotNow
  |-- has_one Goldness
  |-- has_one ActivitySpike
  |-- has_one_attached Image
  |-- has_rich_text Description

Comment
  |-- belongs_to Card
  |-- belongs_to Creator (User)
  |-- has_many Reactions
  |-- has_many Mentions
  |-- has_many Events
  |-- has_rich_text Body

Event
  |-- belongs_to Board
  |-- belongs_to Creator (User)
  |-- belongs_to Eventable (polymorphic: Card, Comment)
  |-- has_many WebhookDeliveries
  |-- has_many Notifications (as source)
```

---

## Core Models

### Account (`app/models/account.rb`)

The top-level tenant entity.

**Associations:**
- `has_one :join_code` (Account::JoinCode)
- `has_many :users, dependent: :destroy`
- `has_many :boards, dependent: :destroy`
- `has_many :cards, dependent: :destroy`
- `has_many :webhooks, dependent: :destroy`
- `has_many :tags, dependent: :destroy`
- `has_many :columns, dependent: :destroy`
- `has_many :exports` (Account::Export)

**Concerns:** `Account::Storage`, `Entropic`, `MultiTenantable`, `Seedeable`

**Validations:** `validates :name, presence: true`

**Callbacks:**
- `before_create :assign_external_account_id` - Generates unique 7+ digit ID
- `after_create :create_join_code` - Creates default join code

**Key Methods:**
- `slug` - Returns `"/#{AccountSlug.encode(external_account_id)}"` for URL generation
- `system_user` - Returns or creates a system-role user for automated actions
- `create_with_owner(account:, owner:)` - Class method for creating account with owner user

**Sub-models:**
- `Account::Entropic` - Adds `has_one :entropy` with default 30-day auto-postpone period
- `Account::MultiTenantable` - `accepting_signups?` class method based on `MULTI_TENANT` env
- `Account::Seedeable` / `Account::Seeder` - Template/fixture data for new accounts
- `Account::ExternalIdSequence` - Monotonic ID generator for external account IDs
- `Account::JoinCode` - Invitation codes with usage counting and limits
- `Account::Export` - Account data export functionality
- `Account::Storage` - Storage usage tracking

---

### Board (`app/models/board.rb`)

Primary organizational unit containing columns and cards.

**Associations:**
- `belongs_to :creator, class_name: "User", default: -> { Current.user }`
- `belongs_to :account, default: -> { creator.account }`
- `has_rich_text :public_description`
- `has_many :tags, -> { distinct }, through: :cards`
- `has_many :events`
- `has_many :webhooks, dependent: :destroy`

**Concerns:** `Accessible`, `AutoPostponing`, `Board::Storage`, `Broadcastable`, `Cards`, `Entropic`, `Filterable`, `Publishable`, `Storage::Tracked`, `Triageable`

**Scopes:**
- `alphabetically` - Ordered by name
- `ordered_by_recently_accessed` - Sorted by last access time

**Key Concern Details:**

#### Board::Accessible (`app/models/board/accessible.rb`)
Controls which users can access the board.
- Two modes: `all_access: true` (open) or `all_access: false` (selective)
- `accessible_to?(user)` - Check user access
- `access_for(user)` - Get access record
- `accessed_by(user)` - Mark access timestamp
- `accesses.grant_to(users)` / `accesses.revoke_from(users)` / `accesses.revise(granted:, revoked:)` - Manage access
- `watchers` - Users with "watching" involvement
- `clean_inaccessible_data_for(user)` - Removes mentions, notifications, watches when access revoked

#### Board::Cards (`app/models/board/cards.rb`)
Card associations and scopes for the board.

#### Board::Entropic (`app/models/board/entropic.rb`)
Board-level entropy override. `has_one :entropy, as: :container`.

#### Board::Publishable (`app/models/board/publishable.rb`)
- `published?` / `publicly_accessible?` - Check publication status
- `publish` - Creates Publication with secure key
- `unpublish` - Destroys publication
- `Board.find_by_published_key(key)` - Lookup by publication key

#### Board::Triageable (`app/models/board/triageable.rb`)
- Stream (triage) card management

#### Board::AutoPostponing (`app/models/board/auto_postponing.rb`)
- `auto_postpone_period` - Returns board-level or account-level entropy period

#### Board::Publication (`app/models/board/publication.rb`)
- `belongs_to :board`
- `has_secure_token :key` - Cryptographic shareable key

---

### Card (`app/models/card.rb`)

The main work item. Most complex model with 22+ concerns.

**Associations:**
- `belongs_to :account, default: -> { board.account }`
- `belongs_to :board`
- `belongs_to :creator, class_name: "User", default: -> { Current.user }`
- `has_many :comments, dependent: :destroy`
- `has_one_attached :image, dependent: :purge_later`
- `has_rich_text :description`

**All Concerns (22):**
`Assignable`, `Attachments`, `Broadcastable`, `Closeable`, `Colored`, `Entropic`, `Eventable`, `Exportable`, `Golden`, `Mentions`, `Multistep`, `Pinnable`, `Postponable`, `Promptable`, `Readable`, `Searchable`, `Stallable`, `Statuses`, `Storage::Tracked`, `Taggable`, `Triageable`, `Watchable`

**Callbacks:**
- `before_save :set_default_title, if: :published?`
- `before_create :assign_number` - Sequential numbering per account
- `after_save -> { board.touch }, if: :published?`
- `after_touch -> { board.touch }, if: :published?`
- `after_update :handle_board_change, if: :saved_change_to_board_id?`

**Scopes:**
- `reverse_chronologically`, `chronologically`, `latest`
- `with_users`, `preloaded`
- `indexed_by(index)` - Routes to stalled/postponing_soon/closed/not_now/golden/drafted
- `sorted_by(sort)` - newest/oldest/latest

**Key Methods:**
- `publicly_accessible?` - True if board is published
- `to_param` - Returns the card number (not UUID) for URLs
- `move_to(new_board)` - Transfers card between boards
- `filled?` - Has a title set

---

### Card Lifecycle & Status Concerns

#### Card::Statuses (`app/models/card/statuses.rb`)
- Enum: `drafted`, `published`
- `publish` - Transitions from drafted to published, tracks event
- `was_just_published?` - Flag set during save

#### Card::Closeable (`app/models/card/closeable.rb`)
- `has_one :closure`
- Scopes: `closed`, `open`, `recently_closed_first`, `closed_at_window`, `closed_by`
- `close(user:)` - Creates closure record + tracks event
- `reopen(user:)` - Destroys closure + tracks event
- `closed?` / `open?` / `closed_by` / `closed_at`

#### Card::Triageable (`app/models/card/triageable.rb`)
- `belongs_to :column, optional: true`
- Scopes: `awaiting_triage`, `triaged`
- `triage_into(column)` - Resumes card, assigns to column, tracks event
- `send_back_to_triage` - Removes from column, tracks event
- `triaged?` / `awaiting_triage?`

#### Card::Postponable (`app/models/card/postponable.rb`)
- `has_one :not_now` (Card::NotNow)
- Scopes: `postponed`, `active`
- `postpone(user:)` - Sends back to triage, reopens, creates not_now, tracks event
- `auto_postpone` - Same as postpone but tracks "auto_postponed" event
- `resume` - Reopens, destroys activity_spike, destroys not_now
- `postponed?` / `active?` / `postponed_at` / `postponed_by`

**Complete Card State Machine:**
```
                    +----------+
                    | drafted  |
                    +----+-----+
                         | publish
                         v
                    +----------+
            +------>| active   |<------+
            |       | (published,      |
            |       |  open,           |
            |       |  no not_now)     |
            |       +----+-----+       |
            |            |             |
    resume  |    +-------+-------+     | reopen
            |    |               |     |
            |    v               v     |
       +----+----+       +------+---+
       | not_now  |       | closed   |
       | (postponed)     | (done)   |
       +----------+       +----------+
```

#### Card::Entropic (`app/models/card/entropic.rb`)
- Scopes: `due_to_be_postponed`, `postponing_soon`
- `Card.auto_postpone_all_due` - Class method run by recurring job
- `entropy` - Returns Card::Entropy object with auto-clean timing
- Complex SQL joins to account and board-level entropy configuration

#### Card::Stallable (`app/models/card/stallable.rb`)
- `has_one :activity_spike` (Card::ActivitySpike)
- `STALLED_AFTER_LAST_SPIKE_PERIOD = 14.days`
- Scopes: `stalled`, `with_activity_spikes`
- `stalled?` - True if activity spike is older than 14 days
- Activity spike detection runs after card updates via background job

#### Card::Assignable (`app/models/card/assignable.rb`)
- `has_many :assignments` / `has_many :assignees, through: :assignments`
- `LIMIT = 100` max assignees per card
- `toggle_assignment(user)` - Assign/unassign toggle
- `assigned_to?(user)` / `assigned?`
- Scopes: `unassigned`, `assigned_to(users)`, `assigned_by(users)`
- Assigns auto-watch the card

#### Card::Golden (`app/models/card/golden.rb`)
- `has_one :goldness` (Card::Goldness)
- Scopes: `golden`, `with_golden_first`
- `gild` / `ungild` - Toggle golden status

#### Card::Watchable (`app/models/card/watchable.rb`)
- `has_many :watches` / `has_many :watchers`
- `watch_by(user)` / `unwatch_by(user)` / `watched_by?(user)`
- Creator automatically subscribes on card creation

#### Card::Pinnable (`app/models/card/pinnable.rb`)
- `has_many :pins`
- `pin_by(user)` / `unpin_by(user)` / `pinned_by?(user)`
- Broadcasts pin updates to user's pin tray

#### Card::Taggable (`app/models/card/taggable.rb`)
- `has_many :taggings` / `has_many :tags, through: :taggings`
- `toggle_tag_with(title)` - Find or create tag, toggle tagging
- Scope: `tagged_with(tags)`

#### Card::Multistep (`app/models/card/multistep.rb`)
- `has_many :steps`

#### Card::Colored (`app/models/card/colored.rb`)
- `color` - Returns column color or default

#### Card::Searchable (`app/models/card/searchable.rb`)
- Includes `::Searchable` concern
- `search_title` - Card title
- `search_content` - Plain text of description
- Scope: `mentioning(query, user:)` - Full-text search

#### Card::Broadcastable (`app/models/card/broadcastable.rb`)
- `broadcasts_refreshes` (Turbo)
- Tracks preview changes (title, column, board)

#### Card::Eventable (`app/models/card/eventable.rb`)
- Includes `::Eventable`
- `event_was_created(event)` - Creates system comment, touches last_active_at
- `touch_last_active_at` - Updates activity timestamp
- Tracks title changes as events

#### Card::Mentions (`app/models/card/mentions.rb`)
- Includes `::Mentions`
- Checks for mentions only on publish

#### Card::Readable (`app/models/card/readable.rb`)
- `read_by(user)` - Marks notifications as read
- `unread_by(user)` - Marks all notifications as unread
- `remove_inaccessible_notifications` - Cleanup for access changes

#### Card::Exportable (`app/models/card/exportable.rb`)
- `export_json` - Full card data as JSON
- `export_attachments` - Collects all blobs for ZIP export

#### Card::Promptable (`app/models/card/promptable.rb`)
- `to_prompt` - Generates AI-friendly text representation of the card

---

### Column (`app/models/column.rb`)

Workflow stages within a board.

**Associations:**
- `belongs_to :account, default: -> { board.account }`
- `belongs_to :board, touch: true`
- `has_many :cards, dependent: :nullify`

**Concerns:** `Colored`, `Positioned`

**Callbacks:**
- `after_save_commit -> { cards.touch_all }` - When name/color changes
- `after_destroy_commit -> { board.cards.touch_all }`

**Column::Colored** - Provides color constants and defaults
**Column::Positioned** - Position management (left/right movement)

---

### Comment (`app/models/comment.rb`)

Rich text comments on cards.

**Associations:**
- `belongs_to :account, default: -> { card.account }`
- `belongs_to :card, touch: true`
- `belongs_to :creator, class_name: "User", default: -> { Current.user }`
- `has_many :reactions, -> { order(:created_at) }, dependent: :delete_all`
- `has_rich_text :body`

**Concerns:** `Attachments`, `Eventable`, `Mentions`, `Promptable`, `Searchable`, `Storage::Tracked`

**Scopes:** `chronologically`, `preloaded`, `by_system`, `by_user`

**Callbacks:** `after_create_commit :watch_card_by_creator` - Creator auto-watches card

**Delegates:** `publicly_accessible?`, `accessible_to?`, `board`, `watch_by` to card

**Comment::Eventable** - Tracks comment creation events
**Comment::Mentions** - Scans rich text for @-mentions
**Comment::Searchable** - Indexes comment body for full-text search

---

### Event (`app/models/event.rb`)

Audit log entry. Records all significant actions.

**Associations:**
- `belongs_to :account, default: -> { board.account }`
- `belongs_to :board`
- `belongs_to :creator, class_name: "User"`
- `belongs_to :eventable, polymorphic: true` (Card or Comment)
- `has_many :webhook_deliveries`

**Concerns:** `Notifiable`, `Particulars`, `Promptable`

**Scopes:** `chronologically`, `preloaded`

**Callbacks:**
- `after_create -> { eventable.event_was_created(self) }`
- `after_create_commit :dispatch_webhooks`

**Event Actions (from Event::Description):**
- `card_published`, `card_closed`, `card_reopened`, `card_postponed`, `card_auto_postponed`
- `card_resumed`, `card_title_changed`, `card_board_changed`, `card_triaged`
- `card_sent_back_to_triage`, `card_assigned`, `card_unassigned`
- `comment_created`

**Event::Particulars** - Stores additional action data (e.g., `assignee_ids`, column names)
**Event::Description** - Generates human-readable descriptions with HTML and plain text variants

---

### User (`app/models/user.rb`)

Account membership linking Identity to Account.

**Associations:**
- `belongs_to :account`
- `belongs_to :identity, optional: true`
- `has_many :comments, inverse_of: :creator`
- `has_many :filters, foreign_key: :creator_id`
- `has_many :closures, dependent: :nullify`
- `has_many :pins` / `has_many :pinned_cards, through: :pins`
- `has_many :exports` (Account::Export)

**Concerns (13):** `Accessor`, `Assignee`, `Attachable`, `Avatar`, `Configurable`, `EmailAddressChangeable`, `Mentionable`, `Named`, `Notifiable`, `Role`, `Searcher`, `Watcher`, `Timelined`

**Validations:** `validates :name, presence: true`

**Key Methods:**
- `deactivate` - Soft-delete (sets `active: false`)
- `setup?` / `verified?` / `verify` - Verification state management

**Key Concerns:**
- `User::Role` - Role hierarchy (owner > admin > member > system). See Permissions doc.
- `User::Accessor` - Auto-grants access to all_access boards on creation
- `User::Assignee` - Assignment-related associations and scopes
- `User::Watcher` - Watch-related associations
- `User::Notifiable` - `has_many :notifications`, `has_many :notification_bundles`
- `User::Searcher` - Search query history
- `User::Configurable` - `has_one :settings` (UserSettings)
- `User::Timelined` - Day timeline functionality
- `User::Named` - Name normalization and display
- `User::Filtering` - Filter management for the user
- `User::Avatar` - Avatar attachment handling
- `User::EmailAddressChangeable` - Email change flow
- `User::Mentionable` - `mentioned_by(user, at: source)` creates Mention records
- `User::Transferable` - Multi-account transfer ID generation

---

### Identity (`app/models/identity.rb`)

Global user entity (email-based, not tenant-scoped).

**Associations:**
- `has_many :access_tokens` (Identity::AccessToken)
- `has_many :magic_links`
- `has_many :sessions`
- `has_many :users`
- `has_many :accounts, through: :users`
- `has_one_attached :avatar`

**Concerns:** `Joinable`, `Transferable`

**Validations:** Email format and normalization

**Key Methods:**
- `send_magic_link(**attributes)` - Creates MagicLink, sends email
- `find_by_permissable_access_token(token, method:)` - Validates bearer token

**Identity::Joinable** - `join(account)` method for adding user to account
**Identity::Transferable** - `transfer_id` signed ID for multi-account switching (4-hour expiry)
**Identity::AccessToken** - API tokens with `has_secure_token`, read/write permissions

---

### Supporting Models

#### Access (`app/models/access.rb`)
Board membership record.
- `belongs_to :board, touch: true` / `belongs_to :user, touch: true`
- Enum: `involvement` - `access_only` (default), `watching`
- `accessed` - Updates `accessed_at` (throttled to 5-min intervals)
- After destroy: Triggers `Board::CleanInaccessibleDataJob`

#### Assignment (`app/models/assignment.rb`)
- `belongs_to :card, touch: true` / `belongs_to :assignee` / `belongs_to :assigner`
- `LIMIT = 100` - Max assignments per card
- Validates within limit on create

#### Tag (`app/models/tag.rb`)
- `belongs_to :account` / `has_many :taggings` / `has_many :cards, through: :taggings`
- Validates title format (no leading `#`), normalizes to lowercase
- Scopes: `alphabetically`, `unused`
- `hashtag` - Returns `#title`

#### Tagging (`app/models/tagging.rb`)
Simple join: `belongs_to :tag` / `belongs_to :card, touch: true`

#### Step (`app/models/step.rb`)
- `belongs_to :card, touch: true`
- Validates content presence
- Scope: `completed`

#### Pin (`app/models/pin.rb`)
- `belongs_to :card` / `belongs_to :user`
- Scope: `ordered` (by created_at desc)

#### Watch (`app/models/watch.rb`)
- `belongs_to :user` / `belongs_to :card, touch: true`
- Scopes: `watching`, `not_watching`

#### Mention (`app/models/mention.rb`)
- Polymorphic `belongs_to :source` (Card or Comment)
- `belongs_to :mentioner` / `belongs_to :mentionee`
- Includes `Notifiable`
- `self_mention?` - True if mentioner == mentionee
- After create: Auto-watches the card

#### Reaction (`app/models/reaction.rb`)
- `belongs_to :comment, touch: true` / `belongs_to :reacter`
- After create: Registers card activity

#### Closure (`app/models/closure.rb`)
- `belongs_to :card, touch: true` / `belongs_to :user, optional: true`

#### Card::NotNow (`app/models/card/not_now.rb`)
- `belongs_to :card, touch: true` / `belongs_to :user, optional: true`

#### Card::Goldness (`app/models/card/goldness.rb`)
- `belongs_to :card, touch: true`

#### Card::ActivitySpike (`app/models/card/activity_spike.rb`)
- `belongs_to :card, touch: true`

#### Card::Engagement (`app/models/card/engagement.rb`)
- `belongs_to :card, touch: true`
- Validates status: "doing" or "on_deck"

#### Card::Entropy (`app/models/card/entropy.rb`)
Plain Ruby object (not ActiveRecord). Calculates auto-clean timing for a card.
- `auto_clean_at` - When the card will be auto-postponed
- `days_before_reminder` - 25% of entropy period in days

---

### Notification Models

#### Notification (`app/models/notification.rb`)
- `belongs_to :user` / `belongs_to :creator` / Polymorphic `belongs_to :source`
- Includes `PushNotifiable`
- Scopes: `unread`, `read`, `ordered`, `preloaded`
- `read` / `unread` / `read?` - State management
- `read_all` - Class method marks all as read
- After create: Broadcasts unread count, creates bundle

#### Notification::Bundle (`app/models/notification/bundle.rb`)
Time-windowed email notification aggregation.
- Enum: `pending`, `processing`, `delivered`
- Scopes: `due`, `containing`, `overlapping_with`
- `deliver` - Sends bundled email notification
- `deliver_all` - Class method for recurring job
- 30-minute default window (configurable via user settings)
- Validates no overlapping windows

#### Notifier (`app/models/notifier.rb`)
Factory pattern for notification dispatch.
- `Notifier.for(source)` - Routes to specialized notifier based on source type
- `notify` - Creates Notification records for recipients, sorted by ID to avoid deadlocks

#### Notifier::CardEventNotifier
Recipients based on event type:
- `card_assigned` -> assignees (excluding creator)
- `card_published` -> board watchers + assignees (excluding creator and mentionees)
- `comment_created` -> card watchers (excluding creator and mentionees)
- Default -> board watchers (excluding creator)

#### Notifier::CommentEventNotifier
Recipients: card watchers excluding creator and comment mentionees

#### Notifier::MentionNotifier
Recipients: the mentionee (unless self-mention)

---

### Webhook Models

#### Webhook (`app/models/webhook.rb`)
- `belongs_to :board` / `has_many :deliveries` / `has_one :delinquency_tracker`
- `has_secure_token :signing_secret`
- Serialized `subscribed_actions` (JSON array)
- Validates name presence and URL format
- PERMITTED_ACTIONS: card_assigned, card_closed, card_postponed, etc.
- Detects Slack, Campfire, and Basecamp webhook URLs for format adaptation
- `trigger(event)` - Creates delivery record
- `activate` / `deactivate`

#### Webhook::Delivery (`app/models/webhook/delivery.rb`)
- Enum: `pending`, `in_progress`, `completed`, `errored`
- Performs HTTP POST with signed payload
- SSRF protection via IP resolution
- Timeout: 7 seconds, max response: 100KB
- Content adaptation: JSON (default), HTML (Campfire), mrkdwn (Slack), form-encoded (Basecamp)
- Headers include `X-Webhook-Signature` (HMAC-SHA256) and `X-Webhook-Timestamp`

#### Webhook::DelinquencyTracker (`app/models/webhook/delinquency_tracker.rb`)
- Tracks consecutive failures
- Auto-deactivates webhook after 10 failures within 1 hour
- Resets on successful delivery

---

### Search Models

#### Search::Record (`app/models/search/record.rb`)
- Polymorphic `belongs_to :searchable` (Card or Comment)
- `belongs_to :card`
- Class method `for(account_id)` returns the correct shard class

#### Search::Record::Trilogy (`app/models/search/record/trilogy.rb`)
MySQL-specific 16-shard implementation.
- `SHARD_COUNT = 16`
- Shard selection: `CRC32(account_id) % 16`
- Uses MySQL BOOLEAN MODE full-text matching
- Content stemmed via Search::Stemmer before storage
- Account key prefix (`"account{id}"`) for query isolation

#### Search::Query (`app/models/search/query.rb`)
Query parsing and validation.

#### Search::Highlighter (`app/models/search/highlighter.rb`)
Search result highlighting (snippets and full-text).

#### Search::Stemmer (`app/models/search/stemmer.rb`)
Text stemming for search indexing.

---

### Entropy Model

#### Entropy (`app/models/entropy.rb`)
Polymorphic auto-postponement configuration.
- `belongs_to :container, polymorphic: true` (Account or Board)
- `after_commit -> { container.cards.touch_all }` - Resets entropy timers
- Default period: 2,592,000 seconds (30 days)

---

### Filter Model

#### Filter (`app/models/filter.rb`)
Saved search/filter configuration.

**Associations:**
- `belongs_to :creator` / `belongs_to :account`

**Concerns:** `Fields`, `Params`, `Resources`, `Summarized`

**Key Methods:**
- `Filter.from_params(params)` - Build filter from URL params
- `Filter.remember(attrs)` - Persist filter for reuse
- `cards` - Execute complex filtering query
- `empty?` / `single_board` / `cacheable?`

**Filter::Fields** - JSON field accessors for criteria
**Filter::Params** - Parameter parsing and digest generation
**Filter::Resources** - Association management (boards, tags, assignees, etc.)
**Filter::Summarized** - Human-readable filter summary

---

### Shared Concerns

#### Eventable (`app/models/concerns/eventable.rb`)
- Adds `has_many :events, as: :eventable`
- `track_event(action, creator:, board:, **particulars)` - Creates event record

#### Notifiable (`app/models/concerns/notifiable.rb`)
- Adds `has_many :notifications, as: :source`
- `after_create_commit :notify_recipients_later` - Queues notification job

#### PushNotifiable (`app/models/concerns/push_notifiable.rb`)
- `after_create_commit :push_notification_later` - Queues web push notification

#### Searchable (`app/models/concerns/searchable.rb`)
- Lifecycle hooks: create/update/destroy search index records
- Models must implement: `search_title`, `search_content`, `search_card_id`, `search_board_id`

#### Mentions (`app/models/concerns/mentions.rb`)
- `has_many :mentions, as: :source`
- Scans rich text for @-mention attachments (Action Text attachables)
- Creates Mention records asynchronously via job

#### Filterable (`app/models/concerns/filterable.rb`)
- `has_and_belongs_to_many :filters`
- Touches filters on update, removes from filters on destroy

#### Attachments (`app/models/concerns/attachments.rb`)
- Rich text attachment helpers (embeds, remote images, remote videos)
- Image variant configuration: small (800x600), large (1024x768)

#### Storage::Tracked / Storage::Totaled
- Storage usage tracking via entries and materialized totals

---

## Convex Translation Notes

### Model → Document Mapping

1. **Concerns become utility functions**: Instead of Ruby mixins, create shared TypeScript functions that operate on document types. For example, `Closeable` becomes a set of mutation functions (`closeCard`, `reopenCard`) and query helpers (`isClosed`).

2. **Polymorphic associations become discriminated unions**: Instead of `source_type`/`source_id`, use:
   ```typescript
   source: v.union(
     v.object({ type: v.literal("event"), id: v.id("events") }),
     v.object({ type: v.literal("mention"), id: v.id("mentions") })
   )
   ```

3. **Callbacks become mutation side-effects**: Instead of `after_create_commit`, call the side effect directly in the mutation function, or use Convex's `ctx.scheduler` for async work.

4. **`touch` becomes explicit updates**: When Fizzy does `belongs_to :card, touch: true`, in Convex you'd explicitly update the parent's `updatedAt` field in the mutation.

5. **Scopes become query functions**: Each ActiveRecord scope translates to a Convex query function with appropriate index usage.

6. **Counter caches require manual management**: Maintain count fields and update them in mutations, or compute dynamically via queries.

7. **Rich text**: Instead of Action Text's separate table, store rich text as a JSON field (e.g., TipTap/ProseMirror JSON format) directly in the card/comment document.

8. **State machines**: Card lifecycle states (drafted/published/active/closed/postponed) can be modeled as a `status` field with validation in mutations. Consider using a union type for compile-time safety:
   ```typescript
   status: v.union(
     v.literal("drafted"),
     v.literal("active"),
     v.literal("closed"),
     v.literal("postponed")
   )
   ```

9. **Notification system**: Convex's real-time subscriptions mean you may not need a separate notification table for in-app notifications. However, for email bundling and push notifications, you'd still maintain notification documents and use scheduled functions for aggregation.

10. **Entropy system**: Implement as a Convex cron job that queries cards with `lastActiveAt` older than the configured period and calls a mutation to postpone them.

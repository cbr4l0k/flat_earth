# Multi-Tenancy

Fizzy uses **URL path-based multi-tenancy** to isolate data between organizations (accounts) without subdomains or separate databases.

## Key Files

| File | Purpose |
|------|---------|
| `config/initializers/tenanting/account_slug.rb` | Rack middleware for URL extraction |
| `config/initializers/tenanting/turbo.rb` | Turbo Streams account-aware rendering |
| `app/helpers/tenanting_helper.rb` | Action Cable URL helper |
| `app/models/current.rb` | Thread-local context attributes |
| `app/models/account.rb` | Account model with slug generation |
| `app/models/account/multi_tenantable.rb` | Multi-tenant toggle |
| `config/initializers/active_job.rb` | Job account context serialization |
| `config/initializers/multi_tenant.rb` | Multi-tenant environment config |

---

## How URL Path Tenanting Works

### URL Structure

All authenticated routes are prefixed with the account's external ID:

```
https://fizzy.example.com/{external_account_id}/boards
https://fizzy.example.com/{external_account_id}/cards/42
https://fizzy.example.com/{external_account_id}/events
```

The `external_account_id` is a 7+ digit number (zero-padded), e.g., `0001234567`.

### Middleware: AccountSlug::Extractor

The core mechanism is a Rack middleware that runs before Rails:

```ruby
# config/initializers/tenanting/account_slug.rb
AccountSlug::PATTERN = /(\d{7,})/

class AccountSlug::Extractor
  def call(env)
    if slug = extract_slug(env["PATH_INFO"])
      # Move slug from PATH_INFO to SCRIPT_NAME
      env["SCRIPT_NAME"] = "/#{slug}"
      env["PATH_INFO"] = env["PATH_INFO"].sub("/#{slug}", "")

      # Store account ID
      env["fizzy.external_account_id"] = AccountSlug.decode(slug)

      # Wrap request in account context
      account = Account.find_by(external_account_id: env["fizzy.external_account_id"])
      Current.with_account(account) { @app.call(env) }
    else
      @app.call(env)
    end
  end
end
```

### The SCRIPT_NAME Trick

This is the key architectural insight:

1. **Before middleware:** URL is `/0001234567/boards`
2. **After middleware:** `SCRIPT_NAME = "/0001234567"`, `PATH_INFO = "/boards"`
3. **Rails sees:** The app is "mounted" at `/0001234567`, and the route is `/boards`
4. **URL generation:** `board_path(board)` generates `/boards/123`, and Rails prepends `SCRIPT_NAME` to produce `/0001234567/boards/123`

This means:
- **No route changes needed** - Routes are defined normally without account prefix
- **URL helpers work automatically** - Rails prepends the account slug
- **No path parameter for account** - It's extracted at the Rack level

### Encoding/Decoding

```ruby
AccountSlug.encode(id) => "%07d" % id     # e.g., 1234567 => "0001234567"
AccountSlug.decode(slug) => slug.to_i      # e.g., "0001234567" => 1234567
```

---

## Current Context (Thread-Local State)

### Current Attributes (`app/models/current.rb`)

```ruby
class Current < ActiveSupport::CurrentAttributes
  attribute :session, :user, :identity, :account
  attribute :http_method, :request_id, :user_agent, :ip_address, :referrer
end
```

### Auto-Population Chain

When attributes are set, they cascade:

```
Current.account = Account  (set by middleware)
         ↓
Current.session = Session  (set by authentication)
         ↓ (auto)
Current.identity = session.identity
         ↓ (auto)
Current.user = identity.users.find_by(account: Current.account)
```

The key code in `Current`:
```ruby
def session=(value)
  super(value)
  self.identity = session.identity if value.present?
end

def identity=(identity)
  super(identity)
  self.user = identity.users.find_by(account: account) if identity.present?
end
```

### Context Helpers

```ruby
Current.with_account(account) { ... }    # Temporarily set account
Current.without_account { ... }           # Temporarily clear account
```

---

## Data Isolation

### Account ID on Every Table

Every tenant-scoped table includes `account_id`:

```ruby
# 60+ tables have this pattern:
create_table "cards" do |t|
  t.uuid "account_id", null: false
  # ...
end
```

### Explicit Scoping (No Default Scope)

Fizzy does **NOT** use `default_scope` for tenant isolation. Instead, controllers explicitly scope queries:

```ruby
# Controllers scope through Current.account or Current.user
@boards = Current.user.boards        # Only boards with Access records
@tags = Current.account.tags          # Only tags in this account
@cards = Current.account.cards        # Only cards in this account
```

This is a deliberate design choice. Benefits:
- No magic - developers see exactly what's being queried
- No accidental cross-tenant queries
- Easy to override for cross-account operations (admin, exports)

### Model Default Associations

Models set `account_id` via default lambdas:

```ruby
class Card < ApplicationRecord
  belongs_to :account, default: -> { board.account }
end

class Board < ApplicationRecord
  belongs_to :account, default: -> { creator.account }
end

class Comment < ApplicationRecord
  belongs_to :account, default: -> { card.account }
end
```

This chains up to the Account through the association graph.

---

## Background Job Context Preservation

### The Problem

When a background job is enqueued, `Current.account` is set. When the job executes (possibly on a different server, later), the context is lost.

### The Solution (`config/initializers/active_job.rb`)

`FizzyActiveJobExtensions` is prepended to `ActiveJob::Base`:

```ruby
module FizzyActiveJobExtensions
  def initialize(...)
    super
    @account = Current.account  # Capture at enqueue time
  end

  def serialize
    super.merge({ "account" => @account&.to_gid })  # Serialize as GlobalID
  end

  def deserialize(job_data)
    super
    if _account = job_data.fetch("account", nil)
      @account = GlobalID::Locator.locate(_account)  # Deserialize
    end
  end

  def perform_now
    if account.present?
      Current.with_account(account) { super }  # Restore context
    else
      super
    end
  end
end
```

**Flow:**
1. Job enqueued while `Current.account = Account A`
2. Account serialized as GlobalID string in job payload
3. Job picked up by Solid Queue worker
4. Account deserialized from GlobalID
5. Job execution wrapped in `Current.with_account(account)`
6. All model operations within the job see the correct account

---

## Turbo Streams Account-Aware Rendering

### WebSocket Broadcasts (`config/initializers/tenanting/turbo.rb`)

When broadcasting Turbo Streams via WebSocket, the rendered HTML must include correct account-prefixed URLs:

```ruby
# Override Turbo's render to include script_name
if Current.account.present?
  ApplicationController.renderer.new(script_name: Current.account.slug).render(...)
else
  super
end
```

### Action Cable URL (`app/helpers/tenanting_helper.rb`)

The Action Cable WebSocket URL must also include the account prefix:

```ruby
def tenanted_action_cable_meta_tag
  tag "meta",
      name: "action-cable-url",
      content: "#{request.script_name}#{ActionCable.server.config.mount_path}"
end
```

This ensures WebSocket connections are established under the correct account path.

---

## Account Creation

### External ID Generation

Each account gets a unique monotonically-increasing external ID:

```ruby
# app/models/account.rb
before_create :assign_external_account_id

def assign_external_account_id
  self.external_account_id ||= ExternalIdSequence.next
end
```

`Account::ExternalIdSequence` uses a database sequence table to generate unique 7+ digit IDs.

### Account Slug

```ruby
def slug
  "/#{AccountSlug.encode(external_account_id)}"
end
```

The slug is the URL prefix used in all routes for that account.

---

## Multi-Tenant vs Single-Tenant Mode

### Configuration (`config/initializers/multi_tenant.rb`)

```ruby
Account.multi_tenant = ENV["MULTI_TENANT"] == "true" || config.x.multi_tenant.enabled == true
```

### Effect on Signups

```ruby
# app/models/account/multi_tenantable.rb
def self.accepting_signups?
  multi_tenant || Account.none?
end
```

- **Multi-tenant mode (`MULTI_TENANT=true`):** Anyone can sign up and create a new account
- **Single-tenant mode:** Signups only allowed when no accounts exist (first setup)

This allows Fizzy to be deployed as either a multi-tenant SaaS or a self-hosted single-tenant instance.

---

## Account Seeding

When a new account is created, it's seeded with default data:

```ruby
# app/models/account/seedeable.rb / seeder.rb
# Creates:
# - Default board with columns (e.g., "To Do", "In Progress", "Done")
# - System user for automated actions
# - Default entropy configuration (30-day auto-postpone)
```

---

## Request Lifecycle Summary

```
1. HTTP Request: GET /0001234567/boards
                      |
2. Rack Middleware (AccountSlug::Extractor)
   - Extracts "0001234567" from PATH_INFO
   - Sets SCRIPT_NAME = "/0001234567"
   - Sets PATH_INFO = "/boards"
   - Finds Account by external_account_id
   - Wraps request in Current.with_account(account)
                      |
3. Rails Router
   - Matches PATH_INFO "/boards" to BoardsController#index
                      |
4. ApplicationController before_actions
   a. require_account → checks Current.account present
   b. require_authentication → resumes session from cookie
      → sets Current.session → Current.identity → Current.user
                      |
5. Authorization
   - ensure_can_access_account → checks Current.user active
                      |
6. Controller Action
   - @boards = Current.user.boards (scoped to account via Access records)
                      |
7. View Rendering
   - URL helpers prepend SCRIPT_NAME automatically
   - board_path(board) → "/0001234567/boards/{board_id}"
```

---

## Convex Translation Notes

### Multi-Tenancy Strategy

In Convex, multi-tenancy is typically achieved via document filtering rather than URL path manipulation:

1. **Organization field on every document**: Equivalent to `account_id`:
   ```typescript
   // convex/schema.ts
   boards: defineTable({
     organizationId: v.id("organizations"),
     name: v.string(),
     // ...
   }).index("by_organization", ["organizationId"])
   ```

2. **Query-level isolation**: Every query filters by organization:
   ```typescript
   export const listBoards = query({
     handler: async (ctx) => {
       const orgId = await getCurrentOrganizationId(ctx);
       return ctx.db
         .query("boards")
         .withIndex("by_organization", q => q.eq("organizationId", orgId))
         .collect();
     }
   });
   ```

3. **No URL path manipulation needed**: In a React/Next.js frontend, the active organization is typically stored in:
   - URL path parameter (`/org/{orgId}/boards`)
   - Client-side state (React context)
   - Clerk organization context (if using Clerk)

4. **Background job context**: Convex scheduled functions receive explicit arguments, so you'd pass `organizationId` as a parameter rather than relying on thread-local state:
   ```typescript
   await ctx.scheduler.runAfter(0, api.notifications.deliver, {
     organizationId: orgId,
     bundleId: bundle._id,
   });
   ```

### Key Differences

| Fizzy (Rails) | Convex |
|---------------|--------|
| Rack middleware extracts account | Frontend passes orgId to queries |
| `Current.account` thread-local | `organizationId` passed as function argument |
| SCRIPT_NAME trick for URL generation | React router handles org prefix |
| `default: -> { board.account }` | Explicit orgId in mutations |
| Job serialization via GlobalID | Scheduled function receives orgId arg |
| No default_scope (explicit scoping) | Index-based queries (explicit scoping) |

### Clerk Organizations

If using Clerk, multi-tenancy maps cleanly:
- Clerk Organization = Fizzy Account
- Clerk Membership = Fizzy User (with role)
- `ctx.auth.getUserIdentity().org_id` = `Current.account.id`

This gives you multi-tenancy with organization switching, invitations, and role management out of the box.

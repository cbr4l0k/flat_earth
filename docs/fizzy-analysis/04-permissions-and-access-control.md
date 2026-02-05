# Permissions and Access Control

Fizzy implements a layered permission system with account-level roles, board-level access records, and published board public access.

## Key Files

| File | Purpose |
|------|---------|
| `app/models/user/role.rb` | Role hierarchy and permission methods |
| `app/models/user/accessor.rb` | Automatic board access grants |
| `app/models/access.rb` | Board access record model |
| `app/models/board/accessible.rb` | Board access control logic |
| `app/models/board/publishable.rb` | Public board sharing |
| `app/models/board/publication.rb` | Publication key storage |
| `app/controllers/concerns/authorization.rb` | Controller permission checks |
| `app/controllers/concerns/board_scoped.rb` | Board access enforcement |
| `app/controllers/public/base_controller.rb` | Public access handling |

---

## Role Hierarchy

Fizzy has four roles, stored as a string enum on the `users` table:

```
owner > admin > member > system
```

| Role | Description |
|------|-------------|
| `owner` | Account creator. Highest privilege. Cannot be managed by admins. |
| `admin` | Administrative access. Can manage boards, users (except owner), settings. |
| `member` | Regular user. Can access assigned boards, create/manage their own cards. |
| `system` | Internal system user for automated actions. No automatic board access. |

### Role Definition (`app/models/user/role.rb`)

```ruby
enum :role, %w[ owner admin member system ].index_by(&:itself)
```

**Scopes:**
| Scope | Query |
|-------|-------|
| `User.owner` | `where(active: true, role: :owner)` |
| `User.admin` | `where(active: true, role: [:owner, :admin])` |
| `User.member` | `where(active: true, role: :member)` |
| `User.active` | `where(active: true, role: [:owner, :admin, :member])` |

### Permission Methods

| Method | Logic | Usage |
|--------|-------|-------|
| `admin?` | `super \|\| owner?` | Owner is implicitly admin |
| `can_change?(other)` | `(admin? && !other.owner?) \|\| other == self` | Can modify another user's profile |
| `can_administer?(other)` | `admin? && !other.owner? && other != self` | Can manage another user as admin |
| `can_administer_board?(board)` | `admin? \|\| board.creator == self` | Can manage board settings |
| `can_administer_card?(card)` | `admin? \|\| card.creator == self` | Can manage card settings |

### Permission Matrix

| Action | Owner | Admin | Member | System |
|--------|-------|-------|--------|--------|
| View account settings | Yes | Yes | No | No |
| Manage users | Yes | Yes (except owner) | Self only | No |
| Create boards | Yes | Yes | Yes | No |
| Delete boards | Yes | Yes (any) | Own only | No |
| Manage board access | Yes | Yes (any) | Own boards | No |
| Create cards | Yes | Yes | Yes (on accessible boards) | No |
| Close/reopen cards | Yes | Yes | Yes (on accessible boards) | No |
| Delete cards | Yes | Yes (any) | Own cards only | No |
| Manage webhooks | Yes | Yes | Board creator only | No |
| View all boards | Yes | Yes | Accessible only | No |
| Manage entropy | Yes | Yes | No | No |
| Export account | Yes | Yes | No | No |
| Manage join codes | Yes | Yes | No | No |

---

## Board-Level Access Control

### Two Access Modes

#### 1. All Access Boards (`all_access: true`)

Open boards where every active user in the account automatically has access.

- When a board is set to `all_access: true`, Access records are created for all active users
- When a new user is created, they automatically get Access to all `all_access` boards
- Individual access cannot be revoked on all_access boards

#### 2. Selective Boards (`all_access: false`)

Boards with explicit access grants.

- Only users with an Access record can view/interact with the board
- Access is managed via `grant_to` / `revoke_from` / `revise`
- Board creator always retains access (with "watching" involvement)

### Access Model (`app/models/access.rb`)

| Attribute | Type | Details |
|-----------|------|---------|
| `board_id` | uuid | FK to boards |
| `user_id` | uuid | FK to users |
| `involvement` | string | "access_only" or "watching" |
| `accessed_at` | datetime | Last access timestamp (throttled to 5-min intervals) |

**Unique constraint:** `(board_id, user_id)` - One access record per user per board.

**Involvement types:**
- `access_only` - User can view and interact with the board
- `watching` - User is actively watching (receives notifications for all board activity)

### Access Management Methods (`app/models/board/accessible.rb`)

| Method | Purpose |
|--------|---------|
| `board.accessible_to?(user)` | Check if user has access |
| `board.access_for(user)` | Get the Access record (or nil) |
| `board.accessed_by(user)` | Mark user's access as recent |
| `board.accesses.grant_to(users)` | Create Access records |
| `board.accesses.revoke_from(users)` | Destroy Access records |
| `board.accesses.revise(granted:, revoked:)` | Atomic grant and revoke |
| `board.watchers` | Active users with "watching" involvement |
| `board.users` | All users with access |

### Data Cleanup on Access Revocation

When a user loses access to a board, a background job (`Board::CleanInaccessibleDataJob`) removes:
- Their mentions on that board's cards
- Their notifications from that board's events
- Their watches on that board's cards

```ruby
# Access model - after_destroy callback
after_destroy -> { Board::CleanInaccessibleDataJob.perform_later(user, board) }
```

### Automatic Access Grants (`app/models/user/accessor.rb`)

When a new User is created (except system users):
```ruby
after_create :grant_access_to_all_access_boards, unless: :system?

def grant_access_to_all_access_boards
  boards = account.boards.where(all_access: true)
  Access.insert_all(boards.map { |board|
    { account_id: account_id, board_id: board.id, user_id: id, involvement: "access_only" }
  })
end
```

---

## Controller-Level Authorization

### Authorization Concern (`app/controllers/concerns/authorization.rb`)

**Global before action:**
```ruby
before_action :ensure_can_access_account, if: -> { Current.account.present? && authenticated? }
```

This runs on every request and ensures:
1. `Current.user` exists (identity has a User in the current account)
2. The user is active

### Authorization Methods

| Method | Check | Response |
|--------|-------|----------|
| `ensure_can_access_account` | User exists AND active | 403 or redirect to session menu |
| `ensure_admin` | `Current.user.admin?` | 403 if not |
| `ensure_staff` | `Current.identity.staff?` | 403 if not |

### Opt-Out Macros

| Macro | Effect |
|-------|--------|
| `allow_unauthorized_access` | Skip account access check |
| `require_access_without_a_user` | Skip check AND redirect existing users |

### Board-Level Enforcement (`app/controllers/concerns/board_scoped.rb`)

```ruby
module BoardScoped
  included do
    before_action :set_board
  end

  private
    def set_board
      @board = Current.user.boards.find(params[:board_id])
    end

    def ensure_permission_to_admin_board
      unless Current.user.can_administer_board?(@board)
        head :forbidden
      end
    end
end
```

Key point: `Current.user.boards` only returns boards the user has Access records for. Using `.find()` on this scope raises `ActiveRecord::RecordNotFound` (404) if the user doesn't have access.

### Card-Level Enforcement (`app/controllers/concerns/card_scoped.rb`)

```ruby
def set_card
  @card = Current.user.accessible_cards.find_by!(number: params[:card_id])
end
```

Cards are looked up by number (not UUID) and scoped to the user's accessible cards.

---

## Published Boards (Public Access)

Boards can be made publicly accessible via a shareable key.

### Publication Model (`app/models/board/publication.rb`)

```ruby
class Board::Publication < ApplicationRecord
  belongs_to :board
  has_secure_token :key  # Cryptographically secure random key
end
```

### Publishable Concern (`app/models/board/publishable.rb`)

| Method | Purpose |
|--------|---------|
| `board.published?` | Has a Publication record |
| `board.publicly_accessible?` | Alias for `published?` |
| `board.publish` | Creates Publication with secure key |
| `board.unpublish` | Destroys Publication |
| `Board.find_by_published_key(key)` | Lookup by shareable key |

### Public Controllers

Public access is handled by controllers under `Public::` namespace:

```ruby
# app/controllers/public/base_controller.rb
class Public::BaseController < ApplicationController
  allow_unauthenticated_access   # No login required
  allow_unauthorized_access      # No account check

  before_action :set_board

  private
    def set_board
      @board = Board.find_by_published_key(params[:board_id])
    end
end
```

**Public routes:**
- `GET /public/boards/:key` - View published board
- `GET /public/boards/:key/cards/:id` - View card on published board
- `GET /public/boards/:key/columns/:id` - View column on published board
- `GET /public/boards/:key/columns/not_now` - View postponed cards
- `GET /public/boards/:key/columns/stream` - View triage cards
- `GET /public/boards/:key/columns/closed` - View closed cards

Public boards show cards, columns, and card details (including comments) but do not allow any write operations.

---

## Access Decision Flowchart

```
Request arrives at /{account_id}/boards/{board_id}
    |
    v
Is account_id valid?
    |-- No --> 404
    |-- Yes --> Set Current.account
    v
Is user authenticated?
    |-- No --> Redirect to /session/new
    |-- Yes --> Set Current.session, Current.identity, Current.user
    v
Does Current.user exist in this account?
    |-- No --> 403 or redirect to session menu
    |-- Yes
    v
Is Current.user active?
    |-- No --> 403
    |-- Yes
    v
Does user have Access record for this board?
    |-- No --> 404 (RecordNotFound)
    |-- Yes --> Allow access
    v
Is action admin-only? (e.g., board settings, delete)
    |-- No --> Allow
    |-- Yes
    v
Is user admin? OR board creator?
    |-- No --> 403
    |-- Yes --> Allow
```

---

## Convex Translation Notes

### Role System

The role hierarchy maps directly to a string union field on the user document:

```typescript
// convex/schema.ts
users: defineTable({
  accountId: v.id("accounts"),
  identityId: v.string(), // Clerk user ID
  name: v.string(),
  role: v.union(
    v.literal("owner"),
    v.literal("admin"),
    v.literal("member"),
    v.literal("system")
  ),
  active: v.boolean(),
})
```

Permission checks become TypeScript helper functions:

```typescript
function isAdmin(user: Doc<"users">): boolean {
  return user.role === "owner" || user.role === "admin";
}

function canAdministerBoard(user: Doc<"users">, board: Doc<"boards">): boolean {
  return isAdmin(user) || board.creatorId === user._id;
}
```

### Board Access

In Convex, the `accesses` table works the same way. However, Convex's query model means you enforce access in query/mutation functions rather than at the ORM scope level:

```typescript
// convex/boards.ts
export const getBoard = query({
  args: { boardId: v.id("boards") },
  handler: async (ctx, { boardId }) => {
    const user = await getCurrentUser(ctx);
    const board = await ctx.db.get(boardId);

    // Check access
    const access = await ctx.db
      .query("accesses")
      .withIndex("by_board_user", q => q.eq("boardId", boardId).eq("userId", user._id))
      .unique();

    if (!access) throw new ConvexError("Not authorized");
    return board;
  }
});
```

### Published Boards

Published boards work similarly - store a `publicKey` field on the board (or a separate `boardPublications` table) and create unauthenticated query functions that look up by key:

```typescript
export const getPublicBoard = query({
  args: { publicKey: v.string() },
  handler: async (ctx, { publicKey }) => {
    // No auth required
    const publication = await ctx.db
      .query("boardPublications")
      .withIndex("by_key", q => q.eq("key", publicKey))
      .unique();
    if (!publication) throw new ConvexError("Board not found");
    return ctx.db.get(publication.boardId);
  }
});
```

### Key Difference: Server-Side Enforcement

In Fizzy (Rails), authorization is enforced via:
1. Controller before_actions
2. ActiveRecord scopes (e.g., `Current.user.boards`)

In Convex, ALL authorization must be enforced in server functions (queries/mutations). The client never directly accesses the database. This is actually more secure by default since there's no way to bypass server-side checks.

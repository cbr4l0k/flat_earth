# API Surface

This document covers the complete route map, REST resource modeling patterns, controller concerns, JSON rendering, and rate limiting.

---

## Route Architecture

All routes are defined in `config/routes.rb`. Due to URL path-based multi-tenancy, the account prefix (`/{external_account_id}`) is handled by Rack middleware and is transparent to the router.

### Route Structure Overview

```
/                                    → events#index (dashboard)
/session                             → session management (login/logout)
/signup                              → account creation
/join/:code                          → invitation flow
/my/...                              → personal area
/account/...                         → account settings
/boards/...                          → boards and sub-resources
/cards/...                           → cards and sub-resources
/columns/...                         → column operations
/events/...                          → activity timeline
/notifications/...                   → notification management
/search                              → full-text search
/filters/...                         → saved filters
/tags                                → tag listing
/public/boards/...                   → published board views
/admin/jobs                          → Mission Control (job monitoring)
```

---

## Complete Route Map

### Root
| Method | Path | Controller#Action |
|--------|------|-------------------|
| GET | `/` | `events#index` |

### Session Management
| Method | Path | Controller#Action | Notes |
|--------|------|-------------------|-------|
| GET | `/session/new` | `sessions#new` | Login page |
| POST | `/session` | `sessions#create` | Submit email for magic link |
| DELETE | `/session` | `sessions#destroy` | Logout |
| GET | `/session/magic_link` | `sessions/magic_links#show` | Code entry page |
| POST | `/session/magic_link` | `sessions/magic_links#create` | Verify code |
| GET | `/session/menu` | `sessions/menus#show` | Account picker |
| GET | `/session/transfers/:id` | `sessions/transfers#show` | Transfer page |
| PATCH | `/session/transfers/:id` | `sessions/transfers#update` | Execute transfer |

### Signup
| Method | Path | Controller#Action |
|--------|------|-------------------|
| GET | `/signup/new` | `signups#new` |
| POST | `/signup` | `signups#create` |
| GET | `/signup/completion/new` | `signups/completions#new` |
| POST | `/signup/completion` | `signups/completions#create` |

### Join Codes
| Method | Path | Controller#Action |
|--------|------|-------------------|
| GET | `/join/:code` | `join_codes#new` |
| POST | `/join/:code` | `join_codes#create` |

### Account Settings
| Method | Path | Controller#Action |
|--------|------|-------------------|
| GET/PATCH | `/account/settings` | `account/settings#show/update` |
| GET/PATCH | `/account/entropy` | `account/entropies#show/update` |
| GET/PATCH | `/account/join_code` | `account/join_codes#show/update` |
| POST | `/account/exports` | `account/exports#create` |
| GET | `/account/exports/:id` | `account/exports#show` |

### Users
| Method | Path | Controller#Action |
|--------|------|-------------------|
| GET | `/users` | `users#index` |
| GET | `/users/:id` | `users#show` |
| GET | `/users/:id/edit` | `users#edit` |
| PATCH | `/users/:id` | `users#update` |
| DELETE | `/users/:id` | `users#destroy` |
| PATCH | `/users/:user_id/avatar` | `users/avatars#update` |
| DELETE | `/users/:user_id/avatar` | `users/avatars#destroy` |
| PATCH | `/users/:user_id/role` | `users/roles#update` |
| GET | `/users/:user_id/events` | `users/events#show` |
| CRUD | `/users/:user_id/push_subscriptions` | `users/push_subscriptions#*` |
| CRUD | `/users/:user_id/email_addresses` | `users/email_addresses#*` |
| POST | `/users/:user_id/email_addresses/:token/confirmation` | `users/email_addresses/confirmations#create` |

### User Verification & Joins
| Method | Path | Controller#Action |
|--------|------|-------------------|
| CRUD | `/users/joins` | `users/joins#*` |
| GET | `/users/verifications/new` | `users/verifications#new` |
| POST | `/users/verifications` | `users/verifications#create` |

### Boards
| Method | Path | Controller#Action |
|--------|------|-------------------|
| GET | `/boards` | `boards#index` |
| POST | `/boards` | `boards#create` |
| GET | `/boards/new` | `boards#new` |
| GET | `/boards/:id` | `boards#show` |
| GET | `/boards/:id/edit` | `boards#edit` |
| PATCH | `/boards/:id` | `boards#update` |
| DELETE | `/boards/:id` | `boards#destroy` |

### Board Sub-Resources
| Method | Path | Controller#Action | Notes |
|--------|------|-------------------|-------|
| GET/PATCH | `/boards/:board_id/subscriptions` | `boards/subscriptions#show/update` | Watch/unwatch |
| GET/PATCH | `/boards/:board_id/involvement` | `boards/involvements#show/update` | Involvement level |
| POST/DELETE | `/boards/:board_id/publication` | `boards/publications#create/destroy` | Publish/unpublish |
| GET/PATCH | `/boards/:board_id/entropy` | `boards/entropies#show/update` | Auto-postpone config |
| GET | `/boards/:board_id/columns/not_now` | `boards/columns/not_nows#show` | Postponed cards |
| GET | `/boards/:board_id/columns/stream` | `boards/columns/streams#show` | Triage cards |
| GET | `/boards/:board_id/columns/closed` | `boards/columns/closeds#show` | Closed cards |
| CRUD | `/boards/:board_id/columns` | `boards/columns#*` | Column management |

### Board Cards & Webhooks
| Method | Path | Controller#Action |
|--------|------|-------------------|
| POST | `/boards/:board_id/cards` | `cards#create` |
| CRUD | `/boards/:board_id/webhooks` | `webhooks#*` |
| POST | `/boards/:board_id/webhooks/:webhook_id/activation` | `webhooks/activations#create` |

### Column Operations
| Method | Path | Controller#Action | Notes |
|--------|------|-------------------|-------|
| POST | `/columns/:column_id/left_position` | `columns/left_positions#create` | Move column left |
| POST | `/columns/:column_id/right_position` | `columns/right_positions#create` | Move column right |

### Column Card Drops (Drag and Drop)
| Method | Path | Controller#Action | Notes |
|--------|------|-------------------|-------|
| POST | `/columns/cards/:card_id/drops/not_now` | `columns/cards/drops/not_nows#create` | Drop to Not Now |
| POST | `/columns/cards/:card_id/drops/stream` | `columns/cards/drops/streams#create` | Drop to Triage |
| POST | `/columns/cards/:card_id/drops/closure` | `columns/cards/drops/closures#create` | Drop to Done |
| POST | `/columns/cards/:card_id/drops/column` | `columns/cards/drops/columns#create` | Drop to Column |

### Card Previews
| Method | Path | Controller#Action |
|--------|------|-------------------|
| GET | `/cards/previews/:id` | `cards/previews#show` |

### Cards
| Method | Path | Controller#Action |
|--------|------|-------------------|
| GET | `/cards` | `cards#index` |
| GET | `/cards/:id` | `cards#show` |
| GET | `/cards/:id/edit` | `cards#edit` |
| PATCH | `/cards/:id` | `cards#update` |
| DELETE | `/cards/:id` | `cards#destroy` |

### Card Sub-Resources (Actions as Resources)
| Method | Path | Controller#Action | Notes |
|--------|------|-------------------|-------|
| PATCH | `/cards/:card_id/board` | `cards/boards#update` | Move to board |
| POST/DELETE | `/cards/:card_id/closure` | `cards/closures#create/destroy` | Close/reopen |
| PATCH | `/cards/:card_id/column` | `cards/columns#update` | Triage to column |
| POST/DELETE | `/cards/:card_id/goldness` | `cards/goldnesses#create/destroy` | Gild/ungild |
| PATCH/DELETE | `/cards/:card_id/image` | `cards/images#update/destroy` | Card image |
| POST/DELETE | `/cards/:card_id/not_now` | `cards/not_nows#create/destroy` | Postpone/resume |
| POST/DELETE | `/cards/:card_id/pin` | `cards/pins#create/destroy` | Pin/unpin |
| POST | `/cards/:card_id/publish` | `cards/publishes#create` | Publish draft |
| POST | `/cards/:card_id/reading` | `cards/readings#create` | Mark as read |
| POST | `/cards/:card_id/triage` | `cards/triages#create` | Triage card |
| POST/DELETE | `/cards/:card_id/watch` | `cards/watches#create/destroy` | Watch/unwatch |
| CRUD | `/cards/:card_id/assignments` | `cards/assignments#*` | Manage assignments |
| CRUD | `/cards/:card_id/steps` | `cards/steps#*` | Manage steps |
| CRUD | `/cards/:card_id/taggings` | `cards/taggings#*` | Manage tags |
| CRUD | `/cards/:card_id/comments` | `cards/comments#*` | Comments |
| CRUD | `/cards/:card_id/comments/:comment_id/reactions` | `cards/comments/reactions#*` | Reactions |

### Tags
| Method | Path | Controller#Action |
|--------|------|-------------------|
| GET | `/tags` | `tags#index` |

### Notifications
| Method | Path | Controller#Action |
|--------|------|-------------------|
| GET | `/notifications` | `notifications#index` |
| GET | `/notifications/:id` | `notifications#show` |
| GET | `/notifications/tray` | `notifications/trays#show` |
| POST | `/notifications/:notification_id/reading` | `notifications/readings#create` |
| POST | `/notifications/bulk_reading` | `notifications/bulk_readings#create` |
| GET/PATCH | `/notifications/settings` | `notifications/settings#show/update` |
| DELETE | `/notifications/unsubscribe` | `notifications/unsubscribes#destroy` |

### Search
| Method | Path | Controller#Action |
|--------|------|-------------------|
| GET | `/search` | `searches#show` |
| CRUD | `/searches/queries` | `searches/queries#*` |

### Filters
| Method | Path | Controller#Action |
|--------|------|-------------------|
| GET | `/filters` | `filters#index` |
| GET | `/filters/:id` | `filters#show` |
| POST | `/filters` | `filters#create` |
| POST | `/filters/settings_refresh` | `filters/settings_refreshes#create` |

### Events (Activity Timeline)
| Method | Path | Controller#Action |
|--------|------|-------------------|
| GET | `/events` | `events#index` |
| GET | `/events/days/:id` | `events/days#show` |
| GET | `/events/day_timeline/columns/:id` | `events/day_timeline/columns#show` |

### Personal Area (/my)
| Method | Path | Controller#Action |
|--------|------|-------------------|
| GET | `/my/identity` | `my/identities#show` |
| CRUD | `/my/access_tokens` | `my/access_tokens#*` |
| GET | `/my/pins` | `my/pins#index` |
| PATCH | `/my/timezone` | `my/timezones#update` |
| GET | `/my/menu` | `my/menus#show` |

### Prompts (Autocomplete)
| Method | Path | Controller#Action |
|--------|------|-------------------|
| GET | `/prompts/cards` | `prompts/cards#index` |
| GET | `/prompts/tags` | `prompts/tags#index` |
| GET | `/prompts/users` | `prompts/users#index` |
| GET | `/prompts/boards` | `prompts/boards#index` |
| GET | `/prompts/boards/:board_id/users` | `prompts/boards/users#index` |

### Public (Published Boards)
| Method | Path | Controller#Action |
|--------|------|-------------------|
| GET | `/public/boards/:id` | `public/boards#show` |
| GET | `/public/boards/:board_id/cards/:id` | `public/cards#show` |
| GET | `/public/boards/:board_id/columns/:id` | `public/columns#show` |
| GET | `/public/boards/:board_id/columns/not_now` | `public/columns/not_nows#show` |
| GET | `/public/boards/:board_id/columns/stream` | `public/columns/streams#show` |
| GET | `/public/boards/:board_id/columns/closed` | `public/columns/closeds#show` |

### QR Codes
| Method | Path | Controller#Action |
|--------|------|-------------------|
| GET | `/qr_codes/:id` | `qr_codes#show` |

### PWA & Health
| Method | Path | Controller#Action |
|--------|------|-------------------|
| GET | `/up` | `rails/health#show` |
| GET | `/manifest` | `rails/pwa#manifest` |
| GET | `/service-worker` | `pwa#service_worker` |

### Admin
| Method | Path | Notes |
|--------|------|-------|
| GET | `/admin/jobs` | Mission Control::Jobs dashboard |

### Landing
| Method | Path | Controller#Action |
|--------|------|-------------------|
| GET | `/landing` | `landings#show` |

### Legacy Redirects
| Pattern | Redirects To |
|---------|-------------|
| `/collections/:collection_id/cards/:id` | `/cards/:id` |
| `/collections/:id` | `/boards/:id` |
| `/public/collections/:id` | `/public/boards/:id` |

---

## REST Resource Modeling Patterns

Fizzy follows a strict REST convention: **actions are modeled as resources**, not custom controller methods.

### Pattern: Action as Resource

Instead of:
```ruby
# BAD: Custom actions
resources :cards do
  post :close
  post :reopen
  post :postpone
end
```

Fizzy does:
```ruby
# GOOD: Actions are resources
resources :cards do
  resource :closure     # POST = close, DELETE = reopen
  resource :not_now     # POST = postpone, DELETE = resume
  resource :goldness    # POST = gild, DELETE = ungild
  resource :pin         # POST = pin, DELETE = unpin
  resource :watch       # POST = watch, DELETE = unwatch
  resource :publish     # POST = publish
  resource :reading     # POST = mark as read
  resource :triage      # POST = triage
end
```

### Pattern: Singular Resource for Toggle Actions

For actions that toggle a state, a singular resource is used:
- `POST /cards/:id/closure` = close (create the closure)
- `DELETE /cards/:id/closure` = reopen (destroy the closure)

This maps directly to the database: closing creates a `Closure` record, reopening destroys it.

### Pattern: Namespace for Drop Targets

Drag-and-drop targets use a namespace:
```ruby
namespace :drops do
  resource :not_now     # Drop to postpone
  resource :stream      # Drop to triage
  resource :closure     # Drop to close
  resource :column      # Drop to specific column
end
```

---

## Controller Concerns

### BoardScoped (`app/controllers/concerns/board_scoped.rb`)
```ruby
before_action :set_board

def set_board
  @board = Current.user.boards.find(params[:board_id])
end

def ensure_permission_to_admin_board
  head :forbidden unless Current.user.can_administer_board?(@board)
end
```

Used by: webhooks, columns, board sub-resource controllers.

### CardScoped (`app/controllers/concerns/card_scoped.rb`)
```ruby
before_action :set_card, :set_board

def set_card
  @card = Current.user.accessible_cards.find_by!(number: params[:card_id])
end

def set_board
  @board = @card.board
end
```

Also provides:
- `render_card_replacement` - Turbo Stream replace for card updates
- `capture_card_location` / `refresh_stream_if_needed` - Track card movement for UI updates

### FilterScoped (`app/controllers/concerns/filter_scoped.rb`)
```ruby
before_action :set_filter, :set_user_filtering

def set_filter
  @filter = if params[:filter_id].present?
    Current.user.filters.find(params[:filter_id])
  else
    Current.user.filters.from_params(filter_params)
  end
end
```

Also sets up `@user_filtering` for the filter UI.

---

## JSON Rendering (JBuilder)

28 JBuilder templates provide JSON responses for:
- Card data (for autocomplete, previews)
- Webhook event payloads
- Search results
- Filter data
- User data (for mentions, assignments)

Typical pattern:
```ruby
# app/views/cards/show.json.jbuilder
json.extract! @card, :id, :number, :title, :status, :due_on, :created_at, :updated_at
json.board_id @card.board_id
json.column_id @card.column_id
json.creator do
  json.extract! @card.creator, :id, :name
end
```

---

## Rate Limiting

| Controller | Limit | Period |
|-----------|-------|--------|
| `SessionsController#create` | 10 | 3 minutes |
| `Sessions::MagicLinksController#create` | 10 | 15 minutes |
| `SignupsController#create` | 10 | 3 minutes |
| `JoinCodesController#create` | 10 | 3 minutes |

Rate limiting uses Rails 8's built-in rate limiting mechanism (`rate_limit`).

---

## URL Resolution

Custom route resolvers for polymorphic URL generation:

```ruby
# Comment URLs anchor to the comment on the card page
resolve "Comment" do |comment, options|
  options[:anchor] = dom_id(comment)
  route_for :card, comment.card, options
end

# Mention URLs resolve to the source (card or comment)
resolve "Mention" do |mention, options|
  polymorphic_url(mention.source, options)
end

# Notification URLs resolve to the notifiable target
resolve "Notification" do |notification, options|
  polymorphic_url(notification.notifiable_target, options)
end

# Event URLs resolve to the eventable
resolve "Event" do |event, options|
  polymorphic_url(event.eventable, options)
end
```

---

## Convex Translation Notes

### Route Map → Convex Functions

In Convex, there are no routes in the Rails sense. Instead, you define:

1. **Queries** (read operations): Replace GET endpoints
2. **Mutations** (write operations): Replace POST/PATCH/DELETE endpoints
3. **HTTP Actions** (public endpoints): Replace public/webhook endpoints

### Function Organization

```
convex/
  auth/
    magicLinks.ts           # sendMagicLink, verifyCode
    sessions.ts             # createSession, destroySession
  boards/
    queries.ts              # list, get, getPublic
    mutations.ts            # create, update, delete, publish, unpublish
    columns.ts              # listColumns, createColumn, moveColumn
  cards/
    queries.ts              # list, get, getByNumber, search
    mutations.ts            # create, update, delete, publish
    lifecycle.ts            # close, reopen, postpone, resume, triage
    assignments.ts          # assign, unassign, toggleAssignment
    steps.ts                # createStep, updateStep, deleteStep
    tags.ts                 # addTag, removeTag, toggleTag
  comments/
    queries.ts              # listByCard
    mutations.ts            # create, update, delete
    reactions.ts            # addReaction, removeReaction
  notifications/
    queries.ts              # list, unreadCount, tray
    mutations.ts            # markRead, markAllRead
  events/
    queries.ts              # listByBoard, listByDay
  filters/
    queries.ts              # get, listCards
    mutations.ts            # create, remember
  search/
    queries.ts              # search (uses Convex search index)
  webhooks/
    mutations.ts            # create, update, delete, activate, deactivate
    http.ts                 # HTTP action for outbound delivery
  users/
    queries.ts              # list, get, me
    mutations.ts            # update, deactivate, changeRole
  accounts/
    queries.ts              # get, settings
    mutations.ts            # update, updateEntropy
  http.ts                   # Public API endpoints, webhook receivers
  crons.ts                  # Scheduled jobs (entropy, notification bundles)
  schema.ts                 # Full database schema
```

### Key API Differences

1. **No URL routing**: Clients call functions directly via `useQuery(api.cards.list)` or `useMutation(api.cards.create)`

2. **No REST conventions needed**: Actions don't need to be modeled as resources. A `closeCard` mutation is perfectly clear:
   ```typescript
   export const closeCard = mutation({
     args: { cardId: v.id("cards") },
     handler: async (ctx, { cardId }) => {
       // Create closure document, track event
     }
   });
   ```

3. **No JSON rendering templates**: Query return values ARE the API response. Type-safe by default.

4. **Rate limiting**: Convex has built-in rate limiting at the function level:
   ```typescript
   import { rateLimiter } from "convex-helpers/server/rateLimit";
   const limiter = rateLimiter(ctx, { name: "sendMagicLink", count: 10, period: 180_000 });
   ```

5. **Public endpoints**: For webhooks or public API access, use Convex HTTP actions:
   ```typescript
   // convex/http.ts
   import { httpRouter } from "convex/server";
   const http = httpRouter();
   http.route({
     path: "/api/public/boards/:key",
     method: "GET",
     handler: publicBoardHandler,
   });
   ```

6. **Pagination**: Convex has built-in cursor-based pagination:
   ```typescript
   export const listCards = query({
     args: { boardId: v.id("boards"), paginationOpts: paginationOptsValidator },
     handler: async (ctx, args) => {
       return ctx.db
         .query("cards")
         .withIndex("by_board", q => q.eq("boardId", args.boardId))
         .order("desc")
         .paginate(args.paginationOpts);
     }
   });
   ```

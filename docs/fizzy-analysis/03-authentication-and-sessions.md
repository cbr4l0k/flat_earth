# Authentication and Sessions

Fizzy uses **passwordless magic link authentication**. There are no passwords anywhere in the system. Users authenticate by receiving a 6-digit code via email that expires after 15 minutes.

## Key Entities

| Entity | Purpose | Tenant-Scoped? |
|--------|---------|----------------|
| **Identity** | Global user (email-based) | No |
| **User** | Account membership | Yes |
| **Session** | Active browser session | No (tied to Identity) |
| **MagicLink** | Authentication token | No (tied to Identity) |
| **AccessToken** | API bearer token | No (tied to Identity) |

## Key Files

| File | Purpose |
|------|---------|
| `app/controllers/concerns/authentication.rb` | Core auth logic (mixin) |
| `app/controllers/concerns/authentication/via_magic_link.rb` | Magic link flow |
| `app/controllers/sessions_controller.rb` | Login/logout |
| `app/controllers/sessions/magic_links_controller.rb` | Code verification |
| `app/controllers/signups_controller.rb` | New account signup |
| `app/controllers/signups/completions_controller.rb` | Account setup |
| `app/controllers/join_codes_controller.rb` | Invitation flow |
| `app/controllers/sessions/transfers_controller.rb` | Multi-account switching |
| `app/models/identity.rb` | Global user model |
| `app/models/magic_link.rb` | Magic link model |
| `app/models/session.rb` | Session model |
| `app/models/signup.rb` | Signup form object |

---

## Authentication Concern (`app/controllers/concerns/authentication.rb`)

This concern is included in `ApplicationController` and provides the authentication framework.

### Controller Macros

| Macro | Effect |
|-------|--------|
| `require_unauthenticated_access` | Skips auth, redirects if already authenticated |
| `allow_unauthenticated_access` | Tries session resume but allows anonymous access |
| `disallow_account_scope` | Skips account requirement (for tenant-agnostic pages) |

### Before Actions

1. `require_account` - Ensures `Current.account` is present (set by middleware)
2. `require_authentication` - Validates the user is logged in

### Authentication Methods

| Method | Purpose |
|--------|---------|
| `authenticated?` | Returns `Current.identity.present?` |
| `resume_session` | Reads signed cookie, sets `Current.session` |
| `find_session_by_cookie` | Finds Session by signed cookie value |
| `authenticate_by_bearer_token` | Handles `Authorization: Bearer <token>` for API |
| `start_new_session_for(identity)` | Creates Session record, sets signed cookie |
| `set_current_session(session)` | Sets `Current.session` + permanent signed cookie |
| `terminate_session` | Destroys session, deletes cookie |
| `request_authentication` | Redirects to login page |

### Session Storage

Sessions are stored as **signed cookies**:
```ruby
cookies.signed.permanent[:session_token] = {
  value: session.signed_id,
  httponly: true,
  same_site: :lax
}
```

The `signed_id` is Rails' built-in signed ID mechanism that prevents tampering.

---

## Sign Up Flow (New Account)

```
Step 1: User visits /signup
         ↓
Step 2: Enters email address
         → SignupsController#create
         → Signup.create_identity
         → Creates/finds Identity
         → Sends magic link (purpose: :sign_up)
         ↓
Step 3: Redirect to /session/magic_link (code entry page)
         → Sets pending_authentication_token cookie (encrypted email)
         ↓
Step 4: User receives email with 6-digit code
         (In development: code shown in flash message and X-Magic-Link-Code header)
         ↓
Step 5: Enters code
         → Sessions::MagicLinksController#create
         → MagicLink.consume(code) - finds active link, validates, destroys
         → Secure compare of email with pending_authentication_token
         → Creates new Session for the Identity
         → Clears pending_authentication_token cookie
         ↓
Step 6: Redirect to /signup/completion/new (account setup)
         → User enters their full name
         ↓
Step 7: Submit name
         → Signups::CompletionsController#create
         → Signup#complete:
           1. Creates Account
           2. Creates User (role: owner)
           3. Sets up default kanban template (columns, sample cards)
         → Redirects to account dashboard /{account_id}/
```

### Sequence Diagram

```
Browser              Server              Email Service
  |                    |                       |
  |--- GET /signup --->|                       |
  |<-- signup form ----|                       |
  |                    |                       |
  |--- POST /signup -->|                       |
  |    {email}         |                       |
  |                    |-- create Identity ---->|
  |                    |-- create MagicLink --->|
  |                    |-- send email --------->|
  |                    |                       |-- deliver 6-digit code -->
  |<-- redirect to ----|                       |
  |    /magic_link     |                       |
  |    + set cookies:  |                       |
  |    pending_auth_   |                       |
  |    token           |                       |
  |                    |                       |
  |--- POST /magic  -->|                       |
  |    link {code}     |                       |
  |                    |-- consume magic link ->|
  |                    |-- verify email match ->|
  |                    |-- create Session ----->|
  |<-- redirect to ----|                       |
  |    /completion     |                       |
  |    + set cookie:   |                       |
  |    session_token   |                       |
  |                    |                       |
  |--- POST /complete->|                       |
  |    {full_name}     |                       |
  |                    |-- create Account ----->|
  |                    |-- create User (owner)->|
  |                    |-- seed template ------>|
  |<-- redirect to ----|                       |
  |    /{account_id}/  |                       |
```

---

## Sign In Flow (Existing User)

```
Step 1: User visits /session/new (login page)
         ↓
Step 2: Enters email address
         → SessionsController#create
         → Finds existing Identity
         → Sends magic link (purpose: :sign_in)
         ↓
Step 3: Redirect to /session/magic_link
         → Sets pending_authentication_token cookie
         ↓
Step 4: User receives email with 6-digit code
         ↓
Step 5: Enters code
         → Sessions::MagicLinksController#create
         → MagicLink.consume(code) validates and destroys
         → Creates new Session
         ↓
Step 6: Redirect to after_authentication_url
         → Account dashboard or return_to URL
```

### Sequence Diagram

```
Browser              Server              Email Service
  |                    |                       |
  |--- GET /session -->|                       |
  |    /new            |                       |
  |<-- login form -----|                       |
  |                    |                       |
  |--- POST /session ->|                       |
  |    {email}         |                       |
  |                    |-- find Identity ------>|
  |                    |-- create MagicLink --->|
  |                    |-- send email --------->|
  |<-- redirect -------|                       |
  |                    |                       |
  |--- POST /magic  -->|                       |
  |    link {code}     |                       |
  |                    |-- consume + verify --->|
  |                    |-- create Session ----->|
  |<-- redirect to ----|                       |
  |    dashboard       |                       |
```

### Unknown Email Handling

If the email doesn't match any Identity and signups are disabled:
- A "fake" magic link redirect is performed (no actual magic link created)
- The user sees the code entry form but any code they enter will fail
- This prevents email enumeration attacks

---

## Join Code Flow (Invitation)

```
Step 1: User receives invite link: /join/{code}
         ↓
Step 2: JoinCodesController#new shows form
         ↓
Step 3: User enters email
         → JoinCodesController#create
         → Finds or creates Identity
         → Redeems join code (adds Identity as User to Account)
         ↓
Step 4a: If same email as current session:
          → Redirect to verification page

Step 4b: If different email (or no session):
          → Terminate current session
          → Send magic link to new email
          → Redirect to magic link verification
          → After verification, lands in new account
```

### Join Code Model (`Account::JoinCode`)
- Has `code` (string), `usage_count`, `usage_limit` (default: 10)
- Unique per `(account_id, code)`
- Can be regenerated by admins

---

## Multi-Account Transfer Flow

Users with an Identity that has Users in multiple Accounts can switch between them.

```
Step 1: User is logged into Account A
         ↓
Step 2: Clicks "switch account" in session menu
         → Identity generates signed transfer_id (4-hour expiry)
         ↓
Step 3: Sessions::TransfersController#update
         → Decodes signed transfer_id
         → Creates new Session for that Identity
         → Redirects to session menu (account picker)
         ↓
Step 4: User selects Account B
         → Redirects to /{account_b_id}/
```

### Transfer ID
Generated via Rails' `signed_id` with 4-hour expiration:
```ruby
# Identity::Transferable
def transfer_id
  signed_id(expires_in: 4.hours)
end
```

---

## API Authentication (Bearer Token)

For programmatic access, Fizzy supports bearer token authentication.

### Token Model (`Identity::AccessToken`)
- `has_secure_token :token` - Cryptographic random token
- `permission` enum: `:read` or `:write`
- `allows?(method)` - Returns true if:
  - Method is GET/HEAD (always allowed for read tokens)
  - Token has write permission

### Authentication Flow
```
HTTP Request:
  Authorization: Bearer <token>
         ↓
Authentication concern:
  → authenticate_by_bearer_token
  → Identity.find_by_permissable_access_token(token, method: request.method)
  → Sets Current.session (synthetic) and Current.identity
```

Tokens are managed at `/my/access_tokens` in the user's personal settings.

---

## Magic Link Model (`app/models/magic_link.rb`)

| Attribute | Type | Details |
|-----------|------|---------|
| `code` | string | 6-digit auto-generated, unique |
| `purpose` | enum | `:sign_in` (0), `:sign_up` (1) |
| `expires_at` | datetime | 15 minutes from creation |
| `identity_id` | uuid | FK to identity |

**Scopes:**
- `active` - Not yet expired (`expires_at > now`)
- `stale` - Expired

**Key Methods:**
- `MagicLink.consume(code)` - Finds active link by code, destroys it, returns the link
- Auto-generates unique 6-digit code on creation
- Auto-sets 15-minute expiration

**Cleanup:** A recurring job (`cleanup_magic_links`) runs every 4 hours to delete stale links.

---

## Pending Authentication Token

During the magic link flow, the email address is stored in an encrypted cookie:

```ruby
# Authentication::ViaMagicLink
def set_pending_authentication_token(magic_link)
  cookies.encrypted[:email_address_pending_authentication] = {
    value: magic_link.identity.email_address,
    expires: magic_link.expires_at,
    httponly: true,
    same_site: :lax
  }
end
```

This cookie is used during code verification to ensure the code matches the intended email address (preventing code-swap attacks).

---

## Session Model (`app/models/session.rb`)

| Attribute | Type | Details |
|-----------|------|---------|
| `identity_id` | uuid | FK to identity |
| `user_agent` | string(4096) | Browser user agent |
| `ip_address` | string | Client IP |

Sessions use Rails' `signed_id` for secure cookie storage. The session record stores the browser context for audit purposes.

---

## Rate Limiting

| Endpoint | Limit | Period |
|----------|-------|--------|
| `SessionsController#create` | 10 | 3 minutes |
| `Sessions::MagicLinksController#create` | 10 | 15 minutes |
| `SignupsController#create` | 10 | 3 minutes |
| `JoinCodesController#create` | 10 | 3 minutes |

---

## Security Properties

1. **No passwords**: Eliminates password-related attacks (brute force, credential stuffing, password reuse)
2. **Short-lived tokens**: Magic links expire in 15 minutes
3. **Signed cookies**: Session tokens are cryptographically signed (httponly, same_site: lax)
4. **Encrypted pending token**: Email verification uses encrypted (not just signed) cookies
5. **Secure comparison**: Email matching uses `ActiveSupport::SecurityUtils.secure_compare`
6. **Rate limiting**: All sensitive endpoints have request rate limits
7. **Development safety**: Magic link codes only exposed in development (via flash + header)
8. **Transfer expiry**: Multi-account transfer IDs expire after 4 hours

---

## Convex Translation Notes

### Auth Strategy

In Convex, you'd typically use an auth provider rather than implementing magic links from scratch:

1. **Clerk integration** (recommended): Clerk provides passwordless auth (magic links, email OTP) out of the box. Convex has built-in Clerk integration:
   ```typescript
   // convex/auth.config.ts
   export default {
     providers: [{ domain: "https://your-clerk-domain.clerk.accounts.dev" }]
   };
   ```

2. **Custom magic links**: If you want to replicate the exact flow, implement it as Convex mutations:
   ```typescript
   // convex/auth/magicLinks.ts
   export const sendMagicLink = mutation({
     args: { email: v.string() },
     handler: async (ctx, { email }) => {
       const code = generateSixDigitCode();
       await ctx.db.insert("magicLinks", {
         email,
         code,
         expiresAt: Date.now() + 15 * 60 * 1000,
       });
       // Use Convex action to send email
       await ctx.scheduler.runAfter(0, api.email.sendMagicLink, { email, code });
     }
   });
   ```

### Identity vs User

The Identity/User split maps well to Convex + Clerk:
- **Identity** = Clerk User (global, email-based)
- **User** = A document in your `users` table with `clerkId` + `accountId`
- When a user logs in, look up their User document for the current account

### Session Management

Convex doesn't need explicit session management. Clerk handles session tokens and Convex validates them automatically via `ctx.auth.getUserIdentity()`.

### Bearer Tokens for API

For API access, you'd either:
- Use Clerk API tokens
- Create a custom `accessTokens` table and validate tokens in Convex HTTP actions

### Multi-Account Switching

Instead of transfer IDs, the frontend would simply switch the active `accountId` in client state. The Clerk session remains valid across accounts since Identity is global.

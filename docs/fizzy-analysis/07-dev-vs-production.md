# Development vs Production

This document covers environment-specific configuration, Docker setup, deployment, CI pipeline, background jobs, and dependencies.

---

## Environment Configuration Differences

### Development (`config/environments/development.rb`)

| Setting | Value |
|---------|-------|
| Code reloading | Enabled |
| Eager loading | Disabled |
| Error reports | Full (detailed errors) |
| Server timing | Enabled |
| Cache store | `:memory_store` or `:null_store` (toggle via `tmp/caching-dev.txt`) |
| Active Storage | Local disk or MinIO (toggle via `tmp/minio-dev.txt`) |
| Email delivery | Letter Opener (toggle via `tmp/email-dev.txt`) |
| Allowed hosts | `fizzy.localhost`, `localhost`, `127.0.0.1`, `fizzy-*`, `*.ts.net` |
| Default mailer URL | `http://fizzy.localhost:3006` |
| Background jobs | In-process or separate (controlled by `SOLID_QUEUE_IN_PUMA`) |
| Magic link codes | Shown in flash message and `X-Magic-Link-Code` header |

### Production (`config/environments/production.rb`)

| Setting | Value |
|---------|-------|
| Code reloading | Disabled |
| Eager loading | Enabled |
| Error reports | Non-local only |
| Cache store | `:solid_cache_store` (database-backed) |
| Active Storage | Configurable via `ACTIVE_STORAGE_SERVICE` env var (default: `local`) |
| Email delivery | SMTP (configured via env vars) |
| SSL | Enabled by default (`ASSUME_SSL=true`, `FORCE_SSL=true` unless `DISABLE_SSL=true`) |
| Logging | STDOUT with request ID tagging |
| Background jobs | Solid Queue (database-backed) |
| Public file server | Enabled with 1-year cache headers |
| Base URL | Configured via `BASE_URL` env var |

### Key Environment Variables (Production)

| Variable | Purpose |
|----------|---------|
| `SECRET_KEY_BASE` | Rails secret key |
| `BASE_URL` | Application base URL |
| `MULTI_TENANT` | "true" for multi-tenant mode |
| `ACTIVE_STORAGE_SERVICE` | Storage backend (default: "local") |
| `SMTP_ADDRESS` | Mail server hostname |
| `SMTP_PORT` | Mail server port |
| `SMTP_DOMAIN` | HELO domain |
| `SMTP_USERNAME` | SMTP auth username |
| `SMTP_PASSWORD` | SMTP auth password |
| `SMTP_AUTHENTICATION` | Auth method |
| `SMTP_TLS` | Enable TLS |
| `SMTP_SSL_VERIFY_MODE` | SSL verification mode |
| `MAILER_FROM_ADDRESS` | Sender email address |
| `VAPID_PUBLIC_KEY` | Web push public key |
| `VAPID_PRIVATE_KEY` | Web push private key |
| `SOLID_QUEUE_IN_PUMA` | "true" to run jobs in app process |
| `DISABLE_SSL` | "true" to disable SSL enforcement |

---

## Docker Setup

### Production Dockerfile (`Dockerfile`)

Multi-stage build optimized for production:

```
Stage 1: base
  - Ruby 3.4.7 (slim image)
  - Working directory: /rails
  - Packages: curl, libjemalloc2, libvips, sqlite3, libssl-dev
  - Jemalloc enabled for memory optimization

Stage 2: build
  - Build tools: build-essential, git, libyaml-dev, pkg-config
  - Bundle install (deployment mode, no dev/test groups)
  - Bootsnap precompilation
  - Asset precompilation (with dummy SECRET_KEY_BASE)

Stage 3: final
  - Non-root user: rails (UID 1000, GID 1000)
  - Port: 80
  - Entrypoint: /rails/bin/docker-entrypoint
  - Command: ./bin/thrust ./bin/rails server
```

Note: `thrust` is the Thruster reverse proxy that handles SSL termination and static file serving.

### Development Docker Compose (`docker-compose.yml`)

```yaml
service: fizzy-dev
  build: Dockerfile.dev
  ports: 3006:3006
  volumes:
    - .:rails (source code mount)
    - bundle cache volume
    - external storage volume
  environment:
    - RAILS_ENV=development
    - SOLID_QUEUE_IN_PUMA=false
  startup:
    1. bundle install
    2. rm -f tmp/pids/server.pid
    3. bin/rails db:prepare
    4. bin/rails db:seed
    5. bin/rails server -b 0.0.0.0 -p 3006
```

The development container mounts the source code for live reloading and uses an external volume for persistent storage.

---

## Deployment (Kamal)

### Configuration (`config/deploy.yml`)

| Setting | Value |
|---------|-------|
| Service name | `fizzy` |
| Image name | `fizzy` |
| Primary server | `fizzy.example.com` |
| SSH user | `root` |
| SSL | Enabled by default |
| Architecture | `amd64` |

### Secrets Management
Secrets loaded from `.kamal/secrets` (typically 1Password CLI):
- `SECRET_KEY_BASE`
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`
- `SMTP_USERNAME` / `SMTP_PASSWORD`

### Persistent Storage
```yaml
volumes:
  - fizzy_storage:/rails/storage
```
SQLite databases and Active Storage files persist in this volume.

### Asset Bridging
```yaml
asset_path: /rails/public/assets
# Fingerprinted assets bridged between deployments
```

### Local Registry
Uses a local Docker registry at `localhost:5555` for image storage.

### Deployment Aliases
| Alias | Command |
|-------|---------|
| `console` | Rails console |
| `shell` | Interactive bash |
| `logs` | Follow application logs |
| `dbc` | Database console |

---

## CI Pipeline (`bin/ci`)

The CI script runs these checks in order:

| Step | Tool | Purpose |
|------|------|---------|
| 1 | Rubocop | Code style enforcement (Rails Omakase style) |
| 2 | bundler-audit | Gem vulnerability scanning |
| 3 | importmap:audit | JavaScript dependency vulnerability scanning |
| 4 | Brakeman | Static security analysis for Rails |
| 5 | `bin/rails test` | Application unit/integration tests |
| 6 | `bin/rails test:system` | System tests (Capybara + Selenium) |

### Test Framework
- **Unit/Integration**: Minitest (Rails default)
- **System tests**: Capybara with Selenium WebDriver
- **Mocking**: Mocha
- **HTTP mocking**: WebMock + VCR
- **Fixtures**: Rails fixtures with deterministic UUID generation
- **Parallel testing**: Supported (`PARALLEL_WORKERS=1` for serial execution)

---

## Background Jobs (Solid Queue)

### Adapter
Database-backed job queue using Solid Queue. No Redis or external message broker required.

### Configuration Options
- `SOLID_QUEUE_IN_PUMA=true`: Jobs run in the Puma app process (simpler deployment)
- `SOLID_QUEUE_IN_PUMA=false`: Jobs run in a separate process (via `bin/jobs`)

### Recurring Jobs (`config/recurring.yml`)

| Job | Schedule | Purpose |
|-----|----------|---------|
| `deliver_bundled_notifications` | Every 30 minutes | `Notification::Bundle::DeliverAllJob` |
| `auto_postpone_all_due` | Every hour (minute 50) | `Card.auto_postpone_all_due` (entropy) |
| `delete_unused_tags` | Daily at 04:02 | `DeleteUnusedTagsJob` |
| `clear_solid_queue_finished_jobs` | Every hour (minute 12) | Solid Queue maintenance |
| `cleanup_webhook_deliveries` | Every 4 hours (minute 51) | `Webhook::Delivery.cleanup` |
| `cleanup_magic_links` | Every 4 hours | Remove expired magic links |
| `cleanup_exports` | Every hour (minute 20) | Remove completed/stale exports |

### Job Queue Routing

| Queue | Jobs |
|-------|------|
| default | Most jobs (notifications, mentions, activity spikes) |
| `backend` | Exports, storage materialization/reconciliation, notification bundle delivery |
| `webhooks` | Webhook dispatch and delivery |

### Job Classes (16 total)

| Job | Purpose |
|-----|---------|
| `ApplicationJob` | Base class |
| `Board::CleanInaccessibleDataJob` | Remove user data when board access revoked |
| `Card::ActivitySpike::DetectionJob` | Detect activity spikes on cards |
| `Card::RemoveInaccessibleNotificationsJob` | Cleanup notifications after access changes |
| `DeleteUnusedTagsJob` | Remove orphan tags |
| `Event::WebhookDispatchJob` | Find and trigger matching webhooks for events |
| `ExportAccountDataJob` | Generate account data ZIP export |
| `Mention::CreateJob` | Create mention records from rich text scan |
| `Notification::Bundle::DeliverAllJob` | Find and deliver due notification bundles |
| `Notification::Bundle::DeliverJob` | Deliver a single notification bundle email |
| `NotifyRecipientsJob` | Create notification records for an event/mention |
| `PushNotificationJob` | Send web push notification |
| `Storage::MaterializeJob` | Compute storage totals from entries |
| `Storage::ReconcileJob` | Ensure storage totals consistency |
| `Webhook::DeliveryJob` | Perform HTTP webhook delivery |

### SMTP Error Handling (`SmtpDeliveryErrorHandling` concern)
- Retries on network timeouts and temporary SMTP errors (4xx)
- Discards permanently undeliverable emails (550 unknown user, 552 too large)
- Polynomial backoff for retries

---

## Gemfile Dependencies

### Core
| Gem | Purpose |
|-----|---------|
| `rails` (main branch) | Framework |
| `puma` | Web server |
| `trilogy` | MySQL adapter |
| `sqlite3` | SQLite adapter |
| `solid_queue` | Background jobs |
| `solid_cable` | WebSocket adapter |
| `solid_cache` | Cache store |
| `bootsnap` | Boot optimization |

### Frontend
| Gem | Purpose |
|-----|---------|
| `turbo-rails` | Turbo (SPA-like navigation) |
| `stimulus-rails` | Stimulus (JS controllers) |
| `importmap-rails` | JS module loading (no Node.js) |
| `propshaft` | Asset pipeline |

### Features
| Gem | Purpose |
|-----|---------|
| `bcrypt` | Token hashing |
| `jbuilder` | JSON rendering |
| `geared_pagination` | Pagination |
| `rqrcode` | QR code generation |
| `redcarpet` | Markdown rendering |
| `rouge` | Syntax highlighting |
| `lexxy` | Custom lexing (Basecamp internal) |
| `image_processing` | Image variants (libvips) |
| `aws-sdk-s3` | S3 storage (Active Storage) |
| `web-push` | VAPID web push notifications |
| `rubyzip` | ZIP file creation (exports) |
| `platform_agent` | Platform detection |
| `useragent` | User agent parsing |
| `mittens` | Unknown (Basecamp internal) |
| `net-http-persistent` | Persistent HTTP connections |

### Operations
| Gem | Purpose |
|-----|---------|
| `kamal` | Docker deployment |
| `thruster` | Reverse proxy |
| `autotuner` | GC tuning |
| `mission_control-jobs` | Job monitoring dashboard |

### Development/Test
| Gem | Purpose |
|-----|---------|
| `brakeman` | Security scanner |
| `bundler-audit` | Gem vulnerability scanner |
| `debug` | Debugger |
| `faker` | Test data generation |
| `letter_opener` | Email preview in browser |
| `rack-mini-profiler` | Performance profiling |
| `rubocop-rails-omakase` | Style checking |
| `capybara` | Browser testing |
| `selenium-webdriver` | Browser automation |
| `webmock` | HTTP mocking |
| `vcr` | HTTP recording/playback |
| `mocha` | Mocking/stubbing |

---

## Development Commands

```bash
bin/setup              # Initial setup (installs gems, creates DB, loads schema)
bin/dev                # Start development server (runs on port 3006)
bin/rails test         # Run unit tests
bin/rails test:system  # Run system tests
bin/ci                 # Run full CI suite
bin/rails db:reset     # Drop, create, load schema
bin/rails db:fixtures:load  # Load fixture data
bin/jobs               # Manage Solid Queue jobs
bin/kamal deploy       # Deploy via Kamal
```

Development URL: `http://fizzy.localhost:3006`
Login: `david@example.com` (magic link code shown in browser console/flash)

---

## Convex Translation Notes

### Environment Separation

In a Convex project, environment separation is simpler:
- **Development**: `npx convex dev` runs a local Convex backend
- **Production**: `npx convex deploy` pushes to Convex cloud
- **Environment variables**: Convex dashboard manages env vars per deployment

### No Docker Needed

Convex eliminates most infrastructure concerns:
- No Docker containers for the backend
- No database setup (Convex manages it)
- No background job infrastructure (built-in scheduled functions)
- No WebSocket infrastructure (built-in real-time)
- Frontend deploys to Vercel/Netlify (static hosting)

### CI Pipeline Equivalent

| Fizzy CI Step | Convex Equivalent |
|---------------|-------------------|
| Rubocop | ESLint + Prettier |
| bundler-audit | `npm audit` |
| Brakeman | N/A (Convex handles server security) |
| Unit tests | Vitest with Convex test helpers |
| System tests | Playwright or Cypress |

### Background Jobs

| Fizzy Job | Convex Equivalent |
|-----------|-------------------|
| Solid Queue recurring job | `crons.interval()` or `crons.cron()` |
| One-off async job | `ctx.scheduler.runAfter()` |
| Queue routing (default/backend/webhooks) | Not needed (Convex manages execution) |
| Job monitoring (Mission Control) | Convex dashboard |

### Dependencies

The TypeScript equivalent stack would be significantly leaner:
```json
{
  "dependencies": {
    "convex": "latest",
    "react": "^18",
    "next": "^14",
    "@clerk/nextjs": "latest",
    "@tiptap/react": "latest",
    "zod": "latest"
  }
}
```

Most of the Ruby gem functionality (pagination, search, real-time, jobs, caching) is built into Convex or handled by standard React patterns.

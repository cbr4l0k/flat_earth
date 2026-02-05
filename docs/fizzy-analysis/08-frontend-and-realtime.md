# Frontend and Real-Time

Fizzy's frontend is built entirely with Hotwired (Turbo + Stimulus) - a server-rendered approach that delivers SPA-like interactivity without client-side JavaScript frameworks.

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Navigation | Turbo Drive (intercepts link clicks, replaces body) |
| Partial updates | Turbo Frames (scoped page regions) |
| Real-time pushes | Turbo Streams (server-pushed DOM mutations) |
| Interactivity | Stimulus (lightweight JS controllers) |
| WebSocket | Action Cable via Solid Cable (database-backed) |
| Module loading | Importmap (no Node.js, no bundler) |
| Asset pipeline | Propshaft (simple file serving, no compilation) |
| Rich text editing | Action Text (Trix editor) |
| Markdown rendering | Redcarpet + Rouge (server-side) |
| Syntax highlighting | Marked (client-side) + Rouge (server-side) |

---

## Turbo

### Turbo Drive
- Intercepts all link clicks and form submissions
- Replaces page body without full page reload
- Maintains scroll position and form state
- Provides SPA-like navigation with server rendering

### Turbo Frames
Used for partial page updates:
- Card detail panels (load card content in a frame)
- Column card lists (paginated, frame-scoped)
- Settings panels
- Modal dialogs
- Notification tray

### Turbo Streams
Server-pushed DOM mutations via WebSocket:
- `broadcasts_refreshes` on Card model (auto-refresh on changes)
- Real-time notification count updates
- Pin tray updates when pinned cards change
- Board column updates on card movements

### Turbo Stream Actions Used
| Action | Purpose |
|--------|---------|
| `replace` | Update existing element |
| `refresh` | Trigger page refresh via morphing |
| `morph` | Smooth DOM morphing for updates |

---

## Stimulus Controllers (56 total)

### Navigation & UI

| Controller | Purpose |
|-----------|---------|
| `turbo_navigation_controller` | Enhanced Turbo navigation behaviors |
| `navigable_list_controller` | Keyboard-navigable lists |
| `nav_section_expander_controller` | Expand/collapse navigation sections |
| `hotkey_controller` | Global keyboard shortcuts |
| `card_hotkeys_controller` | Card-specific keyboard shortcuts |
| `dialog_controller` | Modal dialog management |
| `dialog_manager_controller` | Multi-dialog coordination |
| `details_controller` | Expand/collapse details elements |
| `collapsible_columns_controller` | Board column collapse/expand |
| `lightbox_controller` | Image lightbox/preview |
| `tooltip_controller` | Hover tooltips |
| `theme_controller` | Dark/light theme switching |

### Forms & Input

| Controller | Purpose |
|-----------|---------|
| `auto_save_controller` | Auto-save forms on change |
| `outlet_auto_save_controller` | Auto-save with Stimulus outlets |
| `auto_submit_controller` | Auto-submit forms on change |
| `autoresize_controller` | Auto-resize textareas |
| `form_controller` | Enhanced form behaviors |
| `combobox_controller` | Autocomplete/combobox inputs |
| `multi_selection_combobox_controller` | Multi-select combobox |
| `filter_controller` | Search filter input |
| `filter_form_controller` | Filter form management |
| `filter_settings_controller` | Filter settings panel |
| `local_save_controller` | Save to localStorage |
| `soft_keyboard_controller` | Mobile keyboard management |
| `upload_preview_controller` | File upload preview |

### Drag and Drop

| Controller | Purpose |
|-----------|---------|
| `drag_and_drop_controller` | Card drag between columns |
| `drag_and_strum_controller` | Strumming gesture for mobile |

### Real-Time & Data

| Controller | Purpose |
|-----------|---------|
| `beacon_controller` | Analytics/tracking beacons |
| `fetch_on_visible_controller` | Lazy-load content on visibility |
| `frame_controller` | Enhanced Turbo Frame behaviors |
| `frame_reloader_controller` | Periodic frame reloading |
| `pagination_controller` | Infinite scroll / pagination |
| `notifications_controller` | Notification management |
| `notifications_tray_controller` | Notification tray UI |

### Visual & Layout

| Controller | Purpose |
|-----------|---------|
| `badge_controller` | Notification badges |
| `bar_controller` | Global top bar |
| `bubble_controller` | Chat/notification bubbles |
| `css_variable_counter_controller` | Dynamic CSS variable counting |
| `knob_controller` | Entropy/settings knobs |
| `toggle_class_controller` | CSS class toggling |
| `toggle_enable_controller` | Enable/disable element toggling |
| `related_element_controller` | Show/hide related elements |

### Utility

| Controller | Purpose |
|-----------|---------|
| `auto_click_controller` | Programmatic click triggers |
| `clicker_controller` | Click delegation |
| `copy_to_clipboard_controller` | Copy text to clipboard |
| `element_removal_controller` | Remove DOM elements |
| `retarget_links_controller` | Redirect link targets |
| `local_time_controller` | Localize timestamps |
| `timezone_cookie_controller` | Set timezone cookie |
| `syntax_highlight_controller` | Code syntax highlighting |

### Authentication

| Controller | Purpose |
|-----------|---------|
| `magic_link_controller` | Magic link code input |

### Reactions

| Controller | Purpose |
|-----------|---------|
| `reaction_delete_controller` | Remove emoji reactions |
| `reaction_emoji_controller` | Emoji reaction picker |

### Assignment

| Controller | Purpose |
|-----------|---------|
| `assignment_limit_controller` | Enforce 100-assignee limit in UI |

---

## Action Cable (WebSocket)

### Adapter: Solid Cable
- Database-backed (SQLite in development, can be separate DB in production)
- Polling interval: 0.1 seconds
- Message retention: 1 day
- No Redis dependency

### Configuration (`config/cable.yml`)
```yaml
production:
  adapter: solid_cable
  connects_to:
    database:
      writing: cable
      reading: cable
  polling_interval: 0.1.seconds
  message_retention: 1.day
```

### Channel Usage
Action Cable is used for:
1. **Turbo Streams**: Broadcasting card/board changes to connected clients
2. **Notification counts**: Real-time unread notification badge updates
3. **Pin tray updates**: Refreshing pinned card previews

### Account-Aware WebSocket URL
```ruby
# Tenanting helper ensures WebSocket connects through account prefix
def tenanted_action_cable_meta_tag
  tag "meta",
      name: "action-cable-url",
      content: "#{request.script_name}#{ActionCable.server.config.mount_path}"
end
```

---

## Importmap (No Node.js)

### Configuration (`config/importmap.rb`)

JavaScript modules are loaded directly in the browser via import maps. No build step, no bundler, no Node.js.

**Pinned packages:**
| Package | Version | Purpose |
|---------|---------|---------|
| `@hotwired/turbo-rails` | bundled | Turbo Drive/Frames/Streams |
| `@hotwired/stimulus` | bundled | Stimulus framework |
| `@hotwired/stimulus-loading` | bundled | Lazy loading controllers |
| `@rails/request.js` | 0.0.13 | Fetch wrapper for Rails |
| `marked` | 15.0.11 | Markdown parsing (client-side) |
| `lexxy` | custom | Custom lexing (Basecamp internal) |
| `@rails/activestorage` | bundled | File upload support |
| `@rails/actiontext` | bundled | Rich text editor support |

**Auto-pinned directories:**
- `app/javascript/controllers` → `controllers/*`
- `app/javascript/helpers` → `helpers/*`
- `app/javascript/initializers` → `initializers/*`

---

## Asset Pipeline (Propshaft)

Propshaft is a simple asset pipeline that:
- Serves static files from `app/assets/` and vendor directories
- Fingerprints assets for cache busting
- No compilation (CSS, JS served as-is)
- No Sass/SCSS compilation
- No JavaScript bundling

---

## View Templates (345 total)

### Template Breakdown
| Type | Count | Format |
|------|-------|--------|
| ERB (HTML) | ~280 | `.html.erb` |
| ERB (Turbo Stream) | ~25 | `.turbo_stream.erb` |
| ERB (Text) | ~5 | `.text.erb` |
| ERB (Mailer HTML) | ~6 | `.html.erb` in mailer views |
| JBuilder (JSON) | 28 | `.json.jbuilder` |
| JavaScript | 1 | `service_worker.js` |

### Key View Directories

| Directory | Templates | Purpose |
|-----------|-----------|---------|
| `cards/` | ~50 | Card display (mini, preview, full, public) |
| `boards/` | ~30 | Board management, columns, publications |
| `columns/` | ~15 | Column operations, card drops |
| `events/` | ~15 | Activity timeline, day view |
| `filters/` | ~20 | Filter UI, settings, criteria |
| `notifications/` | ~15 | Notification index, tray, settings |
| `my/` | ~20 | Personal area (pins, tokens, menu) |
| `sessions/` | ~10 | Login, magic link, transfers |
| `users/` | ~15 | Profile, settings, avatar |
| `webhooks/` | ~10 | Webhook CRUD, delivery logs |
| `public/` | ~15 | Published board views |
| `layouts/` | ~10 | Application layouts, shared components |
| `mailers/` | ~10 | Email templates |
| `prompts/` | ~10 | Autocomplete/command palette |

### Partial Naming Patterns
- `_card.html.erb` - Card display partial
- `_mini.html.erb` - Compact card view
- `_preview.html.erb` - Card preview (for pins, search results)
- `_container.html.erb` - Turbo Stream replaceable container
- `_form.html.erb` - Form partial
- `_header.html.erb` - Section header

### Turbo Stream Templates
Turbo Stream templates (`.turbo_stream.erb`) define real-time DOM updates:
- `create.turbo_stream.erb` - Insert new element
- `update.turbo_stream.erb` - Replace existing element
- `destroy.turbo_stream.erb` - Remove element

---

## JSON Rendering (JBuilder)

28 JBuilder templates for JSON API responses:

### Card JSON
```ruby
# cards/show.json.jbuilder (typical structure)
json.id @card.id
json.number @card.number
json.title @card.title
json.status @card.status
json.board_id @card.board_id
json.column_id @card.column_id
json.creator_id @card.creator_id
json.due_on @card.due_on
json.created_at @card.created_at
json.updated_at @card.updated_at
```

### Webhook Event JSON
```ruby
# webhooks/event.json.jbuilder
json.event do
  json.action @event.action
  json.created_at @event.created_at
  json.card do
    json.id @event.card.id
    json.title @event.card.title
    json.number @event.card.number
    # ...
  end
end
```

---

## Progressive Web App (PWA)

- `manifest.json` - PWA manifest for installability
- `service_worker.js` - Service worker for offline support
- Routes: `GET /manifest`, `GET /service-worker`

---

## Real-Time Update Flow

```
1. User A moves card to "Done" column
   → Cards::ClosuresController#create
   → card.close(user: Current.user)
   → Creates Closure record
   → Card touched (updated_at changes)
   → broadcasts_refreshes triggers Turbo Stream
                    |
2. Action Cable broadcasts to card's channel
   → Turbo Stream: replace card partial
                    |
3. All connected clients (User B, C, etc.)
   → Receive WebSocket message
   → Turbo morphs the card element in the DOM
   → Card appears in "Done" column instantly

4. Simultaneously:
   → Event created (card_closed)
   → Notification created for watchers
   → Notification count broadcast to each watcher
   → Webhook dispatched (if configured)
```

---

## Convex Translation Notes

### Frontend Stack Replacement

| Fizzy (Server-Rendered) | Convex (Client-Rendered) |
|-------------------------|--------------------------|
| ERB templates | React/Next.js components |
| Turbo Drive | Next.js router / React Router |
| Turbo Frames | React component lazy loading |
| Turbo Streams | Convex `useQuery()` real-time subscriptions |
| Stimulus controllers | React hooks + event handlers |
| Action Cable | Convex WebSocket (built-in) |
| Action Text (Trix) | TipTap or Slate.js |
| Importmap | Vite or Next.js bundler |
| Propshaft | Vite or Next.js static serving |
| JBuilder (JSON) | Convex query return types |

### Real-Time Implementation

Convex's real-time is fundamentally different and simpler:

```typescript
// In Fizzy: Server pushes updates via WebSocket
// 1. Model change → broadcast → client receives → DOM update

// In Convex: Queries auto-subscribe to changes
// 1. Client subscribes via useQuery → data changes → component re-renders

// Example: Board with live card updates
function BoardView({ boardId }) {
  // This automatically updates in real-time when any card changes
  const cards = useQuery(api.cards.listByBoard, { boardId });

  return (
    <div>
      {cards?.map(card => <CardComponent key={card._id} card={card} />)}
    </div>
  );
}
```

No manual broadcasting, no Action Cable channels, no Turbo Stream templates. Every query is automatically reactive.

### Stimulus → React Hooks Mapping

| Stimulus Controller | React Equivalent |
|--------------------|------------------|
| `auto_save_controller` | `useDebounce()` + `useMutation()` |
| `drag_and_drop_controller` | `@dnd-kit/core` or `react-beautiful-dnd` |
| `dialog_controller` | Headless UI Dialog or Radix Dialog |
| `combobox_controller` | Headless UI Combobox or cmdk |
| `hotkey_controller` | `react-hotkeys-hook` |
| `notifications_tray_controller` | React component with `useQuery()` subscription |
| `pagination_controller` | `usePaginatedQuery()` from Convex |
| `local_time_controller` | `date-fns` or `dayjs` in React |
| `copy_to_clipboard_controller` | `navigator.clipboard.writeText()` in handler |
| `theme_controller` | `next-themes` or CSS variables in React context |
| `filter_controller` | React state + URL search params |

### Rich Text Editor

Replace Action Text (Trix) with a modern React editor:

```typescript
// TipTap example
import { useEditor, EditorContent } from '@tiptap/react';

function CardDescription({ cardId }) {
  const card = useQuery(api.cards.get, { cardId });
  const updateDescription = useMutation(api.cards.updateDescription);

  const editor = useEditor({
    content: card?.description, // JSON content from Convex
    onUpdate: ({ editor }) => {
      updateDescription({ cardId, description: editor.getJSON() });
    }
  });

  return <EditorContent editor={editor} />;
}
```

### File Uploads

Replace Active Storage with Convex file storage:

```typescript
// Upload handler
const generateUploadUrl = useMutation(api.storage.generateUploadUrl);

async function handleUpload(file: File) {
  const url = await generateUploadUrl();
  const result = await fetch(url, { method: "POST", body: file });
  const { storageId } = await result.json();
  // Store storageId in card document
  await updateCard({ cardId, imageId: storageId });
}

// Display
const imageUrl = useQuery(api.storage.getUrl, { storageId: card.imageId });
```

### Key Architectural Difference

Fizzy's frontend is **server-rendered with progressive enhancement**. Every interaction starts as a form submission or link click, and JavaScript enhances the experience. The server does all the rendering.

A Convex rebuild would be **client-rendered with server data**. React components render in the browser, fetching data from Convex. The server (Convex) only handles data operations. This is a fundamental shift that affects:

1. **SEO**: Need Next.js SSR or static generation for public pages
2. **Initial load**: Client-rendered apps have a loading state; server-rendered don't
3. **Offline**: Service workers can cache Convex data for offline support
4. **Bundle size**: Client needs to ship React + components (vs zero JS for server-rendered)
5. **State management**: No need for Redux/Zustand; Convex queries ARE the state

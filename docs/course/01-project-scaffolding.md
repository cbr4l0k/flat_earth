# Module 01 — Project Scaffolding & First Page

> **What you'll see running:** A styled landing page served by TanStack Start with Tailwind CSS and shadcn/ui, live-reloading in your browser at `http://localhost:3000`.

## Scaffold TanStack Start

TanStack Start is a Vite-based React meta-framework with file-based, type-safe routing. It replaces Fizzy's Rails + Turbo + Stimulus stack with something more familiar to modern frontend devs.

```bash
bun create @tanstack/start@latest
```

The CLI will prompt you for:
- **Project name:** `flat-earth`
- **Add-ons:** Select Tailwind CSS (we'll also add shadcn/ui manually)

```bash
cd flat-earth
```

This creates a project with file-based routing already configured. Inspect the structure:

```
flat-earth/
├── src/
│   ├── routes/
│   │   ├── __root.tsx      # Root layout — wraps every page
│   │   └── index.tsx       # Home page at /
│   └── router.tsx          # Router configuration
├── vite.config.ts          # Vite + TanStack Start configuration
├── package.json
└── tsconfig.json
```

### Install Dependencies

```bash
bun install
```

### Verify It Runs

```bash
bun dev
```

Open `http://localhost:3000`. You should see the default TanStack Start welcome page. Stop the server (`Ctrl+C`) before continuing.

## Add Tailwind CSS

If you didn't select Tailwind during the CLI scaffold, add it manually:

```bash
bun add -d tailwindcss @tailwindcss/vite
```

Add the Tailwind Vite plugin to your config:

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  server: { port: 3000 },
  plugins: [
    tsConfigPaths(),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
});
```

Create `src/styles.css`:

```css
@import "tailwindcss";
```

Import it in your root layout:

```tsx
// src/routes/__root.tsx
import { createRootRoute, Outlet, HeadContent, Scripts } from "@tanstack/react-router";
import "../styles.css";

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Flat Earth</title>
        <HeadContent />
      </head>
      <body className="bg-gray-50 text-gray-900 antialiased">
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
});
```

Run `bun dev` again and verify that the page now has a light gray background — Tailwind is working.

## Add shadcn/ui

shadcn/ui gives us pre-built, customizable React components (buttons, cards, dialogs, etc.) built on Radix UI and Tailwind.

```bash
npx shadcn@latest init
```

When prompted:
- **Style:** Default
- **Base color:** Slate
- **CSS variables for theming:** Yes

This creates `components.json` and a `lib/utils.ts` file. Now add your first components:

```bash
npx shadcn@latest add button card
```

This copies the `Button` and `Card` component source into your project (typically `src/components/ui/`). You own the code — it's not a black-box dependency.

## Your First Page

Replace the default index page with a styled landing page:

```tsx
// src/routes/index.tsx
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "../components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../components/ui/card";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold">Flat Earth</CardTitle>
          <CardDescription>
            A kanban project management app built with Convex, Clerk, and
            TanStack Start.
          </CardDescription>
          <div className="pt-4">
            <Button size="lg" className="w-full">
              Get Started
            </Button>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}
```

Run `bun dev`. You should see a centered card with a title, description, and a button — all styled with Tailwind and shadcn/ui.

## Understanding File-Based Routing

TanStack Router maps file paths to URL routes automatically:

| File | URL |
|------|-----|
| `src/routes/index.tsx` | `/` |
| `src/routes/__root.tsx` | Layout wrapping ALL routes |
| `src/routes/about.tsx` | `/about` |
| `src/routes/$accountId/index.tsx` | `/:accountId` (dynamic segment) |

The `__root.tsx` file is special — it's the root layout. Every page renders inside its `<Outlet />`. This is where we'll later add our Convex and Clerk providers.

### Route with Typed Params

Create a test route with a dynamic parameter:

```tsx
// src/routes/$accountId.tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/$accountId")({
  component: AccountPage,
});

function AccountPage() {
  const { accountId } = Route.useParams();
  return <div className="p-8">Account: {accountId}</div>;
}
```

Visit `http://localhost:3000/test-123` — you'll see "Account: test-123". The param is typed and extracted automatically. Delete this test file when you're done — we'll build the real account routes later.

## Project Structure Going Forward

Here's the structure we'll build throughout the course:

```
flat-earth/
├── src/
│   ├── routes/
│   │   ├── __root.tsx              # Providers (Convex, Clerk)
│   │   ├── index.tsx               # Account picker / landing
│   │   ├── sign-in.tsx             # Sign-in page
│   │   └── $accountId/
│   │       ├── route.tsx           # Account layout (sidebar)
│   │       ├── index.tsx           # Board list
│   │       └── boards/
│   │           └── $boardId/
│   │               ├── route.tsx   # Board layout
│   │               └── index.tsx   # Kanban view
│   ├── components/
│   │   ├── ui/                     # shadcn/ui components
│   │   ├── BoardList.tsx
│   │   ├── KanbanBoard.tsx
│   │   └── ...
│   └── styles.css
├── convex/                          # Backend (added in Module 02)
│   ├── schema.ts
│   ├── boards.ts
│   ├── cards.ts
│   └── ...
├── vite.config.ts
└── package.json
```

## Exercise

1. Scaffold a TanStack Start project with `bun create @tanstack/start@latest`
2. Install Tailwind CSS and verify utility classes work
3. Install shadcn/ui and add the `button` and `card` components
4. Build a landing page using those components
5. Verify `bun dev` shows your styled page at `http://localhost:3000`
6. Create one dynamic route (`/$accountId`) and verify the param works

**Result:** A running, styled app in your browser. No backend yet — that's next.

---

Next: [Module 02 — Adding Convex: First Real-Time Data](./02-adding-convex.md)

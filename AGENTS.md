# Repository Guidelines

## Project Structure & Module Organization
Core application code lives in `src/`, with routes in `src/routes/`, shared styling in `src/styles/`, utilities in `src/utils/`, and router setup in `src/router.tsx`. Convex backend logic lives in `convex/` (`schema.ts`, `accounts.ts`, `boards.ts`, `user.ts`, etc.). Treat `convex/_generated/` as generated output; do not hand-edit it. Static files belong in `public/`, design assets in `assets/`, and long-form notes/research in `docs/`.

## Build, Test, and Development Commands
- `npm run dev`: starts both Vite and Convex development processes.
- `npm run dev:web`: runs the frontend dev server only.
- `npm run dev:convex`: runs Convex dev sync/functions only.
- `npm run build`: production build plus TypeScript no-emit checks.
- `npm run lint`: TypeScript + ESLint validation with zero warnings allowed.
- `npm run format`: formats the repository with Prettier.
- `npm run start`: serves the built server output.

## Coding Style & Naming Conventions
Use TypeScript with strict compiler settings. Formatting is Prettier-driven: 2-space indentation, no semicolons, single quotes, and trailing commas. Follow ESLint defaults from TanStack + Convex configs. Use `PascalCase` for React components/types and `camelCase` for functions, variables, and most filenames. Keep route files aligned with TanStack Router conventions (for example, `__root.tsx`, `_authed.tsx`).

## Testing Guidelines
There is currently no dedicated Jest/Vitest/Playwright suite configured. Until a test runner is introduced, treat `npm run lint` and `npm run build` as required quality gates before opening a PR. When adding automated tests, colocate them near code under test using `*.test.ts` or `*.test.tsx`.

## Commit & Pull Request Guidelines
Recent history favors short, descriptive commits; keep that style but prefer imperative subjects (for example, `Add board ownership checks`). Keep commits focused on one concern. PRs should include: a brief purpose statement, key changes, verification steps (commands run), linked issue/task when available, and screenshots for visible UI updates.

## Security & Configuration Tips
Never commit secrets. Keep local credentials in `.env.local`. Validate auth or schema-impacting changes in both `src/` and `convex/` paths when relevant.

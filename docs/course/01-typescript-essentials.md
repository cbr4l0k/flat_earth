# Module 01 — TypeScript Essentials

> **Goal:** Get productive with TypeScript's type system, async patterns, and the idioms you'll use daily in Convex backend code.

You know how to program. This module focuses on what makes TypeScript *different* from languages you already know — its structural type system, union types, and the patterns that Convex code relies on heavily.

## The Type System in 10 Minutes

### Type Inference

TypeScript infers types from values. You rarely need explicit annotations for local variables:

```typescript
const name = "Flat Earth";        // type: string
const count = 42;                 // type: number
const isActive = true;            // type: boolean
const cards = ["card1", "card2"]; // type: string[]
```

You *do* annotate function parameters (TypeScript can't infer those from callers):

```typescript
function greet(name: string): string {
  return `Hello, ${name}`;
}
```

Return types are usually inferred, but adding them catches mistakes:

```typescript
// TypeScript infers this returns string | undefined — the explicit
// annotation forces you to handle the undefined case.
function findCard(id: string): Card {
  // ...
}
```

### Union Types

A value that can be one of several types. This is TypeScript's killer feature for modeling domain states:

```typescript
type CardStatus = "drafted" | "published" | "active" | "closed" | "not_now";

function canClose(status: CardStatus): boolean {
  return status === "active"; // TypeScript knows 'status' is one of the 5 strings
}
```

Union types work with any types, not just strings:

```typescript
type Result = string | number | null;
type Id = string | number;
```

### Literal Types

A string literal type is a type with exactly one value:

```typescript
type Owner = "owner";  // Only the string "owner" satisfies this type

const role: Owner = "owner";  // OK
const role2: Owner = "admin"; // Error: Type '"admin"' is not assignable to type '"owner"'
```

This is what makes `CardStatus = "drafted" | "published" | ...` work — each string is a literal type, and the union allows any of them.

### Discriminated Unions

The pattern you'll use most for modeling different shapes of data. One field (the "discriminant") tells you which variant you have:

```typescript
type NotificationSource =
  | { type: "event"; eventId: string; action: string }
  | { type: "mention"; mentionId: string; mentionerId: string };

function describeSource(source: NotificationSource): string {
  switch (source.type) {
    case "event":
      // TypeScript knows source has 'eventId' and 'action' here
      return `Event: ${source.action}`;
    case "mention":
      // TypeScript knows source has 'mentionId' and 'mentionerId' here
      return `Mentioned by ${source.mentionerId}`;
  }
}
```

The `switch` on `source.type` narrows the type in each branch. This replaces Rails-style polymorphic associations (`source_type` / `source_id` columns) with compile-time safety.

### Interfaces vs Types

Both define object shapes. Use `type` for unions and computed types; use `interface` for objects you might extend:

```typescript
// Type: good for unions, intersections, mapped types
type CardStatus = "drafted" | "published" | "active" | "closed" | "not_now";
type CardWithAuthor = Card & { authorName: string };

// Interface: good for object shapes, can be extended
interface Card {
  id: string;
  title: string;
  status: CardStatus;
  boardId: string;
  columnId: string | null;  // null means awaiting triage
}

interface CardWithComments extends Card {
  comments: Comment[];
}
```

In practice, for Convex code you'll mostly use `type` aliases. Convex's `Doc<"tableName">` gives you the shape of your documents directly from the schema.

## Generics

Type parameters that let you write reusable typed code:

```typescript
// A function that works with any type T
function first<T>(items: T[]): T | undefined {
  return items[0];
}

const card = first(cards);   // type: Card | undefined
const name = first(["a"]);   // type: string | undefined
```

You'll encounter generics constantly in Convex:

- `Promise<T>` — an async result that resolves to type T
- `Array<T>` — same as `T[]`
- `Doc<"cards">` — a document from the "cards" table (Convex-specific)
- `Id<"cards">` — a document ID for the "cards" table (Convex-specific)

### Constraining Generics

Use `extends` to restrict what T can be:

```typescript
function getTitle<T extends { title: string }>(item: T): string {
  return item.title;
}

getTitle({ title: "My Card", status: "active" }); // OK
getTitle({ name: "No title here" });               // Error
```

## Utility Types

TypeScript ships utility types for transforming types. These four cover 90% of use cases:

### `Partial<T>` — make all fields optional

```typescript
interface Card {
  title: string;
  status: CardStatus;
  dueOn: string | null;
}

type CardUpdate = Partial<Card>;
// { title?: string; status?: CardStatus; dueOn?: string | null }
```

Use this for update/patch operations where you only send changed fields.

### `Pick<T, Keys>` — select specific fields

```typescript
type CardPreview = Pick<Card, "title" | "status">;
// { title: string; status: CardStatus }
```

### `Omit<T, Keys>` — remove specific fields

```typescript
type CardInput = Omit<Card, "id" | "createdAt">;
// Everything except id and createdAt
```

### `Record<K, V>` — a map from keys to values

```typescript
type RolePermissions = Record<CardStatus, boolean>;
// { drafted: boolean; published: boolean; active: boolean; closed: boolean; not_now: boolean }

// More commonly, for arbitrary string keys:
type Metadata = Record<string, string>;
```

## Async/Await

Every Convex function handler is async. If you've used async/await in Python, Java, C#, or JavaScript, it works the same way:

```typescript
async function fetchCard(id: string): Promise<Card | null> {
  const card = await db.get(id);
  return card;
}
```

- `async` marks a function as returning a `Promise`
- `await` pauses execution until the promise resolves
- The return type wraps in `Promise<T>` automatically

### Error Handling

Use try/catch with async/await:

```typescript
async function safeGet(id: string): Promise<Card | null> {
  try {
    return await db.get(id);
  } catch (error) {
    console.error("Failed to fetch card:", error);
    return null;
  }
}
```

In Convex, you'll often throw errors directly and let Convex handle them:

```typescript
import { ConvexError } from "convex/values";

async function requireCard(ctx: QueryCtx, id: Id<"cards">): Promise<Doc<"cards">> {
  const card = await ctx.db.get(id);
  if (!card) {
    throw new ConvexError("Card not found");
  }
  return card;
}
```

### Promise.all for Parallel Fetches

When you need multiple independent pieces of data, fetch them in parallel:

```typescript
// Sequential — slow (one after the other)
const board = await ctx.db.get(boardId);
const user = await ctx.db.get(userId);

// Parallel — fast (both at the same time)
const [board, user] = await Promise.all([
  ctx.db.get(boardId),
  ctx.db.get(userId),
]);
```

## Destructuring, Spread, and Shortcuts

### Destructuring

Pull values out of objects and arrays:

```typescript
// Object destructuring
const { title, status, boardId } = card;

// With rename
const { title: cardTitle } = card;

// In function parameters (very common in Convex)
function handleCard({ title, status }: { title: string; status: CardStatus }) {
  // ...
}

// Array destructuring
const [first, second, ...rest] = items;
```

### Spread

Copy and merge objects:

```typescript
// Copy with overrides
const updated = { ...card, status: "closed" as const };

// Merge objects
const full = { ...defaults, ...userInput };

// Array spread
const all = [...existing, newItem];
```

### Optional Chaining (`?.`)

Safely access nested properties that might be null/undefined:

```typescript
const columnName = card.column?.name;       // string | undefined
const firstTag = card.tags?.[0];            // Tag | undefined
const result = card.getTitle?.();           // calls only if method exists
```

### Nullish Coalescing (`??`)

Default value for null/undefined (not for `0` or `""` like `||`):

```typescript
const title = card.title ?? "Untitled";   // Uses "Untitled" only if title is null/undefined
const count = card.count ?? 0;            // Uses 0 only if count is null/undefined

// Compare with ||
const title2 = card.title || "Untitled";  // Uses "Untitled" if title is "", null, or undefined
```

## Array Methods

You'll chain these constantly in Convex query functions:

### `map` — transform each element

```typescript
const titles = cards.map(card => card.title);
// ["Card 1", "Card 2", "Card 3"]
```

### `filter` — keep elements matching a condition

```typescript
const active = cards.filter(card => card.status === "active");
```

### `find` — get first matching element

```typescript
const myCard = cards.find(card => card.creatorId === userId);
// Card | undefined
```

### `reduce` — accumulate a result

```typescript
// Count cards per status
const counts = cards.reduce((acc, card) => {
  acc[card.status] = (acc[card.status] ?? 0) + 1;
  return acc;
}, {} as Record<CardStatus, number>);
```

### `some` / `every` — boolean checks

```typescript
const hasOverdue = cards.some(card => card.dueOn && card.dueOn < today);
const allClosed = cards.every(card => card.status === "closed");
```

### Chaining

```typescript
const urgentTitles = cards
  .filter(card => card.status === "active")
  .filter(card => card.dueOn !== null)
  .sort((a, b) => a.dueOn!.localeCompare(b.dueOn!))
  .map(card => card.title);
```

## Type Narrowing

TypeScript narrows types based on control flow:

```typescript
function processValue(value: string | number | null) {
  if (value === null) {
    // type is null here
    return;
  }
  if (typeof value === "string") {
    // type is string here
    console.log(value.toUpperCase());
  } else {
    // type is number here
    console.log(value.toFixed(2));
  }
}
```

### `in` operator narrowing

```typescript
type Card = { title: string; columnId: string };
type Draft = { title: string; isDraft: true };

function getColumn(item: Card | Draft) {
  if ("columnId" in item) {
    return item.columnId; // TypeScript knows this is Card
  }
  return null; // This is Draft
}
```

### Non-null assertion (`!`)

When you *know* a value isn't null but TypeScript doesn't:

```typescript
// You just checked card exists, but TypeScript doesn't know
const card = await ctx.db.get(cardId);
if (!card) throw new Error("Not found");

// After the check, card is narrowed to non-null
const title = card.title; // OK — TypeScript knows card is not null here
```

Avoid using `!` as a shortcut to silence the compiler. Use it only when you've genuinely validated the value.

## Exercise: Model a Card

Create a file `exercise-01.ts` and model the Flat Earth card domain:

1. Define a `CardStatus` union type with: `"drafted"`, `"published"`, `"active"`, `"closed"`, `"not_now"`

2. Define a `Card` type with:
   - `id: string`
   - `title: string`
   - `status: CardStatus`
   - `boardId: string`
   - `columnId: string | null` (null = awaiting triage)
   - `creatorId: string`
   - `number: number`
   - `dueOn: string | null`
   - `lastActiveAt: number` (timestamp)
   - `createdAt: number`

3. Write a function `canTransitionTo(card: Card, target: CardStatus): boolean` that enforces:
   - `drafted` → `published` only (via publish)
   - `published`/`active` → `closed`, `not_now`
   - `closed` → `active` (via reopen)
   - `not_now` → `active` (via resume)

4. Write a function `getActiveCards(cards: Card[]): Card[]` that returns only cards with status `"active"` or `"published"` that are not closed or postponed.

5. Write a function `groupByStatus(cards: Card[]): Record<CardStatus, Card[]>` that groups cards by their status using `reduce`.

Verify your types compile: `bun --bun tsc --noEmit exercise-01.ts` (you'll need a `tsconfig.json` with `strict: true`).

---

Next: [Module 02 — Convex Fundamentals](./02-convex-fundamentals.md)

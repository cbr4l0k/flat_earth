/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accesses from "../accesses.js";
import type * as accounts from "../accounts.js";
import type * as assignments from "../assignments.js";
import type * as boards from "../boards.js";
import type * as cards from "../cards.js";
import type * as cards_lifecycle from "../cards/lifecycle.js";
import type * as columns from "../columns.js";
import type * as comments from "../comments.js";
import type * as constants from "../constants.js";
import type * as crons from "../crons.js";
import type * as entropy from "../entropy.js";
import type * as events from "../events.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_cardStatus from "../lib/cardStatus.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as notifications from "../notifications.js";
import type * as pins from "../pins.js";
import type * as posts from "../posts.js";
import type * as reactions from "../reactions.js";
import type * as tags from "../tags.js";
import type * as user from "../user.js";
import type * as watches from "../watches.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accesses: typeof accesses;
  accounts: typeof accounts;
  assignments: typeof assignments;
  boards: typeof boards;
  cards: typeof cards;
  "cards/lifecycle": typeof cards_lifecycle;
  columns: typeof columns;
  comments: typeof comments;
  constants: typeof constants;
  crons: typeof crons;
  entropy: typeof entropy;
  events: typeof events;
  "lib/auth": typeof lib_auth;
  "lib/cardStatus": typeof lib_cardStatus;
  "lib/permissions": typeof lib_permissions;
  notifications: typeof notifications;
  pins: typeof pins;
  posts: typeof posts;
  reactions: typeof reactions;
  tags: typeof tags;
  user: typeof user;
  watches: typeof watches;
  webhooks: typeof webhooks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

import { createHash } from "node:crypto";
import { Prisma, type User } from "@prisma/client";
import { db } from "./db";

/**
 * Shared, idempotent Clerk -> DB user sync.
 *
 * Used by BOTH creation paths — the `user.created` / `user.updated` webhook
 * (src/app/api/webhooks/clerk/route.ts) and the API fallback
 * `getOrCreateUser()` (src/lib/auth.ts) — so the two paths cannot diverge.
 *
 * Idempotency contract (fixes the webhook-vs-fallback race, d4h failure
 * modes A/B/C):
 *  - Row already exists -> converge email (and username when safe). Never
 *    throws P2002 on a username collision; never throws P2025.
 *  - Row missing -> create with a collision-free username: the Clerk
 *    username (or email prefix), and on conflict a deterministic short-hash
 *    suffix, bounded retries.
 *  - Row appears mid-flight (P2002 on clerkId) -> re-read and converge on
 *    the winner's row instead of throwing.
 */

/** Max username candidates tried per sync (base + hashed-suffix retries). */
const MAX_USERNAME_ATTEMPTS = 5;

const { PrismaClientKnownRequestError } = Prisma;

/**
 * Narrow store seam so the unit suite can drive the sync without a database.
 * Structurally satisfied by the real Prisma client (`db`).
 */
export interface UserSyncStore {
  user: {
    findUnique(args: { where: { clerkId: string } }): Promise<User | null>;
    create(args: {
      data: { clerkId: string; email: string; username: string; role: "BUYER" };
    }): Promise<User>;
    update(args: {
      where: { clerkId: string };
      data: { email: string; username?: string };
    }): Promise<User>;
  };
}

/** What we sync from a Clerk user event / Clerk session. */
export interface ClerkUserSyncInput {
  clerkId: string;
  email: string;
  /** Clerk username; Google/social users commonly have none (null). */
  username: string | null;
}

function isPrismaKnownError(err: unknown, code: string): boolean {
  return asKnownError(err, code) !== null;
}

/** Narrows err to the known-request error when the code matches. */
function asKnownError(
  err: unknown,
  code: string
): InstanceType<typeof PrismaClientKnownRequestError> | null {
  return err instanceof PrismaClientKnownRequestError && err.code === code
    ? err
    : null;
}

/** P2002 `meta.target` joined lowercase ("username", "user_clerkid_key", ...). */
function p2002Target(err: unknown): string | null {
  const e = asKnownError(err, "P2002");
  if (!e) return null;
  const target = e.meta?.target;
  const list = Array.isArray(target) ? target : target != null ? [target] : [];
  return list.map(String).join(" ").toLowerCase();
}

function isUsernameConflict(err: unknown): boolean {
  const target = p2002Target(err);
  return target !== null && target.includes("username");
}

function isClerkIdConflict(err: unknown): boolean {
  const target = p2002Target(err);
  return target !== null && target.includes("clerkid");
}

/**
 * Username candidate for a given attempt: attempt 0 keeps the Clerk
 * username (or email prefix); retries append a deterministic hash suffix of
 * clerkId + attempt, so the same Clerk user always converges on the same
 * fallback name while different users with the same prefix stay distinct.
 */
export function usernameCandidate(base: string, clerkId: string, attempt: number): string {
  if (attempt <= 0) return base;
  const suffix = createHash("sha256")
    .update(`${clerkId}:${attempt}`)
    .digest("hex")
    .slice(0, 8);
  return `${base}-${suffix}`;
}

function baseUsername(input: ClerkUserSyncInput): string {
  const prefix = input.email.split("@")[0] ?? "";
  return input.username?.trim() || prefix || "user";
}

/**
 * Idempotent upsert of the Clerk user into the local User table.
 *
 * - Existing row: syncs email; syncs username only when Clerk provides one
 *   and it differs. A desired username held by ANOTHER user is not a failure:
 *   the existing username is kept and the email still converges.
 * - Missing row: created with a collision-free username.
 * - Any P2025 (row vanished mid-sync) falls through to the create path, so
 *   a user.updated can never wedge Clerk's retry loop.
 */
export async function upsertClerkUser(
  input: ClerkUserSyncInput,
  store: UserSyncStore = db
): Promise<User> {
  const existing = await store.user.findUnique({
    where: { clerkId: input.clerkId },
  });

  if (existing) {
    const data: { email: string; username?: string } = { email: input.email };
    if (input.username && input.username !== existing.username) {
      data.username = input.username;
    }

    try {
      return await store.user.update({
        where: { clerkId: input.clerkId },
        data,
      });
    } catch (err) {
      if (isUsernameConflict(err)) {
        // Desired username is held by another user: keep the current one,
        // still converge the email. A username collision must never 500.
        try {
          return await store.user.update({
            where: { clerkId: input.clerkId },
            data: { email: input.email },
          });
        } catch (fallbackErr) {
          if (!isPrismaKnownError(fallbackErr, "P2025")) throw fallbackErr;
        }
      } else if (!isPrismaKnownError(err, "P2025")) {
        throw err;
      }
      // P2025: row vanished between findUnique and update (concurrent
      // user.deleted) — fall through and recreate it.
    }
  }

  const base = baseUsername(input);
  for (let attempt = 0; attempt < MAX_USERNAME_ATTEMPTS; attempt++) {
    try {
      return await store.user.create({
        data: {
          clerkId: input.clerkId,
          email: input.email,
          username: usernameCandidate(base, input.clerkId, attempt),
          role: "BUYER",
        },
      });
    } catch (err) {
      if (isClerkIdConflict(err)) {
        // A concurrent path (webhook racing the API fallback, or a Clerk
        // redelivery) created the row between our findUnique and this
        // create. Converge on the existing row — never throw on the race.
        const racer = await store.user.findUnique({
          where: { clerkId: input.clerkId },
        });
        if (racer) return racer;
        throw err;
      }
      if (!isUsernameConflict(err)) throw err;
      // username taken — try the next deterministic candidate
    }
  }

  throw new Error(
    `upsertClerkUser: exhausted ${MAX_USERNAME_ATTEMPTS} username candidates for clerkId ${input.clerkId}`
  );
}
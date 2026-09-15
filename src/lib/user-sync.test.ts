import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Prisma, type User } from "@prisma/client";
import {
  upsertClerkUser,
  usernameCandidate,
  type UserSyncStore,
} from "./user-sync";

const { PrismaClientKnownRequestError } = Prisma;

/**
 * In-memory store enforcing the same THREE unique constraints as the real
 * User table (clerkId, username, email — prisma/migrations/0_init), so the
 * tests exercise the exact failure modes of the production database.
 */

interface FakeRow {
  id: string;
  clerkId: string;
  username: string;
  email: string;
  role: User["role"];
}

function toUser(row: FakeRow): User {
  return {
    id: row.id,
    clerkId: row.clerkId,
    username: row.username,
    email: row.email,
    role: row.role,
    createdAt: new Date(),
    updatedAt: new Date(),
    subscriptionId: null,
    subscriptionPlan: null,
    subscriptionStatus: "NONE",
    subscriptionExpiresAt: null,
    listingLimit: null,
  };
}

class FakeStore implements UserSyncStore {
  rows: FakeRow[] = [];
  private seq = 0;

  private byClerkId(clerkId: string) {
    return this.rows.find((r) => r.clerkId === clerkId) ?? null;
  }

  private usernameHolder(username: string) {
    return this.rows.find((r) => r.username === username) ?? null;
  }

  private emailHolder(email: string) {
    return this.rows.find((r) => r.email === email) ?? null;
  }

  user = {
    findUnique: async ({ where }: { where: { clerkId: string } }) => {
      const row = this.byClerkId(where.clerkId);
      return row ? toUser(row) : null;
    },

    create: async ({
      data,
    }: {
      data: { clerkId: string; email: string; username: string; role: "BUYER" };
    }) => {
      if (this.byClerkId(data.clerkId)) {
        throw new PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "7.6.0",
          meta: { target: ["clerkId"] },
        });
      }
      if (this.usernameHolder(data.username)) {
        throw new PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "7.6.0",
          meta: { target: ["username"] },
        });
      }
      if (this.emailHolder(data.email)) {
        throw new PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "7.6.0",
          meta: { target: ["email"] },
        });
      }
      const row: FakeRow = {
        id: `row-${++this.seq}`,
        clerkId: data.clerkId,
        username: data.username,
        email: data.email,
        role: data.role,
      };
      this.rows.push(row);
      return toUser(row);
    },

    update: async ({
      where,
      data,
    }: {
      where: { clerkId: string };
      data: { email: string; username?: string };
    }) => {
      const row = this.byClerkId(where.clerkId);
      if (!row) {
        throw new PrismaClientKnownRequestError("Record not found", {
          code: "P2025",
          clientVersion: "7.6.0",
        });
      }
      if (data.username !== undefined && data.username !== row.username) {
        const holder = this.usernameHolder(data.username);
        if (holder && holder.id !== row.id) {
          throw new PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "7.6.0",
            meta: { target: ["username"] },
          });
        }
      }
      if (data.email !== row.email) {
        const holder = this.emailHolder(data.email);
        if (holder && holder.id !== row.id) {
          throw new PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "7.6.0",
            meta: { target: ["email"] },
          });
        }
      }
      if (data.username !== undefined) row.username = data.username;
      row.email = data.email;
      return toUser(row);
    },
  };
}

/** Google-style user: no Clerk username, so the email prefix is used. */
function googleInput(clerkId: string, email: string) {
  return { clerkId, email, username: null };
}

describe("upsertClerkUser — AC1: user.created for a new user", () => {
  it("creates the row with the email prefix as username", async () => {
    const store = new FakeStore();
    const user = await upsertClerkUser(
      googleInput("user_google_1", "alice@gmail.com"),
      store
    );
    assert.equal(user.clerkId, "user_google_1");
    assert.equal(user.email, "alice@gmail.com");
    assert.equal(user.username, "alice");
    assert.equal(store.rows.length, 1);
  });

  it("prefers the Clerk username when provided", async () => {
    const store = new FakeStore();
    const user = await upsertClerkUser(
      { clerkId: "user_clerkname", email: "bob@example.com", username: "bobby" },
      store
    );
    assert.equal(user.username, "bobby");
  });
});

describe("upsertClerkUser — AC2: webhook-after-fallback race is idempotent", () => {
  it("a second sync for the same clerkId converges instead of P2002-crashing", async () => {
    const store = new FakeStore();
    const input = googleInput("user_race", "carol@gmail.com");

    // Fallback path creates the row first (user hits /api/* before webhook)
    await upsertClerkUser(input, store);
    // The webhook's user.created arrives afterwards — must not throw
    const again = await upsertClerkUser(input, store);

    assert.equal(again.clerkId, "user_race");
    assert.equal(store.rows.length, 1);
  });

  it("converges on the winner when the row appears mid-flight (P2002 on clerkId)", async () => {
    // Simulate a concurrent create BETWEEN findUnique and create: report no
    // row on the first read, but have the row present when create fails.
    let raced = false;
    const base = new FakeStore();
    const racingStore: UserSyncStore = {
      user: {
        findUnique: async (args) => {
          if (!raced) return null; // first read: row not there yet
          return base.user.findUnique(args);
        },
        create: async (args) => {
          if (!raced) {
            raced = true;
            // the "other path" inserts the row, then our create collides
            await base.user.create(args);
            throw new PrismaClientKnownRequestError("Unique constraint failed", {
              code: "P2002",
              clientVersion: "7.6.0",
              meta: { target: ["User_clerkId_key"] },
            });
          }
          return base.user.create(args);
        },
        update: (args) => base.user.update(args),
      },
    };

    const user = await upsertClerkUser(
      googleInput("user_midflight", "dave@gmail.com"),
      racingStore
    );
    assert.equal(user.clerkId, "user_midflight");
    assert.equal(base.rows.length, 1);
  });
});

describe("upsertClerkUser — AC3: same email prefix, both get rows", () => {
  it("two Google users with the same prefix end up with distinct usernames", async () => {
    const store = new FakeStore();

    const first = await upsertClerkUser(
      googleInput("user_j_a", "john@gmail.com"),
      store
    );
    const second = await upsertClerkUser(
      googleInput("user_j_b", "john@example.com"),
      store
    );

    assert.equal(first.username, "john");
    assert.notEqual(second.username, "john");
    assert.ok(second.username.startsWith("john-"), second.username);
    assert.equal(store.rows.length, 2);
    // both rows exist — neither sign-in is a dead account
    assert.ok(store.rows.every((r) => r.clerkId && r.email));
  });

  it("the suffix is deterministic (same clerkId hashes to the same name)", () => {
    const a = usernameCandidate("john", "user_j_b", 1);
    const b = usernameCandidate("john", "user_j_b", 1);
    const c = usernameCandidate("john", "user_other", 1);
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.equal(usernameCandidate("john", "user_j_b", 0), "john");
  });
});

describe("upsertClerkUser — AC4: user.updated for a missing row", () => {
  it("creates the row instead of crashing (P2025-safe)", async () => {
    const store = new FakeStore();
    // user.updated arrives for a user that never got a user.created row
    const user = await upsertClerkUser(
      { clerkId: "user_late", email: "late@gmail.com", username: null },
      store
    );
    assert.equal(user.clerkId, "user_late");
    assert.equal(store.rows.length, 1);
  });

  it("falls through to create when the row vanishes mid-update (P2025)", async () => {
    const store = new FakeStore();
    await upsertClerkUser(googleInput("user_vanish", "eve@gmail.com"), store);

    const flaky: UserSyncStore = {
      user: {
        findUnique: store.user.findUnique,
        update: async () => {
          throw new PrismaClientKnownRequestError("Record not found", {
            code: "P2025",
            clientVersion: "7.6.0",
          });
        },
        create: async () => {
          // simulate the concurrent delete having removed the row for good
          throw new PrismaClientKnownRequestError("Record not found", {
            code: "P2025",
            clientVersion: "7.6.0",
          });
        },
      },
    };

    // A P2025 storm on every path would surface as the create's P2025 —
    // the invariant that matters: no UNHANDLED P2025-style wedge; the
    // helper never silently returns a stale row.
    await assert.rejects(
      () => upsertClerkUser(googleInput("user_vanish", "eve2@gmail.com"), flaky),
      (err: unknown) =>
        err instanceof PrismaClientKnownRequestError && err.code === "P2025"
    );
  });
});

describe("upsertClerkUser — username semantics on an existing row", () => {
  it("does not steal a username held by another user (no 500)", async () => {
    const store = new FakeStore();
    await upsertClerkUser(googleInput("user_hold_a", "hold@gmail.com"), store); // "hold"
    const b = await upsertClerkUser(
      googleInput("user_hold_b", "hold@example.com"),
      store
    ); // "hold-<hash>"

    // B's Clerk profile later sets username "hold" — held by A
    const updated = await upsertClerkUser(
      { clerkId: "user_hold_b", email: "hold@example.com", username: "hold" },
      store
    );
    assert.equal(updated.id, b.id);
    assert.equal(updated.username, b.username); // kept its own
    assert.equal(updated.email, "hold@example.com");
  });

  it("syncs a newly-chosen Clerk username when it is free", async () => {
    const store = new FakeStore();
    const a = await upsertClerkUser(
      googleInput("user_pick", "pick@gmail.com"),
      store
    );
    assert.equal(a.username, "pick");
    const renamed = await upsertClerkUser(
      { clerkId: "user_pick", email: "pick@gmail.com", username: "picked" },
      store
    );
    assert.equal(renamed.username, "picked");
  });
});

describe("upsertClerkUser — genuine conflicts still surface", () => {
  it("rethrows a P2002 on email (a real conflict, not a race to absorb)", async () => {
    const store = new FakeStore();
    await upsertClerkUser(googleInput("user_dup_a", "same@gmail.com"), store);
    await assert.rejects(
      () => upsertClerkUser(googleInput("user_dup_b", "same@gmail.com"), store),
      (err: unknown) =>
        err instanceof PrismaClientKnownRequestError && err.code === "P2002"
    );
  });

  it("gives up after a bounded number of username attempts", async () => {
    // pathological store where EVERY username candidate is taken
    const hostile: UserSyncStore = {
      user: {
        findUnique: async () => null,
        create: async () => {
          throw new PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "7.6.0",
            meta: { target: ["username"] },
          });
        },
        update: async () => {
          throw new Error("unreachable");
        },
      },
    };
    await assert.rejects(
      () => upsertClerkUser(googleInput("user_hostile", "x@gmail.com"), hostile),
      /exhausted 5 username candidates/
    );
  });
});
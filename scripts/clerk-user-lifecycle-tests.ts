import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteClerkUser,
  syncClerkUser,
  type ClerkUserLifecyclePort,
  type ClerkUserRow,
} from "../src/lib/clerk-user-lifecycle";

class FakeLifecycleStore implements ClerkUserLifecyclePort {
  users = new Map<string, ClerkUserRow>();
  tombstones = new Set<string>();
  favoritesDeleted = 0;
  messagesRedacted = 0;
  profilesDeactivated = 0;
  listingsHidden = 0;
  writes = 0;
  afterUpsert?: () => void;

  async withClerkLock<T>(_clerkId: string, action: () => Promise<T>): Promise<T> { return action(); }
  async isDeleted(clerkId: string): Promise<boolean> { return this.tombstones.has(clerkId); }
  async findUser(clerkId: string): Promise<ClerkUserRow | null> { return this.users.get(clerkId) ?? null; }
  async findIdentityConflicts(clerkId: string, email: string, username: string) {
    const user = [...this.users.values()].find((row) => row.clerkId !== clerkId && (row.email === email || row.username === username));
    return { email: user?.email === email, username: user?.username === username };
  }
  async saveUser(input: { clerkId: string; email: string; username: string; existing: ClerkUserRow | null }) {
    this.writes += 1;
    this.afterUpsert?.();
    const row: ClerkUserRow = input.existing
      ? { ...input.existing, email: input.email, username: input.username }
      : { id: `db-${input.clerkId}`, clerkId: input.clerkId, email: input.email, username: input.username, deletedAt: null };
    this.users.set(input.clerkId, row);
    return row;
  }
  async transaction<T>(clerkId: string, action: (tx: {
    findUser(clerkId: string): Promise<ClerkUserRow | null>;
    findIdentityConflicts(clerkId: string, email: string, username: string): Promise<{ email: boolean; username: boolean }>;
    saveUser(input: { clerkId: string; email: string; username: string; existing: ClerkUserRow | null }): Promise<ClerkUserRow>;
    isDeleted(clerkId: string): Promise<boolean>;
    createTombstone(clerkId: string): Promise<void>;
    anonymizeUser(user: ClerkUserRow): Promise<void>;
    removeFavorites(userId: string): Promise<void>;
    redactMessages(userId: string): Promise<void>;
    deactivateSeller(userId: string): Promise<void>;
    hideListings(userId: string): Promise<void>;
  }) => Promise<T>): Promise<T> {
    return action({
      findUser: async (id) => this.users.get(id) ?? null,
      findIdentityConflicts: async (id, email, username) => {
        const row = [...this.users.values()].find((user) => user.clerkId !== id && (user.email === email || user.username === username));
        return { email: row?.email === email, username: row?.username === username };
      },
      saveUser: async (input) => {
        this.writes += 1;
        this.afterUpsert?.();
        const row: ClerkUserRow = input.existing
          ? { ...input.existing, email: input.email, username: input.username }
          : { id: `db-${input.clerkId}`, clerkId: input.clerkId, email: input.email, username: input.username, deletedAt: null };
        this.users.set(input.clerkId, row);
        return row;
      },
      isDeleted: async (id) => this.tombstones.has(id),
      createTombstone: async (id) => { this.tombstones.add(id); },
      anonymizeUser: async (user) => {
        this.users.delete(user.clerkId);
        this.users.set(`deleted:${user.id}`, { ...user, clerkId: `deleted:${user.id}`, email: `deleted+${user.id}@invalid.example`, username: `deleted-${user.id}`, deletedAt: new Date() });
      },
      removeFavorites: async () => { this.favoritesDeleted += 1; },
      redactMessages: async () => { this.messagesRedacted += 1; },
      deactivateSeller: async () => { this.profilesDeactivated += 1; },
      hideListings: async () => { this.listingsHidden += 1; },
    });
  }
}

const profile = (overrides: Partial<{ id: string; username: string | null; emailAddresses: { emailAddress: string }[] }> = {}) => ({
  id: "clerk_123456789",
  username: "hen",
  emailAddresses: [{ emailAddress: "hen@example.test" }],
  ...overrides,
});

test("replayed create and update events converge without resetting account state", async () => {
  const store = new FakeLifecycleStore();
  const created = await syncClerkUser(profile(), store);
  assert.ok(created);
  store.users.set(created!.clerkId, { ...created!, role: "SELLER" });
  const updated = await syncClerkUser(profile({ username: "henry" }), store);
  const replay = await syncClerkUser(profile({ username: "henry" }), store);
  assert.equal(updated?.username, "henry");
  assert.equal(replay?.username, "henry");
  assert.equal(replay?.role, "SELLER");
});

test("a missing-row update creates the user and an event without email is a no-op", async () => {
  const store = new FakeLifecycleStore();
  const missingUpdate = await syncClerkUser(profile(), store);
  assert.equal(missingUpdate?.clerkId, "clerk_123456789");
  const writes = store.writes;
  assert.equal(await syncClerkUser(profile({ emailAddresses: [] }), store), null);
  assert.equal(store.writes, writes);
});

test("a username owned by another user is not overwritten or allowed to fail the sync", async () => {
  const store = new FakeLifecycleStore();
  store.users.set("other", { id: "other-db", clerkId: "other", email: "other@example.test", username: "taken", deletedAt: null });
  const synced = await syncClerkUser(profile({ username: "taken" }), store);
  assert.equal(synced?.email, "hen@example.test");
  assert.notEqual(synced?.username, "taken");
  assert.equal(store.users.get("other")?.email, "other@example.test");
});

test("an email conflict does not bind a Clerk identity to another account", async () => {
  const store = new FakeLifecycleStore();
  store.users.set("other", { id: "other-db", clerkId: "other", email: "hen@example.test", username: "other", deletedAt: null });
  assert.equal(await syncClerkUser(profile(), store), null);
  assert.equal(store.users.has("clerk_123456789"), false);
  assert.equal(store.users.get("other")?.clerkId, "other");
});

test("a concurrent create uniqueness race re-reads and returns the winning row", async () => {
  const store = new FakeLifecycleStore();
  store.afterUpsert = () => {
    store.afterUpsert = undefined;
    store.users.set("clerk_123456789", { id: "winner", clerkId: "clerk_123456789", email: "hen@example.test", username: "hen", deletedAt: null });
    throw Object.assign(new Error("unique collision"), { code: "P2002" });
  };
  const row = await syncClerkUser(profile(), store);
  assert.equal(row?.id, "winner");
});

test("a deleted account cannot be resurrected by a delayed create or update", async () => {
  const store = new FakeLifecycleStore();
  await deleteClerkUser("clerk_123456789", store);
  const before = store.writes;
  assert.equal(await syncClerkUser(profile(), store), null);
  assert.equal(await syncClerkUser(profile({ username: "later" }), store), null);
  assert.equal(store.writes, before);
});

test("deletion is idempotent, anonymizes identity, and preserves historical rows", async () => {
  const store = new FakeLifecycleStore();
  store.users.set("clerk_123456789", { id: "db-user", clerkId: "clerk_123456789", email: "hen@example.test", username: "hen", deletedAt: null });
  assert.equal(await deleteClerkUser("clerk_123456789", store), true);
  assert.equal(await deleteClerkUser("clerk_123456789", store), false);
  assert.equal(store.tombstones.has("clerk_123456789"), true);
  const anonymized = store.users.get("deleted:db-user");
  assert.equal(anonymized?.email, "deleted+db-user@invalid.example");
  assert.equal(anonymized?.username, "deleted-db-user");
  assert.equal(anonymized?.deletedAt instanceof Date, true);
  assert.equal(store.favoritesDeleted, 1);
  assert.equal(store.messagesRedacted, 1);
  assert.equal(store.profilesDeactivated, 1);
  assert.equal(store.listingsHidden, 1);
});

test("a delete arriving before user creation leaves a tombstone and prevents later resurrection", async () => {
  const store = new FakeLifecycleStore();
  assert.equal(await deleteClerkUser("clerk_123456789", store), false);
  assert.equal(await syncClerkUser(profile(), store), null);
  assert.equal(store.users.size, 0);
});

/**
 * Security regression tests for bead fleet-ops-yzq.1.1
 * "Secure Eggbook realtime, APIs, and public data exposure".
 *
 * Plain-TS test harness (tsx) — the repo has no test framework yet.
 * Modules under test read env per call (no import-time coupling), so
 * scenarios mutate process.env directly and share one process.
 *
 * Run: npm run test:security
 */
import assert from "node:assert/strict";

type Scenario = { name: string; fn: () => void | Promise<void> };
const scenarios: Scenario[] = [];
const test = (name: string, fn: () => void | Promise<void>) => scenarios.push({ name, fn });

const clearRedisEnv = () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
};

// Runtime-only env override (NODE_ENV's type is readonly in Node's types)
const setNodeEnv = (mode: string) => {
  const env = process.env as { NODE_ENV?: string };
  env.NODE_ENV = mode;
};

// ---------------------------------------------------------------------------
// isChannelAuthAllowed — Pusher channel authorization matrix
// ---------------------------------------------------------------------------
test("channel auth: user channel allowed ONLY for its owner", async () => {
  const { isChannelAuthAllowed } = await import("../src/lib/pusher");
  const ctx = { clerkId: "clerk_A", dbUserId: "db_A", conversationIds: new Set<string>() };
  assert.equal(isChannelAuthAllowed("private-user-clerk_A", ctx), true);
  assert.equal(isChannelAuthAllowed("private-user-clerk_B", ctx), false);
  // prefix-collision safety: "user-" is a strict, non-empty prefix
  assert.equal(isChannelAuthAllowed("private-user-", ctx), false);
});

test("channel auth: seller channel allowed ONLY for that seller", async () => {
  const { isChannelAuthAllowed } = await import("../src/lib/pusher");
  const ctx = { clerkId: "clerk_A", dbUserId: "db_A", conversationIds: new Set<string>() };
  assert.equal(isChannelAuthAllowed("private-seller-clerk_A", ctx), true);
  assert.equal(isChannelAuthAllowed("private-seller-clerk_B", ctx), false);
  assert.equal(isChannelAuthAllowed("private-seller-", ctx), false);
});

test("channel auth: conversation channel allowed ONLY for participants", async () => {
  const { isChannelAuthAllowed } = await import("../src/lib/pusher");
  const ctx = { clerkId: "clerk_A", dbUserId: "db_A", conversationIds: new Set<string>(["conv1", "conv2"]) };
  assert.equal(isChannelAuthAllowed("private-conversation-conv1", ctx), true);
  assert.equal(isChannelAuthAllowed("private-conversation-convother", ctx), false);
  assert.equal(isChannelAuthAllowed("private-conversation-", ctx), false);
});

test("channel auth: public channels and unknown namespaces are ALWAYS denied", async () => {
  const { isChannelAuthAllowed } = await import("../src/lib/pusher");
  const ctx = { clerkId: "clerk_A", dbUserId: "db_A", conversationIds: new Set<string>(["conv1"]) };
  // No private- prefix → public → every payload on it is world-readable
  assert.equal(isChannelAuthAllowed("user-clerk_A", ctx), false);
  assert.equal(isChannelAuthAllowed("seller-clerk_A", ctx), false);
  assert.equal(isChannelAuthAllowed("conversation-conv1", ctx), false);
  // Unknown private families must not be mintable from our endpoint
  assert.equal(isChannelAuthAllowed("private-admin-feed", ctx), false);
  assert.equal(isChannelAuthAllowed("private-", ctx), false);
  assert.equal(isChannelAuthAllowed("", ctx), false);
});

test("channel constants: every CHANNELS builder emits a private channel", async () => {
  const { CHANNELS } = await import("../src/lib/pusher-constants");
  assert.ok(CHANNELS.user("x").startsWith("private-"), "user channel must be private");
  assert.ok(CHANNELS.seller("x").startsWith("private-"), "seller channel must be private");
  assert.ok(CHANNELS.conversation("x").startsWith("private-"), "conversation channel must be private");
});

// ---------------------------------------------------------------------------
// serializeMessage — API/realtime payload de-scoping
// ---------------------------------------------------------------------------
// A row shaped like the OLD include: { sender: true } output: full Prisma user.
const leakedPrismaRow = {
  id: "msg_1",
  content: "hi",
  senderId: "sender_1",
  createdAt: new Date(0),
  sender: {
    id: "sender_1",
    username: "alice",
    email: "alice@example.com",
    clerkId: "user_leak_clerkId",
    role: "SELLER",
    subscriptionId: "sub_123",
  },
  email: "sender@example.com",
  clerkId: "msg_level_clerkId",
  stripeAccountId: "acct_leak",
} as unknown as {
  id: string;
  content: string;
  senderId: string;
  createdAt: Date;
  sender: { id: string; username: string } | null;
};

test("serializeMessage emits ONLY whitelisted keys (no email/clerkId/subscription/Stripe)", async () => {
  const { serializeMessage } = await import("../src/lib/message-view");
  const view = serializeMessage(leakedPrismaRow);
  const json = JSON.parse(JSON.stringify(view)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(json).sort(), ["content", "createdAt", "id", "sender", "senderId"]);
  assert.deepEqual(Object.keys(json.sender as Record<string, unknown>).sort(), ["id", "username"]);
  const text = JSON.stringify(view);
  for (const needle of ["alice@example.com", "clerkId", "subscriptionId", "acct_leak"]) {
    assert.ok(!text.includes(needle), `leaked ${needle}`);
  }
});

// ---------------------------------------------------------------------------
// upload sniffing — claimed MIME must never be trusted
// ---------------------------------------------------------------------------
const utf8 = new TextEncoder();

test("sniff: real image headers accepted (JPEG/PNG/GIF87a/GIF89a/WebP)", async () => {
  const { sniffImageType } = await import("../src/lib/image-sniff");
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const gif87 = utf8.encode("GIF87a");
  const gif89 = utf8.encode("GIF89a");
  const webp = new Uint8Array([...utf8.encode("RIFF"), 0, 0, 0, 0, ...utf8.encode("WEBP")]);
  assert.equal(sniffImageType(jpeg), "image/jpeg");
  assert.equal(sniffImageType(png), "image/png");
  assert.equal(sniffImageType(gif87), "image/gif");
  assert.equal(sniffImageType(gif89), "image/gif");
  assert.equal(sniffImageType(webp), "image/webp");
});

test("sniff: attacker-controlled 'image' payloads are REJECTED by content", async () => {
  const { sniffImageType } = await import("../src/lib/image-sniff");
  // Classic malicious payloads that claim image/* in multipart metadata:
  assert.equal(sniffImageType(utf8.encode("<html><script>alert(1)</script></html>")), null);
  assert.equal(sniffImageType(utf8.encode("<script>alert(1)</script>")), null);
  assert.equal(sniffImageType(utf8.encode("<!DOCTYPE svg><svg onload=alert(1)>")), null);
  assert.equal(sniffImageType(utf8.encode("%PDF-1.4\n1 0 obj")), null);
  assert.equal(sniffImageType(utf8.encode('<?php echo "x"; ?>')), null);
  assert.equal(
    sniffImageType(utf8.encode("<?xml version='1.0'?><!DOCTYPE foo><!ENTITY xxe SYSTEM 'file:///'><foo>&xxe;</foo>")),
    null
  );
  assert.equal(sniffImageType(utf8.encode("#!/bin/sh\nrm -rf /")), null);
  assert.equal(sniffImageType(utf8.encode('{"x":"json"}')), null);
  assert.equal(sniffImageType(new Uint8Array(0)), null);
});

test("sniff: polyglot (PNG header + embedded script) stays PNG", async () => {
  const { sniffImageType } = await import("../src/lib/image-sniff");
  const pngPolyglot = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...utf8.encode("<script>x</script>"),
  ]);
  assert.equal(sniffImageType(pngPolyglot), "image/png");
});

// ---------------------------------------------------------------------------
// rate limiting — no Redis (or broken Redis) in production must NOT
// silently disable enforcement
// ---------------------------------------------------------------------------
test("rate limit (dev, no Redis): allows all (local-dev no-op)", async () => {
  clearRedisEnv();
  setNodeEnv("development");
  const { rateLimit } = await import("../src/lib/rate-limit");
  for (let i = 0; i < 40; i++) {
    const r = await rateLimit("dev-user", "mutation");
    assert.equal(r.success, true);
  }
});

test("rate limit (prod, no Redis): in-memory fallback ENFORCES the window", async () => {
  clearRedisEnv();
  setNodeEnv("production");
  const { rateLimit } = await import("../src/lib/rate-limit");
  let denied = 0;
  for (let i = 0; i < 35; i++) {
    const r = await rateLimit("prod-user", "mutation"); // limit: 30/1m
    if (!r.success) {
      denied++;
      assert.equal(r.response.status, 429);
    }
  }
  assert.equal(denied, 5, "requests beyond the window must be denied in production");
});

test("rate limit (prod, Redis unreachable): fail-closed fallback does NOT allow all", async () => {
  // Use the tightest category ("upload": 10/1m): a dead Upstash costs ~4s per
  // call, so keep the loop well inside the 60s window (12x4s ≈ 48s) — with a
  // wider category the loop would cross a window boundary and legitimately
  // reset, which would test nothing.
  process.env.UPSTASH_REDIS_REST_URL = "http://127.0.0.1:9/redis";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  setNodeEnv("production");
  const { rateLimit } = await import("../src/lib/rate-limit");
  let denied = 0;
  for (let i = 0; i < 12; i++) {
    const r = await rateLimit("err-user-upload", "upload"); // limit: 10/1m
    if (!r.success) {
      denied++;
      assert.equal(r.response.status, 429);
    }
  }
  // Either Upstash enforced its window or our fallback did — never "all allowed"
  assert.ok(denied >= 1, `expected denials beyond the 10-request window, got ${denied}`);
});

// ---------------------------------------------------------------------------
// messages flow — read-tracking, recency, and unread-badge contract (R1–R3)
// ---------------------------------------------------------------------------
// The route/page code touches Clerk auth + Prisma, which this harness does not
// mock (route-level integration stays a residual): the rework contract is
// pinned at source level so a future edit cannot silently re-drop the
// behaviors the changes-requested review flagged.

const readRepoSrc = async (rel: string): Promise<string> => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
};

test("R1: reading a conversation marks the other party's messages read in the participant-checked GET (no dead endpoint)", async () => {
  const src = await readRepoSrc("src/app/api/messages/route.ts");
  assert.ok(
    /senderId: \{ not: user\.id \}[\s\S]{0,700}data: \{ read: true \}/.test(src),
    "GET single-conversation branch must mark the other party's unread messages read"
  );
  assert.ok(
    src.includes("triggerMessagesRead("),
    "mark-read must fire the other party's read receipt"
  );
  assert.ok(
    !/export async function PUT/.test(src),
    "read-marking must not sit behind an endpoint no client calls (dead PUT)"
  );
});

test("R2: POST bumps conversation recency (GET-all orders by updatedAt desc)", async () => {
  const src = await readRepoSrc("src/app/api/messages/route.ts");
  const bump = /db\.conversation\.update\(\{[\s\S]{0,160}updatedAt: new Date\(\)/.exec(src);
  assert.ok(bump, "POST must restore the updatedAt bump");
  const bumpAt = bump.index;
  const triggerAt = src.indexOf("triggerNewMessage(");
  assert.ok(triggerAt !== -1 && bumpAt < triggerAt, "the bump belongs to the POST send path");
});

test("R3: both messages pages consume unreadCount (no stale _count reads)", async () => {
  for (const page of ["src/app/messages/page.tsx", "src/app/dashboard/messages/page.tsx"]) {
    const src = await readRepoSrc(page);
    assert.ok(!src.includes("_count"), `${page} must not read the removed _count field`);
    assert.ok(src.includes("unreadCount"), `${page} must render the unreadCount badge`);
  }
});

test("R3 (API contract): GET-all projects unreadCount and a top-level unreadTotal", async () => {
  const src = await readRepoSrc("src/app/api/messages/route.ts");
  assert.ok(src.includes("unreadCount: conv._count.messages"), "unreadCount must be projected");
  assert.ok(src.includes("unreadTotal:"), "unreadTotal must be computed server-side");
});

test("sniff: PNG recognition requires the full 8-byte signature (truncated variants rejected)", async () => {
  const { sniffImageType } = await import("../src/lib/image-sniff");
  assert.equal(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03, 0x04])), null);
  assert.equal(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
});

// ---------------------------------------------------------------------------
// Runner (plain harness, no framework)
// ---------------------------------------------------------------------------
async function run() {
  let pass = 0;
  let fail = 0;
  for (const s of scenarios) {
    try {
      await s.fn();
      pass++;
      console.log(`  ok - ${s.name}`);
    } catch (err) {
      fail++;
      console.error(`  FAIL - ${s.name}`);
      console.error(String(err instanceof Error ? err.stack || err.message : err));
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run();

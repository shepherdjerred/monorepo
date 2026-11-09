import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { capturePublicRedditReceipt } from "./public-receipt.ts";
import { PromotionBrowser } from "#activities/promotion/browser.ts";
import { promotionTarget } from "#activities/promotion/manifest.ts";

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) await server.stop(true);
});
const uuid = "00000000-0000-4000-8000-000000000000";
const receiptUrl = "https://www.reddit.com/r/mcservers/comments/abc/fixture/";
const quote = "The Storm [SMP]";
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
function evaluationResult(expression: string) {
  if (expression === "location.href") return receiptUrl;
  return expression.includes("const parts=location.pathname")
    ? "2026-11-09T00:00:00Z"
    : [];
}

function harness(
  options: {
    fault?: "create" | "start" | "snapshot" | "stop" | "delete";
    cancel?: boolean;
    duplicate?: boolean;
    conflictOnCreate?: boolean;
    stopLag?: number;
  } = {},
) {
  const controller = new AbortController();
  const persistent = {
    id: "signed-in",
    name: "storm-promotion-reddit",
    running: true,
  };
  const profiles = new Map([[persistent.name, { ...persistent }]]);
  if (options.duplicate === true) {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(uuid);
    const collision = {
      id: "other-owner",
      name: `storm-public-${uuid}`,
      running: true,
    };
    profiles.set(collision.name, collision);
  }
  const calls: { method: string; path: string }[] = [];
  let anonymous: { id: string; name: string; running: boolean } | undefined;
  let stopped = false,
    remainingStopReads = options.stopLag ?? 0;
  const readProfile = (path: string) => {
    const key = decodeURIComponent(path.slice("/profiles/".length));
    const profile = [...profiles.values()].find(
      (p) => p.id === key || p.name === key,
    );
    if (profile === undefined) return new Response("Missing", { status: 404 });
    if (profile === anonymous && stopped && remainingStopReads-- <= 0)
      profile.running = false;
    return Response.json(profile);
  };
  const profileRequest = async (request: Request, path: string) => {
    if (path === "/profiles" && request.method === "GET")
      return Response.json([...profiles.values()]);
    if (path === "/profiles" && request.method === "POST") {
      const { name } = z
        .object({ name: z.string() })
        .parse(await request.json());
      anonymous = { id: "temporary-id", name, running: false };
      profiles.set(name, anonymous);
      if (options.conflictOnCreate === true)
        return new Response("Another owner created this name", { status: 409 });
      return options.fault === "create"
        ? new Response("Creation response lost", { status: 503 })
        : Response.json(anonymous);
    }
    if (path.startsWith("/profiles/") && request.method === "GET")
      return readProfile(path);
    if (path.endsWith("/start")) {
      if (anonymous === undefined) throw new Error("Fixture profile missing");
      anonymous.running = true;
      return options.fault === "start"
        ? new Response("Start response lost", { status: 503 })
        : Response.json({ instanceId: "owned" });
    }
    return;
  };
  const cleanupRequest = (request: Request, path: string) => {
    if (path === "/profiles/temporary-id/stop") {
      if (options.fault === "stop")
        return new Response("Stop failed", { status: 503 });
      if (anonymous?.running !== true)
        return new Response("No instance", { status: 404 });
      stopped = true;
      return Response.json({ status: "stopped" });
    }
    if (path === "/profiles/temporary-id" && request.method === "DELETE") {
      if (anonymous === undefined || anonymous.running)
        throw new Error("Cannot remove a running or unowned fixture profile");
      if (options.fault === "delete")
        return new Response("Delete failed", { status: 503 });
      profiles.delete(anonymous.name);
      return Response.json({ status: "deleted" });
    }
    return;
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url),
        path = url.pathname;
      calls.push({ method: request.method, path });
      expect(url.searchParams.has("force")).toBe(false);
      const handled =
        (await profileRequest(request, path)) ?? cleanupRequest(request, path);
      if (handled !== undefined) return handled;
      if (path === "/instances")
        return Response.json([
          { id: "signed-in-instance", profileName: persistent.name },
          ...(anonymous?.running === true
            ? [{ id: "owned", profileName: anonymous.name, mode: "headless" }]
            : []),
        ]);
      if (path === "/instances/owned/tabs") return Response.json([]);
      if (path === "/instances/owned/tabs/open")
        return Response.json({ tabId: "page" });
      if (path === "/tabs/page/evaluate") {
        const { expression } = z
          .object({ expression: z.string() })
          .parse(await request.json());
        return Response.json({
          result: evaluationResult(expression),
        });
      }
      if (path === "/tabs/page/snapshot") {
        if (options.cancel === true)
          controller.abort(new Error("Fixture cancellation"));
        return options.fault === "snapshot"
          ? new Response("Snapshot failed", { status: 503 })
          : Response.json({
              idpiNotice: "UNTRUSTED",
              untrustedContent: true,
              nodes: [{ ref: "e1", role: "heading", name: quote }],
            });
      }
      return path === "/tabs/page/screenshot"
        ? new Response(png)
        : new Response("Unexpected fixture route", { status: 500 });
    },
  });
  servers.push(server);
  const input = {
    target: promotionTarget("reddit-mcservers"),
    url: receiptUrl,
    baseUrl: server.url.origin,
    token: "fixture",
    signal: controller.signal,
    expectedQuote: quote,
    saveEvidence: async (bytes: Uint8Array) => {
      expect(bytes).toEqual(png);
      return "fixture.png";
    },
  };
  return { input, profiles, calls, persistent, controller };
}

it("stops and deletes its anonymous profile after successful verification, preserving the signed-in profile", async () => {
  const test = harness({ stopLag: 2 });
  const receipt = await capturePublicRedditReceipt(test.input);
  expect(receipt).toMatchObject({
    url: receiptUrl,
    screenshotKey: "fixture.png",
  });
  expect([...test.profiles.values()]).toEqual([test.persistent]);
  expect(test.calls).toContainEqual({
    method: "POST",
    path: "/profiles/temporary-id/stop",
  });
  expect(test.calls).toContainEqual({
    method: "DELETE",
    path: "/profiles/temporary-id",
  });
  expect(test.calls.some((call) => call.path.includes("signed-in"))).toBe(
    false,
  );
});

it.each(["create", "start", "snapshot"] as const)(
  "cleans up after a failed %s response, even before a tab ID is returned",
  async (fault) => {
    const test = harness({ fault });
    await expect(capturePublicRedditReceipt(test.input)).rejects.toThrow("503");
    expect([...test.profiles.values()]).toEqual([test.persistent]);
    expect(test.calls).toContainEqual({
      method: "DELETE",
      path: "/profiles/temporary-id",
    });
  },
);

it("finishes owned cleanup after task cancellation", async () => {
  const test = harness({ cancel: true });
  await expect(capturePublicRedditReceipt(test.input)).rejects.toThrow(
    /cancellation|abort/i,
  );
  expect(test.controller.signal.aborted).toBe(true);
  expect([...test.profiles.values()]).toEqual([test.persistent]);
});

it("does not reuse or delete an existing profile if its generated name collides", async () => {
  const test = harness({ duplicate: true });
  await expect(capturePublicRedditReceipt(test.input)).rejects.toThrow(
    "already exists",
  );
  expect(test.profiles.size).toBe(2);
  expect(test.calls.every((call) => call.method === "GET")).toBe(true);
});

it("does not remove a profile when creation was definitively rejected", async () => {
  const test = harness({ conflictOnCreate: true });
  await expect(capturePublicRedditReceipt(test.input)).rejects.toThrow("409");
  expect(test.profiles.size).toBe(2);
  expect(
    test.calls.some(
      (call) => call.method === "DELETE" || call.path.endsWith("/stop"),
    ),
  ).toBe(false);
});

it("rejects combining anonymous ownership with a supplied persistent profile", () => {
  const test = harness();
  expect(
    () =>
      new PromotionBrowser(
        test.input.target,
        test.input.baseUrl,
        test.input.token,
        {
          signal: test.input.signal,
          temporaryProfile: true,
          profile: test.persistent.name,
        },
      ),
  ).toThrow("cannot reuse");
  expect(test.calls).toHaveLength(0);
});

it.each(["stop", "delete"] as const)(
  "reports failed %s cleanup without forcibly deleting active profiles",
  async (fault) => {
    const test = harness({ fault });
    await expect(capturePublicRedditReceipt(test.input)).rejects.toThrow(
      "Anonymous browser cleanup",
    );
    expect(test.profiles.get(test.persistent.name)).toEqual(test.persistent);
    expect(test.profiles.size).toBe(2);
    if (fault === "stop")
      expect(test.calls.some((call) => call.method === "DELETE")).toBe(false);
  },
);

it("makes successful disposal idempotent without touching persistent browser lifecycle", async () => {
  const test = harness();
  const browser = new PromotionBrowser(
    test.input.target,
    test.input.baseUrl,
    test.input.token,
    { signal: test.input.signal, temporaryProfile: true },
  );
  await browser.open(receiptUrl);
  await browser.close();
  const requests = test.calls.length;
  await browser.close();
  expect(test.calls).toHaveLength(requests);
  expect([...test.profiles.values()]).toEqual([test.persistent]);
});

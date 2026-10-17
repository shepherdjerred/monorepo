import { afterEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { DefaultTargetViewSchema } from "#shared/editions/target-view.ts";
import { DefaultCommandV2Schema } from "#shared/editions/commands.ts";
import { readTarget, targetCommand, writeTarget } from "./api.ts";
import { retrySubmission, targetMutationOptions } from "./mutation.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

function context(targetVersion: number | null = null) {
  return DefaultTargetViewSchema.parse({
    schemaVersion: 2,
    access: "detail",
    scope: { mediaId: crypto.randomUUID(), edition: "default" },
    expected: { mediaVersion: 4, targetVersion },
    target:
      targetVersion === null
        ? null
        : { generation: 1, availability: "wanted", lineage: "resolved" },
    ownRequests: [],
    allowedProtectiveActions: [],
  });
}
function browser() {
  const data = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  });
  vi.stubGlobal("document", { cookie: "media-csrf=fixture" });
}

test("an observed absent target remains absent in the command and is not created by the read", async () => {
  browser();
  const observed = context();
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(
        Response.json(
          init.method === undefined
            ? observed
            : {
                schemaVersion: 2,
                scope: observed.scope,
                result: { status: "queued", version: 5 },
                appliedVersions: { mediaVersion: 5, targetVersion: 0 },
              },
        ),
      );
    }),
  );
  const read = await readTarget(observed.scope.mediaId);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.init.method).toBeUndefined();
  const result = await writeTarget("actor", read, {
    action: "request",
    subtitleLanguages: ["en"],
    includeSpecials: false,
  });
  const body = DefaultCommandV2Schema.parse(
    JSON.parse(z.string().parse(calls[1]?.init.body)),
  );
  expect(body.expected).toEqual({ mediaVersion: 4, targetVersion: null });
  expect(body.command).not.toHaveProperty("mediaId");
  expect(body.command).not.toHaveProperty("expectedVersion");
  expect(calls[1]?.url).toBe(
    `/api/v2/media/${observed.scope.mediaId}/commands`,
  );
  expect(result.appliedVersions.targetVersion).toBe(0);
});

test("protection-only contexts reject acquisition locally and cannot accept hidden detail fields", async () => {
  const detail = context(2);
  const protection = DefaultTargetViewSchema.parse({
    schemaVersion: 2,
    access: "protection_only",
    scope: detail.scope,
    expected: detail.expected,
    ownRequests: [],
    allowedProtectiveActions: ["keep"],
  });
  expect(targetCommand(protection, { action: "keep" }).expected).toEqual(
    detail.expected,
  );
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(() => writeTarget("actor", protection, { action: "restore" })).toThrow(
    "Library access",
  );
  expect(() =>
    targetCommand(protection, {
      action: "request",
      subtitleLanguages: [],
      includeSpecials: false,
    }),
  ).toThrow("Library access");
  expect(fetch).not.toHaveBeenCalled();
  expect(() =>
    DefaultTargetViewSchema.parse({ ...protection, title: "Hidden title" }),
  ).toThrow();
});

test("a version conflict makes one POST and never reads fresh versions or retries automatically", async () => {
  browser();
  const observed = context(2);
  const fetch = vi.fn(() =>
    Promise.resolve(
      Response.json(
        {
          error: {
            code: "target_version_conflict",
            message: "Review the changed title",
          },
        },
        { status: 409 },
      ),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient();
  const observer = new MutationObserver(client, targetMutationOptions("actor"));
  const statuses: string[] = [];
  const unsubscribe = observer.subscribe((result) => {
    statuses.push(result.status);
  });
  try {
    await expect(
      observer.mutate({ context: observed, command: { action: "keep" } }),
    ).rejects.toThrow("Review the changed title");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe("error");
    expect(observer.getCurrentResult().variables?.context.expected).toEqual(
      observed.expected,
    );
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("lost acknowledgement retries the original observed command after a newer context arrives", async () => {
  browser();
  const original = context(2);
  const calls: { key: string | null; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      calls.push({
        key: new Headers(init.headers).get("Idempotency-Key"),
        body: JSON.parse(z.string().parse(init.body)),
      });
      return calls.length === 1
        ? Promise.reject(new TypeError("Lost response"))
        : Promise.resolve(
            Response.json({
              schemaVersion: 2,
              scope: original.scope,
              result: { status: "completed", version: 5 },
              appliedVersions: { mediaVersion: 5, targetVersion: 3 },
            }),
          );
    }),
  );
  const client = new QueryClient();
  const observer = new MutationObserver(client, targetMutationOptions("actor"));
  const statuses: string[] = [];
  const unsubscribe = observer.subscribe((result) => {
    statuses.push(result.status);
  });
  try {
    await expect(
      observer.mutate({ context: original, command: { action: "keep" } }),
    ).rejects.toThrow("Lost response");
    const later = {
      ...original,
      expected: { mediaVersion: 5, targetVersion: 3 },
    };
    const retry = retrySubmission(observer.getCurrentResult(), {
      context: later,
      command: { action: "pin" },
    });
    await observer.mutate(retry);
    expect(calls).toHaveLength(2);
    expect(statuses.at(-1)).toBe("success");
    expect(calls[1]).toEqual(calls[0]);
    expect(observer.getCurrentResult().data?.appliedVersions).toEqual({
      mediaVersion: 5,
      targetVersion: 3,
    });
  } finally {
    unsubscribe();
    client.clear();
  }
});

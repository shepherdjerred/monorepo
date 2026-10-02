import { expect, test } from "vitest";
import { z } from "zod";
import { applyScoutBetaDurableOwnership } from "./scout-beta-durable-ownership.ts";
import type { FliptFetcher } from "./managed-flag-drift.ts";
import { managedFlagInventory } from "./managed-flag-inventory.ts";

const keys = [
  "initial_match_history_import_enabled",
  "scout_v2_progression_notifications_enabled",
];
function world(
  options: {
    applied?: boolean;
    rules?: unknown[];
    progressionRollouts?: unknown[];
    namespace?: string;
    rejectUpdate?: boolean;
  } = {},
) {
  const requests: { url: string; method: string; body: unknown }[] = [];
  const fetcher: FliptFetcher = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const key = url.split("/").at(-1) ?? "";
    const method = init?.method ?? "GET";
    const body: unknown =
      typeof init?.body === "string" ? JSON.parse(init.body) : null;
    requests.push({ url, method, body });
    if (method === "PUT" && options.rejectUpdate)
      return Response.json({ code: 10 }, { status: 409 });
    if (method === "PUT") {
      const applied = z
        .object({ key: z.string(), payload: z.unknown() })
        .parse(body);
      return Response.json({
        revision: "after",
        resource: {
          namespaceKey: options.namespace ?? "scout",
          key: applied.key,
          payload: applied.payload,
        },
      });
    }
    return Response.json({
      revision: "before",
      resource: {
        namespaceKey: options.namespace ?? "scout",
        key,
        payload: {
          "@type": "flipt.core.Flag",
          key,
          type: "BOOLEAN_FLAG_TYPE",
          enabled: false,
          metadata: options.applied
            ? { scout_beta_durable_ownership_v1: "applied" }
            : { source: "managed" },
          rules: options.rules ?? [],
          rollouts: key === keys[1] ? (options.progressionRollouts ?? []) : [],
        },
      },
    });
  };
  return { requests, fetcher };
}

test("applies only the two declared beta ownership changes with revision checks", async () => {
  const fixture = world();
  expect(
    await applyScoutBetaDurableOwnership({
      url: "http://flipt",
      fetcher: fixture.fetcher,
    }),
  ).toEqual(keys);
  const updates = fixture.requests.filter(
    (request) => request.method === "PUT",
  );
  expect(updates).toHaveLength(2);
  expect(updates[0]?.body).toMatchObject({
    environmentKey: "beta",
    namespaceKey: "scout",
    revision: "before",
    key: keys[0],
    payload: {
      enabled: true,
      metadata: {
        source: "managed",
        scout_beta_durable_ownership_v1: "applied",
      },
    },
  });
  expect(
    fixture.requests.every((request) =>
      request.url.includes("/environments/beta/namespaces/scout/resources"),
    ),
  ).toBe(true);
  for (const key of keys) {
    expect(
      managedFlagInventory.flags.find((flag) => flag.key === key)?.namespace,
    ).toBe("scout");
  }
});
test("preserves the declared guild canary rollout when enabling progression", async () => {
  const rollouts = [
    {
      type: "SEGMENT_ROLLOUT_TYPE",
      description: "Managed guild canary",
      segment: {
        value: true,
        segments: ["scout-guild-1337623164146155593"],
        segmentOperator: "OR_SEGMENT_OPERATOR",
      },
    },
  ];
  const fixture = world({ progressionRollouts: rollouts });
  await applyScoutBetaDurableOwnership({
    url: "http://flipt",
    fetcher: fixture.fetcher,
  });
  expect(
    fixture.requests.filter((request) => request.method === "PUT")[1]?.body,
  ).toMatchObject({ payload: { enabled: true, rollouts } });
});
test("refuses a resource returned from another namespace", async () => {
  const fixture = world({ namespace: "default" });
  await expect(
    applyScoutBetaDurableOwnership({
      url: "http://flipt",
      fetcher: fixture.fetcher,
    }),
  ).rejects.toThrow();
  expect(fixture.requests.every((request) => request.method === "GET")).toBe(
    true,
  );
});
test("does not undo a subsequent operator pause", async () => {
  const fixture = world({ applied: true });
  expect(
    await applyScoutBetaDurableOwnership({
      url: "http://flipt",
      fetcher: fixture.fetcher,
    }),
  ).toEqual([]);
  expect(fixture.requests.every((request) => request.method === "GET")).toBe(
    true,
  );
});
test("refuses unexpected targeting", async () => {
  const fixture = world({ rules: [{ custom: true }] });
  await expect(
    applyScoutBetaDurableOwnership({
      url: "http://flipt",
      fetcher: fixture.fetcher,
    }),
  ).rejects.toThrow("Unexpected targeting");
  expect(fixture.requests.every((request) => request.method === "GET")).toBe(
    true,
  );
});
test("a concurrent revision change aborts the rollout instead of overwriting it", async () => {
  const fixture = world({ rejectUpdate: true });
  await expect(
    applyScoutBetaDurableOwnership({
      url: "http://flipt",
      fetcher: fixture.fetcher,
    }),
  ).rejects.toThrow("HTTP 409");
  expect(
    fixture.requests.filter((request) => request.method === "PUT"),
  ).toHaveLength(1);
});

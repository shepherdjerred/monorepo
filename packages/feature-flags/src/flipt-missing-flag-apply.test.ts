import { describe, expect, test } from "vitest";
import { z } from "zod";
import { ManagedFlagInventorySchema } from "./managed-flag-inventory.ts";
import {
  applyMissingManagedFlags,
  planMissingFliptResources,
} from "./flipt-missing-flag-apply.ts";

const inventory = ManagedFlagInventorySchema.parse({
  version: 3,
  namespaces: [{ key: "test", name: "Test", description: "Test namespace." }],
  environments: [
    { key: "beta", overrides: [] },
    { key: "prod", overrides: [] },
  ],
  flags: [
    {
      key: "new-flag",
      owner: "test",
      namespace: "test",
      source: "test",
      purpose: "Create this flag.",
      type: "boolean",
      default: false,
      rollouts: [
        {
          segmentKey: "operators",
          segmentOperator: "OR_SEGMENT_OPERATOR",
          matchType: "ALL_SEGMENT_MATCH_TYPE",
          constraints: [
            {
              type: "STRING_CONSTRAINT_COMPARISON_TYPE",
              property: "role",
              operator: "eq",
              value: "operator",
            },
          ],
          result: true,
        },
      ],
      rules: [],
      thresholdRollouts: [],
    },
    {
      key: "existing-flag",
      owner: "test",
      namespace: "test",
      source: "test",
      purpose: "Already present.",
      type: "boolean",
      default: true,
      rollouts: [],
      rules: [],
      thresholdRollouts: [],
    },
  ],
  exemptions: [],
});

const namespace = inventory.namespaces[0];
if (namespace === undefined) throw new Error("test namespace is missing");

describe("planMissingFliptResources", () => {
  test("creates missing namespaces, segments, and flags without touching existing keys", () => {
    const plan = planMissingFliptResources({
      namespace,
      expectedFlags: inventory.flags,
      existingNamespaceKeys: new Set(),
      existingFlagKeys: new Set(["existing-flag"]),
      existingSegmentKeys: new Set(),
    });
    expect(plan.map((item) => `${item.kind}:${item.key}`)).toEqual([
      "namespace:test",
      "segment:operators",
      "flag:new-flag",
    ]);
  });

  test("returns nothing when the namespace, flags, and segments already exist", () => {
    expect(
      planMissingFliptResources({
        namespace,
        expectedFlags: inventory.flags,
        existingNamespaceKeys: new Set(["test"]),
        existingFlagKeys: new Set(["new-flag", "existing-flag"]),
        existingSegmentKeys: new Set(["operators"]),
      }),
    ).toEqual([]);
  });

  test("creates a missing segment even when every flag already exists", () => {
    const plan = planMissingFliptResources({
      namespace,
      expectedFlags: inventory.flags,
      existingNamespaceKeys: new Set(["test"]),
      existingFlagKeys: new Set(["new-flag", "existing-flag"]),
      existingSegmentKeys: new Set(),
    });
    expect(plan.map((item) => `${item.kind}:${item.key}`)).toEqual([
      "segment:operators",
    ]);
  });

  test("reuses an existing segment instead of recreating it", () => {
    const plan = planMissingFliptResources({
      namespace,
      expectedFlags: inventory.flags,
      existingNamespaceKeys: new Set(["test"]),
      existingFlagKeys: new Set(["existing-flag"]),
      existingSegmentKeys: new Set(["operators"]),
    });
    expect(plan.map((item) => `${item.kind}:${item.key}`)).toEqual([
      "flag:new-flag",
    ]);
  });
});

async function applyBetaTest(
  fetcher: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
) {
  return applyMissingManagedFlags({
    url: "https://flipt.example",
    inventory,
    environmentFilter: "beta",
    namespaceFilter: "test",
    fetcher,
  });
}

function createdKey(init: RequestInit | undefined): string {
  const parsed = z
    .object({
      key: z.string().optional(),
      payload: z.object({ key: z.string().optional() }).optional(),
    })
    .parse(JSON.parse(requestBody(init)));
  const key = parsed.payload?.key ?? parsed.key;
  if (key === undefined) throw new Error("create is missing a key");
  return key;
}

describe("applyMissingManagedFlags", () => {
  test("posts missing segments then flags and records created keys", async () => {
    const posts: string[] = [];
    const result = await applyBetaTest(async (input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      if (method === "GET" && url.endsWith("/namespaces")) {
        return json({ items: [{ key: "test" }], revision: "rev-1" });
      }
      if (method === "GET" && url.includes("flipt.core.Flag")) {
        return json({
          resources: [{ namespaceKey: "test", key: "existing-flag" }],
          revision: "rev-1",
        });
      }
      if (method === "GET" && url.includes("flipt.core.Segment")) {
        return json({ resources: [], revision: "rev-1" });
      }
      if (method === "POST") {
        const key = createdKey(init);
        posts.push(`${url} ${key}`);
        return json(
          {
            resource: { namespaceKey: "test", key },
            revision: `rev-${posts.length.toString()}`,
          },
          200,
        );
      }
      throw new Error(`unexpected request ${method} ${url}`);
    });

    expect(posts).toEqual([
      "https://flipt.example/api/v2/environments/beta/namespaces/test/resources operators",
      "https://flipt.example/api/v2/environments/beta/namespaces/test/resources new-flag",
    ]);
    expect(result).toEqual([
      {
        environment: "beta",
        namespace: "test",
        createdNamespaces: [],
        createdSegments: ["operators"],
        createdFlags: ["new-flag"],
      },
    ]);
  });

  test("treats already-exists as success without updating the resource", async () => {
    const result = await applyBetaTest(async (input, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && requestUrl(input).endsWith("/namespaces")) {
        return json({ items: [{ key: "test" }], revision: "rev-1" });
      }
      if (method === "GET") {
        return json({
          resources: [{ namespaceKey: "test", key: "existing-flag" }],
          revision: "rev-2",
        });
      }
      return json(
        {
          code: 6,
          message: 'create resource "flipt.core.Flag/test/new-flag"',
        },
        409,
      );
    });
    expect(result[0]?.createdFlags).toEqual([]);
    expect(result[0]?.createdSegments).toEqual([]);
  });

  test("creates a missing namespace before listing its resources", async () => {
    const methods: string[] = [];
    let namespaceExists = false;
    const result = await applyBetaTest(async (input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      methods.push(`${method} ${url}`);
      if (method === "GET" && url.endsWith("/namespaces")) {
        return json({
          items: namespaceExists ? [{ key: "test" }] : [],
          revision: "rev-1",
        });
      }
      if (method === "POST" && url.endsWith("/namespaces")) {
        namespaceExists = true;
        return json(
          {
            resource: { namespaceKey: "test", key: "test" },
            revision: "rev-2",
          },
          200,
        );
      }
      if (!namespaceExists) {
        throw new Error(`listed resources before creating namespace: ${url}`);
      }
      if (method === "GET") {
        return json({ resources: [], revision: "rev-2" });
      }
      const key = createdKey(init);
      return json(
        { resource: { namespaceKey: "test", key }, revision: "rev-3" },
        200,
      );
    });
    expect(methods[0]).toBe(
      "GET https://flipt.example/api/v2/environments/beta/namespaces",
    );
    expect(methods[1]).toBe(
      "POST https://flipt.example/api/v2/environments/beta/namespaces",
    );
    expect(result[0]?.createdNamespaces).toEqual(["test"]);
  });
});

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestBody(init: RequestInit | undefined): string {
  if (init?.body === undefined) return "{}";
  if (typeof init.body === "string") return init.body;
  throw new Error("test fetcher expected a string body");
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

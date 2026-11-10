import { expect, test } from "vitest";
import { z } from "zod";
import { applyDeclaredManagedFlags } from "./flipt-declared-flag-apply.ts";
import { ManagedFlagInventorySchema } from "./managed-flag-inventory.ts";
import type { FliptFetcher } from "./managed-flag-drift.ts";
import {
  collectManagedSegmentPayloads,
  toFliptFlagPayload,
} from "./flipt-resource-payloads.ts";

const inventory = ManagedFlagInventorySchema.parse({
  version: 3,
  namespaces: [{ key: "test", name: "Test", description: "Test" }],
  environments: [{ key: "prod", overrides: [] }],
  exemptions: [],
  flags: ["first", "second"].map((key) => ({
    key,
    owner: "test",
    namespace: "test",
    source: "test",
    purpose: "test",
    type: "boolean",
    default: true,
    rollouts: [],
    rules: [],
    thresholdRollouts: [],
  })),
});
const WriteSchema = z.object({
  key: z.string(),
  revision: z.string(),
  payload: z.looseObject({ key: z.string(), enabled: z.boolean() }),
});

function server(
  options: {
    conflictAt?: number;
    lostWrite?: boolean;
    readbackConflict?: boolean;
    missing?: string;
    wrongNamespace?: boolean;
  } = {},
) {
  let revision = 0;
  const payloads = new Map<string, unknown>(
    ["first", "second", "unrelated"].map((key) => [
      key,
      {
        "@type": "flipt.core.Flag",
        key,
        type: "BOOLEAN_FLAG_TYPE",
        enabled: false,
        name: "Operator title",
        rules: [],
        rollouts: [{ segment: "existing-target" }],
        metadata: { incident: "retained" },
      },
    ]),
  );
  const writes: z.infer<typeof WriteSchema>[] = [];
  const fetcher: FliptFetcher = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const key = url.pathname.split("/").at(-1);
    if (init?.method === "PUT") {
      if (typeof init.body !== "string")
        throw new TypeError("Expected a JSON request body");
      const body = WriteSchema.parse(JSON.parse(init.body));
      expect(body.revision).toBe(`r${String(revision)}`);
      writes.push(body);
      if (options.conflictAt === writes.length)
        return Response.json({ code: 10 }, { status: 409 });
      revision++;
      if (!options.lostWrite) payloads.set(body.key, body.payload);
      const response = Response.json({
        resource: {
          key: body.key,
          namespaceKey: "test",
          payload: body.payload,
        },
        revision: `r${String(revision)}`,
      });
      if (options.readbackConflict) revision++;
      return response;
    }
    if (key === options.missing) return Response.json({}, { status: 404 });
    return Response.json({
      resource: {
        key,
        namespaceKey: options.wrongNamespace ? "wrong" : "test",
        payload: payloads.get(key ?? ""),
      },
      revision: `r${String(revision)}`,
    });
  };
  return { fetcher, writes, payloads };
}
const scope = {
  url: "https://flipt.example",
  environment: "prod",
  namespace: "test",
  flagKeys: ["first", "second"],
  inventory,
};

test("preview has complete before-images and makes no writes", async () => {
  const s = server();
  const result = await applyDeclaredManagedFlags({
    ...scope,
    mode: "plan",
    fetcher: s.fetcher,
  });
  expect(s.writes).toEqual([]);
  expect(result.changes.map((c) => c.status)).toEqual(["planned", "planned"]);
  expect(result.changes[0]?.before).toMatchObject({
    enabled: false,
    name: "Operator title",
    metadata: { incident: "retained" },
  });
  expect(result.changes[0]?.after).toMatchObject({
    enabled: true,
    rollouts: [],
    name: "Operator title",
    metadata: { incident: "retained" },
  });
});

test("applies selected keys only, verifies readback and is idempotent", async () => {
  const s = server();
  const unrelated = structuredClone(s.payloads.get("unrelated"));
  let previewed = false;
  const result = await applyDeclaredManagedFlags({
    ...scope,
    mode: "apply",
    fetcher: s.fetcher,
    onPlan: () => {
      expect(s.writes).toHaveLength(0);
      previewed = true;
    },
  });
  expect(previewed).toBe(true);
  expect(result.changes.map((c) => c.status)).toEqual(["applied", "applied"]);
  expect(s.payloads.get("unrelated")).toEqual(unrelated);
  expect(s.writes.map((w) => w.revision)).toEqual(["r0", "r1"]);
  const second = await applyDeclaredManagedFlags({
    ...scope,
    mode: "apply",
    fetcher: s.fetcher,
  });
  expect(second.changes.map((c) => c.status)).toEqual([
    "unchanged",
    "unchanged",
  ]);
  expect(s.writes).toHaveLength(2);
});

test("all selection and identity validation precedes mutations", async () => {
  for (const flagKeys of [[], ["first", "first"], ["unknown"]]) {
    const s = server();
    await expect(
      applyDeclaredManagedFlags({
        ...scope,
        flagKeys,
        mode: "apply",
        fetcher: s.fetcher,
      }),
    ).rejects.toThrow();
    expect(s.writes).toHaveLength(0);
  }
  for (const options of [{ missing: "second" }, { wrongNamespace: true }]) {
    const s = server(options);
    await expect(
      applyDeclaredManagedFlags({
        ...scope,
        mode: "apply",
        fetcher: s.fetcher,
      }),
    ).rejects.toThrow();
    expect(s.writes).toHaveLength(0);
  }
});

test("a later conflict reports partial completion and never retries the write", async () => {
  const s = server({ conflictAt: 2 });
  const result = await applyDeclaredManagedFlags({
    ...scope,
    mode: "apply",
    fetcher: s.fetcher,
  });
  expect(result.changes.map((c) => c.status)).toEqual(["applied", "conflict"]);
  expect(s.writes).toHaveLength(2);
});

test("readback mismatch and concurrent revision changes stop subsequent writes", async () => {
  for (const [options, status] of [
    [{ lostWrite: true }, "failed"],
    [{ readbackConflict: true }, "conflict"],
  ] as const) {
    const s = server(options);
    const result = await applyDeclaredManagedFlags({
      ...scope,
      mode: "apply",
      fetcher: s.fetcher,
    });
    expect(result.changes.map((c) => c.status)).toEqual([status, "planned"]);
    expect(s.writes).toHaveLength(1);
  }
});

const targetedInventory = ManagedFlagInventorySchema.parse({
  ...inventory,
  flags: inventory.flags.map((flag) =>
    flag.key === "second"
      ? {
          ...flag,
          default: false,
          rollouts: [
            {
              segmentKey: "audience",
              segmentOperator: "OR_SEGMENT_OPERATOR",
              matchType: "ALL_SEGMENT_MATCH_TYPE",
              constraints: [
                {
                  type: "STRING_CONSTRAINT_COMPARISON_TYPE",
                  property: "stage",
                  operator: "eq",
                  value: "beta",
                },
              ],
              result: true,
            },
          ],
        }
      : flag,
  ),
});

test("missing, changed and concurrently edited audiences fail before the first write", async () => {
  const expected = collectManagedSegmentPayloads(targetedInventory.flags)[0];
  if (expected === undefined) throw new Error("Missing fixture segment");
  for (const failure of ["missing", "changed", "revision", "identity"]) {
    const s = server({
      missing: failure === "missing" ? "audience" : "absent",
    });
    s.payloads.set("audience", {
      ...expected,
      constraints: expected.constraints.map((constraint) => ({
        ...constraint,
        value: failure === "changed" ? "prod" : "beta",
      })),
    });
    const fetcher: FliptFetcher = async (input, init) => {
      const response = await s.fetcher(input, init);
      const url = new URL(input instanceof Request ? input.url : input);
      if (failure === "revision" && url.pathname.includes("flipt.core.Segment"))
        return Response.json({
          resource: {
            namespaceKey: "test",
            key: "audience",
            payload: expected,
          },
          revision: "newer",
        });
      if (failure === "identity" && url.pathname.includes("flipt.core.Segment"))
        return Response.json({
          resource: {
            namespaceKey: "wrong",
            key: "audience",
            payload: expected,
          },
          revision: "r0",
        });
      return response;
    };
    await expect(
      applyDeclaredManagedFlags({
        ...scope,
        inventory: targetedInventory,
        fetcher,
        mode: "apply",
      }),
    ).rejects.toThrow();
    expect(s.writes).toHaveLength(0);
  }
});

test("shared audience preflight still runs when selected flag payloads are unchanged", async () => {
  const expected = collectManagedSegmentPayloads(targetedInventory.flags)[0];
  if (expected === undefined) throw new Error("Missing fixture segment");
  const s = server();
  s.payloads.set("audience", {
    ...expected,
    name: "Operator-owned title",
    description: "Preserved",
  });
  const result = await applyDeclaredManagedFlags({
    ...scope,
    inventory: targetedInventory,
    fetcher: s.fetcher,
    mode: "apply",
  });
  expect(result.changes.map((change) => change.status)).toEqual([
    "applied",
    "applied",
  ]);
  expect(s.writes.map((write) => write.key)).toEqual(["first", "second"]);
  s.payloads.set("audience", { ...expected, constraints: [] });
  await expect(
    applyDeclaredManagedFlags({
      ...scope,
      inventory: targetedInventory,
      fetcher: s.fetcher,
      mode: "apply",
    }),
  ).rejects.toThrow("Rollout segment behavior differs");
  expect(s.writes).toHaveLength(2);
});

const variantInventory = ManagedFlagInventorySchema.parse({
  ...inventory,
  flags: [
    ...inventory.flags,
    {
      key: "settings",
      owner: "test",
      namespace: "test",
      source: "test",
      purpose: "test",
      type: "variant",
      default: '{"enabledTargets":["pmc"]}',
      rollouts: [],
      rules: [],
      thresholdRollouts: [],
    },
  ],
});
function variantServer(options: Parameters<typeof server>[0] = {}) {
  const s = server(options);
  const flag = variantInventory.flags.find(
    (candidate) => candidate.key === "settings",
  );
  if (flag?.type !== "variant") throw new Error("Missing variant fixture");
  s.payloads.set("settings", {
    ...toFliptFlagPayload({ ...flag, default: '{"enabledTargets":[]}' }),
    name: "Operator title",
    metadata: { incident: "retained" },
  });
  return s;
}

test("plans and applies complete variant settings with revision-guarded idempotence", async () => {
  const s = variantServer();
  const selected = {
    ...scope,
    inventory: variantInventory,
    flagKeys: ["settings", "first"],
  };
  const plan = await applyDeclaredManagedFlags({
    ...selected,
    mode: "plan",
    fetcher: s.fetcher,
  });
  expect(s.writes).toHaveLength(0);
  expect(plan.changes[0]?.after).toMatchObject({
    type: "VARIANT_FLAG_TYPE",
    enabled: true,
    defaultVariant: '{"enabledTargets":["pmc"]}',
    variants: [{ key: '{"enabledTargets":["pmc"]}', attachment: {} }],
    name: "Operator title",
    metadata: { incident: "retained" },
  });
  const result = await applyDeclaredManagedFlags({
    ...selected,
    mode: "apply",
    fetcher: s.fetcher,
  });
  expect(result.changes.map((change) => change.status)).toEqual([
    "applied",
    "applied",
  ]);
  expect(s.writes.map((write) => write.revision)).toEqual(["r0", "r1"]);
  const again = await applyDeclaredManagedFlags({
    ...selected,
    mode: "apply",
    fetcher: s.fetcher,
  });
  expect(again.changes.map((change) => change.status)).toEqual([
    "unchanged",
    "unchanged",
  ]);
  expect(s.writes).toHaveLength(2);
});

test("variant type mismatches and malformed payloads abort the whole selection before writing", async () => {
  const rankedRule = {
    rank: 1,
    segmentOperator: "OR_SEGMENT_OPERATOR",
    segments: [],
    distributions: [{ variant: "same", rollout: 100 }],
  };
  for (const payload of [
    { type: "BOOLEAN_FLAG_TYPE", enabled: false, rules: [], rollouts: [] },
    { type: "UNKNOWN_FLAG_TYPE" },
    {
      type: "VARIANT_FLAG_TYPE",
      defaultVariant: "missing",
      variants: [{ key: "other" }],
    },
    {
      type: "VARIANT_FLAG_TYPE",
      defaultVariant: "same",
      variants: [{ key: "same" }, { key: "same" }],
    },
    {
      type: "VARIANT_FLAG_TYPE",
      defaultVariant: "same",
      variants: [{ key: "same", attachment: [] }],
    },
    {
      type: "VARIANT_FLAG_TYPE",
      defaultVariant: "same",
      variants: [{ key: "same" }],
      rules: [
        {
          rank: 1,
          segmentOperator: "UNKNOWN",
          segments: [],
          distributions: [],
        },
      ],
    },
    ...[
      [{ ...rankedRule, rank: 0 }],
      [rankedRule, rankedRule],
      [{ ...rankedRule, rank: 2 }],
    ].map((rules) => ({
      type: "VARIANT_FLAG_TYPE",
      defaultVariant: "same",
      variants: [{ key: "same" }],
      rules,
    })),
  ]) {
    const s = variantServer();
    s.payloads.set("settings", {
      "@type": "flipt.core.Flag",
      key: "settings",
      ...payload,
    });
    await expect(
      applyDeclaredManagedFlags({
        ...scope,
        inventory: variantInventory,
        flagKeys: ["first", "settings"],
        mode: "apply",
        fetcher: s.fetcher,
      }),
    ).rejects.toThrow();
    expect(s.writes).toHaveLength(0);
  }
});

test("a variant readback mismatch or conflict stops subsequent boolean writes", async () => {
  for (const [options, status] of [
    [{ lostWrite: true }, "failed"],
    [{ readbackConflict: true }, "conflict"],
    [{ conflictAt: 1 }, "conflict"],
  ] as const) {
    const s = variantServer(options);
    const result = await applyDeclaredManagedFlags({
      ...scope,
      inventory: variantInventory,
      flagKeys: ["settings", "first"],
      mode: "apply",
      fetcher: s.fetcher,
    });
    expect(result.changes.map((change) => change.status)).toEqual([
      status,
      "planned",
    ]);
    expect(s.writes).toHaveLength(1);
  }
});

test("variant attachments and distribution rules require an aligned shared audience", async () => {
  const audience = targetedInventory.flags.find((flag) => flag.key === "second")
    ?.rollouts[0];
  if (audience === undefined) throw new Error("Missing audience fixture");
  const targeted = ManagedFlagInventorySchema.parse({
    ...variantInventory,
    flags: variantInventory.flags.map((flag) =>
      flag.key === "settings"
        ? {
            ...flag,
            rules: [
              {
                rank: 1,
                segmentOperator: "OR_SEGMENT_OPERATOR",
                segments: [
                  {
                    key: audience.segmentKey,
                    matchType: audience.matchType,
                    constraints: audience.constraints,
                  },
                ],
                distributions: [
                  {
                    variantKey: "targeted",
                    rollout: 100,
                    variantAttachment:
                      '{"enabledTargets":["pmc","reddit-mcservers"]}',
                  },
                ],
              },
            ],
          }
        : flag,
    ),
  });
  const segment = collectManagedSegmentPayloads(targeted.flags)[0];
  if (segment === undefined)
    throw new Error("Missing variant audience fixture");
  const s = variantServer();
  s.payloads.set("audience", { ...segment, constraints: [] });
  const selected = {
    ...scope,
    inventory: targeted,
    flagKeys: ["first", "settings"],
    mode: "apply" as const,
    fetcher: s.fetcher,
  };
  await expect(applyDeclaredManagedFlags(selected)).rejects.toThrow(
    "segment behavior differs",
  );
  expect(s.writes).toHaveLength(0);
  s.payloads.set("audience", segment);
  const result = await applyDeclaredManagedFlags(selected);
  expect(result.changes.map((change) => change.status)).toEqual([
    "applied",
    "applied",
  ]);
  expect(result.changes[1]?.after).toMatchObject({
    variants: expect.arrayContaining([
      {
        key: "targeted",
        name: "targeted",
        description: "",
        attachment: { enabledTargets: ["pmc", "reddit-mcservers"] },
      },
    ]),
    rules: [
      {
        rank: 1,
        segments: ["audience"],
        distributions: [{ variant: "targeted", rollout: 100 }],
      },
    ],
    metadata: { incident: "retained" },
  });
});

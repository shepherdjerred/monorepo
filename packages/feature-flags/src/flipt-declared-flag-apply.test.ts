import { expect, test } from "vitest";
import { z } from "zod";
import { applyDeclaredManagedFlags } from "./flipt-declared-flag-apply.ts";
import { ManagedFlagInventorySchema } from "./managed-flag-inventory.ts";
import type { FliptFetcher } from "./managed-flag-drift.ts";

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

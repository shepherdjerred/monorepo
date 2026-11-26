import { describe, expect, test } from "vitest";
import { z } from "zod";
import { FlagsDiffResponseSchema } from "@shepherdjerred/feature-flags/flags-drift.ts";
import { createFlagsApp } from "./app.ts";
import { FlagStore } from "./store.ts";

const auth = {
  machineToken: "machine-secret",
  operatorLogins: ["operator@example.com"],
  trustedProxyAddresses: ["100.64.0.1"],
  publicOrigin: "https://flags.example.test",
};

const jsonHeaders = {
  authorization: "Bearer machine-secret",
  "content-type": "application/json",
};

const InvalidValues = z.strictObject({
  error: z.literal("invalid flag values"),
  issues: z.array(
    z.strictObject({
      key: z.string(),
      path: z.string(),
      message: z.string().min(1),
    }),
  ),
});

function harness() {
  const store = FlagStore.open(":memory:");
  store.seedFromInventory();
  const app = createFlagsApp({ store, auth, peerAddress: () => null });
  return { app, store };
}

function revision(store: FlagStore, id: string): number {
  const document = store.document(id);
  if (document === undefined) throw new Error(`${id} missing`);
  return document.revision;
}

async function post(
  app: ReturnType<typeof createFlagsApp>,
  path: string,
  body: unknown,
) {
  return await app.request(path, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
}

describe("apply validation", () => {
  test("rejects an out-of-range variant with a 400 and writes nothing", async () => {
    const { app, store } = harness();
    const before = store.document("delivery/prod");
    if (before === undefined) throw new Error("delivery/prod missing");
    const response = await post(app, "/v1/deployments/delivery/prod/apply", {
      expectedRevision: before.revision,
      flags: [
        { type: "variant", key: "delivery-executor-concurrency", value: "2" },
        { type: "variant", key: "delivery-lease-seconds", value: "30" },
      ],
    });
    expect(response.status).toBe(400);
    expect(InvalidValues.parse(await response.json()).issues).toEqual([
      {
        key: "delivery-lease-seconds",
        path: "",
        message: "Too small: expected number to be >=60",
      },
    ]);
    expect(store.document("delivery/prod")).toEqual(before);
  });

  test("names nested JSON paths", async () => {
    const { app, store } = harness();
    const response = await post(app, "/v1/deployments/delivery/prod/apply", {
      expectedRevision: revision(store, "delivery/prod"),
      flags: [
        {
          type: "variant",
          key: "delivery-enabled-environments",
          value: '["delivery/prod",""]',
        },
      ],
    });
    expect(response.status).toBe(400);
    const body = InvalidValues.parse(await response.json());
    expect(body.issues.map(({ key, path }) => ({ key, path }))).toEqual([
      { key: "delivery-enabled-environments", path: "/1" },
    ]);
  });

  test("rejects undeclared keys and declared-type mismatches", async () => {
    const { app, store } = harness();
    const response = await post(app, "/v1/deployments/scout/prod/apply", {
      expectedRevision: revision(store, "scout/prod"),
      flags: [
        {
          type: "boolean",
          key: "not-in-inventory",
          default: true,
          rollouts: [],
        },
        { type: "variant", key: "dares_enabled", value: "true" },
      ],
    });
    expect(response.status).toBe(400);
    expect(InvalidValues.parse(await response.json()).issues).toEqual([
      {
        key: "not-in-inventory",
        path: "",
        message: "flag is not declared in managed-flag-inventory.json",
      },
      {
        key: "dares_enabled",
        path: "",
        message: "flag is declared as boolean, got variant",
      },
    ]);
    expect(store.flag("scout/prod", "not-in-inventory")).toBeUndefined();
  });

  test("validation precedes the revision check; a valid stale write still conflicts", async () => {
    const { app, store } = harness();
    const current = revision(store, "delivery/prod");
    const invalid = await post(app, "/v1/deployments/delivery/prod/apply", {
      expectedRevision: current + 5,
      flags: [{ type: "variant", key: "delivery-lease-seconds", value: "30" }],
    });
    expect(invalid.status).toBe(400);
    const stale = await post(app, "/v1/deployments/delivery/prod/apply", {
      expectedRevision: current + 5,
      flags: [{ type: "variant", key: "delivery-lease-seconds", value: "600" }],
    });
    expect(stale.status).toBe(409);
    expect(revision(store, "delivery/prod")).toBe(current);
  });

  test("accepts a valid variant value", async () => {
    const { app, store } = harness();
    const current = revision(store, "delivery/prod");
    const response = await post(app, "/v1/deployments/delivery/prod/apply", {
      expectedRevision: current,
      flags: [{ type: "variant", key: "delivery-lease-seconds", value: "600" }],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: current + 1 });
    expect(store.flag("delivery/prod", "delivery-lease-seconds")?.flag).toEqual(
      { type: "variant", key: "delivery-lease-seconds", value: "600" },
    );
  });
});

describe("create-missing validation", () => {
  test("one invalid entry refuses the whole batch", async () => {
    const { app, store } = harness();
    const before = store.document("scout/prod");
    if (before === undefined) throw new Error("scout/prod missing");
    const response = await post(
      app,
      "/v1/deployments/scout/prod/create-missing",
      {
        flags: [
          {
            type: "boolean",
            key: "delivery-writes-enabled",
            default: false,
            rollouts: [],
          },
          { type: "variant", key: "mail-settings", value: "{" },
        ],
      },
    );
    expect(response.status).toBe(400);
    const body = InvalidValues.parse(await response.json());
    expect(body.issues.map(({ key }) => key)).toEqual(["mail-settings"]);
    expect(store.document("scout/prod")).toEqual(before);
  });
});

describe("diff reports invalid live values", () => {
  test("lists a seeded bad value without failing the request", async () => {
    const store = FlagStore.open(":memory:");
    store.seedDocuments([
      {
        id: "delivery/prod",
        flags: [
          { type: "variant", key: "delivery-lease-seconds", value: "30" },
        ],
      },
    ]);
    store.seedFromInventory();
    const app = createFlagsApp({ store, auth, peerAddress: () => null });
    const response = await app.request("/v1/diff", {
      headers: { authorization: "Bearer machine-secret" },
    });
    expect(response.status).toBe(200);
    const diff = FlagsDiffResponseSchema.parse(await response.json());
    const delivery = diff.deployments.find(
      (deployment) => deployment.id === "delivery/prod",
    );
    expect(delivery?.invalid).toEqual([
      {
        key: "delivery-lease-seconds",
        value: "30",
        issues: [
          { path: "", message: "Too small: expected number to be >=60" },
        ],
      },
    ]);
    for (const deployment of diff.deployments) {
      if (deployment.id !== "delivery/prod") {
        expect(deployment.invalid).toEqual([]);
      }
    }
  });
});

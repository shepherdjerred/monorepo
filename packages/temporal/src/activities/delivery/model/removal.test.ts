import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { removeDeliveryTargets, type RemovalEffects } from "./removal.ts";

function effects(live: Record<string, unknown>) {
  const calls: string[] = [];
  const removal = {
    removals: [
      {
        environmentId: "arcade/prod",
        applications: [
          { name: "arcade", lifecycle: "cascade" },
          { name: "arcade-worker", lifecycle: "retain" },
        ],
      },
    ],
  };
  const value: RemovalEffects = {
    request: async <T>(path: string, schema: z.ZodType<T>, body?: unknown) => {
      calls.push(body === undefined ? `GET ${path}` : `POST ${path}`);
      return schema.parse(body === undefined ? removal : {});
    },
    read: async (name: string) => {
      await Promise.resolve();
      return live[name] ?? null;
    },
    remove: async (
      name: string,
      input: { environmentId: string; cascade: boolean },
    ) => {
      calls.push(`delete ${name} cascade=${String(input.cascade)}`);
      await Promise.resolve();
      return { deleted: true };
    },
  };
  return { calls, value };
}

describe("removed environment targets (4.10)", () => {
  it("deletes each owned Application by its lifecycle and records nothing while any remains", async () => {
    const { calls, value } = effects({
      arcade: { metadata: {} },
      "arcade-worker": { metadata: { deletionTimestamp: "now" } },
    });
    expect(await removeDeliveryTargets(value)).toEqual({ removed: 0 });
    expect(calls).toEqual(["GET removals", "delete arcade cascade=true"]);
  });

  it("records the removal once every Application is gone", async () => {
    const { calls, value } = effects({});
    expect(await removeDeliveryTargets(value)).toEqual({ removed: 1 });
    expect(calls).toEqual([
      "GET removals",
      "POST environments/arcade%2Fprod/removed",
    ]);
  });
});

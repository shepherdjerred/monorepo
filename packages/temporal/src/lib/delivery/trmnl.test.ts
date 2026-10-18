import { expect, test, vi } from "vitest";
import {
  TRMNL_PLUGIN_POLICY,
  TrmnlPluginBundleSchema,
} from "@shepherdjerred/ops-model/trmnl/plugin-policy.ts";
import { configureTrmnlPlugins } from "./trmnl.ts";

test("partial plugin writes keep a durable running intent; exact later repair inspects stored bytes and never republishes settled resources", async () => {
  const bundle = TrmnlPluginBundleSchema.parse({
    schema: "delivery-trmnl-plugins/v1",
    sourceRevision: "a".repeat(40),
    plugins: TRMNL_PLUGIN_POLICY.plugins.map((target) => ({
      ...target,
      files: Object.fromEntries(
        TRMNL_PLUGIN_POLICY.files.map((name) => [
          name,
          name === "settings.yml"
            ? `id: ${String(target.id)}\n`
            : "selected template",
        ]),
      ),
    })),
  });
  const stored = new Set<number>();
  const stages: string[] = [];
  let lost = true;
  const fence = vi.fn(() => Promise.resolve());
  const effects = {
    client: {
      matches: async (plugin: (typeof bundle.plugins)[number]) =>
        stored.has(plugin.id),
      publish: vi.fn(async (plugin: (typeof bundle.plugins)[number]) => {
        expect(fence).toHaveBeenCalled();
        expect(stages.at(-1)).toBe(`${String(plugin.id)}:running`);
        stored.add(plugin.id);
        if (lost)
          throw new Error("Lost HTTP response after exact resource update");
      }),
    },
    stage: async (id: number, status: "running" | "succeeded") => {
      stages.push(`${String(id)}:${status}`);
    },
    fence,
    signal: new AbortController().signal,
  };
  await expect(configureTrmnlPlugins(bundle, effects)).rejects.toThrow(
    "Lost HTTP response",
  );
  expect(stages).toEqual([`${String(bundle.plugins[0]!.id)}:running`]);
  lost = false;
  await configureTrmnlPlugins(bundle, effects);
  expect(effects.client.publish).toHaveBeenCalledTimes(3);
  expect(stages.filter((stage) => stage.endsWith(":succeeded"))).toHaveLength(
    3,
  );
  const denied = vi.fn(async () => {
    throw new Error("Claim generation changed");
  });
  stored.clear();
  const writesBefore = effects.client.publish.mock.calls.length;
  await expect(
    configureTrmnlPlugins(bundle, { ...effects, fence: denied }),
  ).rejects.toThrow("generation changed");
  expect(effects.client.publish).toHaveBeenCalledTimes(writesBefore);
});

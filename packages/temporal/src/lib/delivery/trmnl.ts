import type { TrmnlPluginBundle } from "@shepherdjerred/ops-model/trmnl/plugin-policy.ts";
import type { createTrmnlPluginClient } from "@shepherdjerred/ops-clients/trmnl.ts";

/** Fixed resource overwrites are inspected before repetition; an ambiguous response keeps its running stage. */
export async function configureTrmnlPlugins(
  bundle: TrmnlPluginBundle,
  effects: {
    client: ReturnType<typeof createTrmnlPluginClient>;
    stage: (id: number, status: "running" | "succeeded") => Promise<void>;
    fence: () => Promise<void>;
    signal: AbortSignal;
  },
) {
  for (const plugin of bundle.plugins) {
    effects.signal.throwIfAborted();
    if (!(await effects.client.matches(plugin))) {
      await effects.stage(plugin.id, "running");
      await effects.fence();
      effects.signal.throwIfAborted();
      await effects.client.publish(plugin);
      if (!(await effects.client.matches(plugin)))
        throw new Error(
          "TRMNL dependency readback differs after publication; retain ownership",
        );
    }
    await effects.stage(plugin.id, "succeeded");
  }
  for (const plugin of bundle.plugins)
    if (!(await effects.client.matches(plugin)))
      throw new Error(
        "TRMNL dependency changed during final whole-release readback",
      );
}

import type { ResourceSettlement } from "./terminal-loop.ts";
import { settleRunResources } from "./terminal-loop.ts";

type InputResource = { close: () => void };
type MasterResource = { stop: () => Promise<unknown> };
type ControllerResource<Snapshot> = {
  stop: (masterSettlement: Promise<unknown>) => Promise<Snapshot>;
};
type RuntimeResource = { shutdown: () => Promise<void> };

export function settleCliResources<Snapshot>(options: {
  input: () => InputResource | undefined;
  master: () => MasterResource | undefined;
  controller: () => ControllerResource<Snapshot> | undefined;
  runtime: () => Promise<RuntimeResource> | undefined;
  observeSnapshot: (snapshot: Snapshot) => void;
}): Promise<ResourceSettlement<Snapshot>> {
  return settleRunResources({
    closeInput: () => {
      options.input()?.close();
    },
    settleController: async () => {
      const masterSettlement = options.master()?.stop() ?? Promise.resolve();
      const controller = options.controller();
      if (controller === undefined) {
        await masterSettlement;
        return null;
      }
      return controller.stop(masterSettlement);
    },
    observeSnapshot: options.observeSnapshot,
    settleRuntime: async () => {
      const runtime = await options.runtime();
      await runtime?.shutdown();
    },
  });
}

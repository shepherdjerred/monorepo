import type { ResourceSettlement } from "./terminal-loop.ts";
import { settleRunResources } from "./terminal-loop.ts";
import { combineFailures } from "./cli-failures.ts";
import { ControllerStopError } from "./controller-stop-error.ts";
import type { FleetSnapshot } from "./schemas.ts";

type InputResource = { close: () => void };
type MasterResource = { stop: () => Promise<unknown> };
type ControllerResource = {
  stop: (masterSettlement: Promise<unknown>) => Promise<FleetSnapshot>;
};
type RuntimeResource = { shutdown: () => Promise<void> };

export async function settleCliResources(options: {
  input: () => InputResource | undefined;
  master: () => MasterResource | undefined;
  controller: () => ControllerResource | undefined;
  runtime: () => Promise<RuntimeResource> | undefined;
  observeSnapshot: (snapshot: FleetSnapshot) => void;
}): Promise<ResourceSettlement<FleetSnapshot>> {
  let controllerFailure: Error | undefined;
  const settlement = await settleRunResources({
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
      try {
        return await controller.stop(masterSettlement);
      } catch (error) {
        if (error instanceof ControllerStopError) {
          controllerFailure = error;
          return error.snapshot;
        }
        throw error;
      }
    },
    observeSnapshot: options.observeSnapshot,
    settleRuntime: async () => {
      const runtime = await options.runtime();
      await runtime?.shutdown();
    },
  });
  return {
    snapshot: settlement.snapshot,
    failure:
      controllerFailure === undefined
        ? settlement.failure
        : combineFailures(settlement.failure, controllerFailure),
  };
}

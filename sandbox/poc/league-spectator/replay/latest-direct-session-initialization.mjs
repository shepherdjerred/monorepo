import { projectLatestDirectWorldInput } from "./latest-direct-world-input.mjs";
import { createDirectInitializationTransfer } from "./latest-direct-initialization-ownership.mjs";

// Own only this issuance state. Clear the holder before projection/minting so a
// retained one-use function cannot keep source reports/events/pose bytes alive.
export function createDirectSessionInitializationFactory(state) {
  return function makeWorkerInitialization() {
    if (state === null) throw Error("Direct session initialization is one-use");
    const issuing = state;
    state = null;
    const {
      report,
      prepared,
      events,
      scene,
      heightValues,
      worldInputs,
      staticCatalog,
      staticCatalogInitialization,
      poseInitialization,
      trace,
    } = issuing;
    trace("world.input.project", "begin");
    const worldInput = projectLatestDirectWorldInput(report);
    trace("world.input.project", "end", worldInput.counts);
    const payload = {
      profile: prepared.profile,
      packages: prepared.packages,
      contract: { ...prepared.contract, replayHash: report.replaySha256 },
      definitions: [...prepared.definitions.values()],
      events,
      report: worldInput.input,
      scene,
      heights: heightValues,
      world: worldInputs,
      ...(staticCatalog === null ? {} : { staticCatalogInitialization }),
    };
    trace("initialization.ownership", "begin");
    const ownedInitialization = createDirectInitializationTransfer(payload, [
      prepared.initializationCompilationInputs,
      poseInitialization.ownership,
    ]);
    trace("initialization.ownership", "end");
    return {
      payload,
      ownedInitialization,
      worldInputOwnership: worldInput.ownership,
    };
  };
}

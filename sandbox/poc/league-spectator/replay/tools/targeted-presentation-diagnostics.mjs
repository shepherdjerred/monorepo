import { prepareTargetedMissilePresentation } from "../latest-targeted-missile-worker.mjs";
import { requestTargetedMissilePresentation } from "../latest-targeted-missile-client.mjs";

// The inspector and browser session call the same static loader and builder.
// This wrapper only records the inspector's file fingerprints.
export async function targetedPresentationDiagnostics({
  assets,
  raw,
  read,
  heights,
  assetBase = null,
  ...inputs
}) {
  const staticAssets = {};
  const reference = await prepareTargetedMissilePresentation(
    {
      report: inputs.report,
      scene: inputs.scene,
      profile: inputs.profile,
      heights,
      world: {},
    },
    async (path) => (staticAssets[path] = await raw(`${assets}/${path}`)),
  );
  const worker = await requestTargetedMissilePresentation({
    report: inputs.report,
    scene: inputs.scene,
    profile: inputs.profile,
    heights,
    world: {},
    ...(assetBase === null ? { staticAssets } : { assetBase }),
  });
  if (JSON.stringify(worker) !== JSON.stringify(reference))
    throw Error(
      "Targeted real-worker result differs from shared synchronous builder",
    );
  return {
    ...worker,
    workerControl: {
      actualModuleWorker: true,
      staticInputBytesSupplied: assetBase === null,
      httpStaticAssetLoader: assetBase !== null,
      assetBase,
      browserExecution: false,
      emulatedInstructions: 0,
      exactSynchronousAgreement: true,
    },
  };
}

import { createFixedTimePresentation } from "../latest-fixed-time-context.mjs";
import { requestTargetedMissilePresentation } from "../latest-targeted-missile-client.mjs";

export async function fixedTimePresentationDiagnostics({
  assets,
  raw,
  heights,
  assetBase = null,
  ...inputs
}) {
  const staticAssets = {};
  const reference = await createFixedTimePresentation({
    ...inputs,
    load: async (path) => (staticAssets[path] = await raw(`${assets}/${path}`)),
  });
  const result = await requestTargetedMissilePresentation({
    family: "fixed-time",
    report: inputs.report,
    scene: inputs.scene,
    profile: inputs.profile,
    heights,
    world: {},
    ...(assetBase === null ? { staticAssets } : { assetBase }),
  });
  if (JSON.stringify(reference) !== JSON.stringify(result))
    throw Error(
      "FixedTime real-worker result differs from shared synchronous kernels",
    );
  return {
    ...result,
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

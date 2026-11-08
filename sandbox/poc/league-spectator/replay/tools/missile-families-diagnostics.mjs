import { prepareTargetedMissilePresentation } from "../latest-targeted-missile-worker.mjs";
import { combineMissilePresentationFamilies } from "../latest-missile-presentation-families.mjs";
import { requestTargetedMissilePresentation } from "../latest-targeted-missile-client.mjs";
import { createFixedTimePresentation } from "../latest-fixed-time-context.mjs";
import { sameDirectCompiledData } from "../latest-direct-compiled-restore.mjs";

export async function missileFamiliesDiagnostics({
  fixedSpeed,
  fixedTime,
  assets,
  raw,
  heights,
  assetBase = null,
  ...inputs
}) {
  const staticAssets = {};
  const load = async (path) =>
    (staticAssets[path] = await raw(`${assets}/${path}`));
  const reference = await prepareTargetedMissilePresentation(
    {
      family: "all",
      report: inputs.report,
      scene: inputs.scene,
      profile: inputs.profile,
      heights,
      world: {},
    },
    load,
  );
  const { zeroReferencePresentation, ...independentFixedTime } =
    await createFixedTimePresentation({
      ...inputs,
      load,
      includeZeroReference: true,
    });
  // The supplied standalone control wraps its exact worker result with this
  // diagnostic evidence. It is not part of the presentation context contract.
  const { workerControl, ...suppliedFixedTime } = fixedTime;
  if (
    workerControl?.actualModuleWorker !== true ||
    workerControl.exactSynchronousAgreement !== true ||
    workerControl.browserExecution !== false ||
    workerControl.emulatedInstructions !== 0
  )
    throw Error("Independent retained-target real-worker control required");
  if (!sameDirectCompiledData(independentFixedTime, suppliedFixedTime))
    throw Error(
      "Adding zero-reference preparation changed the independently prepared retained-target family",
    );
  const combined = combineMissilePresentationFamilies(
    fixedSpeed,
    independentFixedTime,
    zeroReferencePresentation,
  );
  if (!sameDirectCompiledData(reference, combined))
    throw Error(
      "Combined family context differs from independently prepared families",
    );
  const result = await requestTargetedMissilePresentation({
    family: "all",
    report: inputs.report,
    scene: inputs.scene,
    profile: inputs.profile,
    heights,
    world: {},
    ...(assetBase === null ? { staticAssets } : { assetBase }),
  });
  if (!sameDirectCompiledData(reference, result))
    throw Error(
      "Combined real-worker result differs from shared synchronous families",
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

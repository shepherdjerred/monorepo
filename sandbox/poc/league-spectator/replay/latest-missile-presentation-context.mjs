import { createTargetedMissilePresentation } from "./latest-targeted-missile-context.mjs";
import { createFixedTimePresentation } from "./latest-fixed-time-context.mjs";
import { combineMissilePresentationFamilies } from "./latest-missile-presentation-families.mjs";

export async function createMissilePresentationFamilies(inputs) {
  const assets = new Map();
  const load = (path) => {
    if (!assets.has(path)) assets.set(path, inputs.load(path));
    return assets.get(path);
  };
  const fixedSpeed = await createTargetedMissilePresentation({
    ...inputs,
    load,
  });
  const { zeroReferencePresentation, ...fixedTime } =
    await createFixedTimePresentation({
      ...inputs,
      load,
      includeZeroReference: true,
    });
  return combineMissilePresentationFamilies(
    fixedSpeed,
    fixedTime,
    zeroReferencePresentation,
  );
}

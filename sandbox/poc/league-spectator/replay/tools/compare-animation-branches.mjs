import path from "node:path";
import {
  selectNativeBooleanCondition,
  selectNativeFloatCondition,
} from "../latest-animation-conditions.mjs";
const [nativeArg, outputArg] = process.argv.slice(2);
if (!outputArg || process.argv.length !== 4)
  throw Error(
    "Usage: bun compare-animation-branches.mjs <native-condition-controls> <output.json>",
  );
const sha = (bytes) =>
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  bytes = await Bun.file(nativeArg).bytes(),
  native = JSON.parse(new TextDecoder().decode(bytes));
if (
  native.kind !== "original-animation-condition-branch-controls" ||
  native.boundary !== null ||
  native.build !== "16.21.829.8620" ||
  native.protocol !== "20e09df23c66b85e" ||
  native.scope.originalFullMathInitializerExecuted !== true ||
  !native.scope.updaterValuesSupplied ||
  native.scope.liveUnitStateProvidersRecovered !== false
)
  throw Error("Original scoped condition branch controls required");
for (const [file, digest] of Object.entries(native.sources))
  if (sha(await Bun.file(file).bytes()) !== digest)
    throw Error("Original condition observer source changed: " + file);
let comparisons = 0;
for (const node of native.cases) {
  if (node.samples.length % 2)
    throw Error("Forward and reverse native branch controls required");
  let state;
  for (const [ordinal, sample] of node.samples.entries()) {
    if (ordinal % (node.samples.length / 2) === 0)
      state = { ordinal: -1, remainingSeconds: 0, transitioning: false };
    let selected;
    if (node.kind === "boolean")
      selected = selectNativeBooleanCondition(
        {
          trueIndex: node.children.find((child) => child.truth).index,
          falseIndex: node.children.find((child) => !child.truth).index,
        },
        sample.value,
      );
    else {
      const actual = selectNativeFloatCondition(
          node.pairs,
          state,
          sample.value,
        ),
        raw = Uint8Array.from(sample.stateHex.match(/../g), (byte) =>
          parseInt(byte, 16),
        ),
        view = new DataView(raw.buffer);
      if (
        actual.state.ordinal !== view.getInt32(0x60, true) ||
        actual.state.remainingSeconds !== view.getFloat32(0x5c, true) ||
        actual.state.transitioning !== !!view.getUint8(0x64)
      )
        throw Error(
          "Native float condition state differs: " + node.key + "/" + ordinal,
        );
      state = actual.state;
      selected = actual.index;
    }
    if (selected !== sample.selectedIndex)
      throw Error(
        "Native condition child differs: " + node.key + "/" + ordinal,
      );
    comparisons++;
  }
}
const result = {
  schema: 1,
  kind: "original-animation-condition-component-comparison",
  nativeSha256: sha(bytes),
  nodes: native.cases.length,
  comparisons,
  consumerSha256: sha(
    await Bun.file(
      new URL("../latest-animation-conditions.mjs", import.meta.url),
    ).bytes(),
  ),
  scope: {
    suppliedUpdaterValues: true,
    liveStateProviderVerified: false,
    childActivationVerified: false,
    blendingVerified: false,
    nativeSpectatorAdmitted: false,
  },
};
await Bun.write(outputArg, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output: path.resolve(outputArg),
    nodes: result.nodes,
    comparisons,
  }),
);

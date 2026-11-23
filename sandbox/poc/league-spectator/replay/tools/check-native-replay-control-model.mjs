import { createHash } from "node:crypto";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sourcePaths = [
  import.meta.url,
  new URL("../latest-native-replay-control-model.mjs", import.meta.url).href,
  new URL("../latest-native-replay-button-input.mjs", import.meta.url).href,
];
const implementationSources = Object.fromEntries(
  await Promise.all(
    sourcePaths.map(async (url) => [
      url,
      hash(await Bun.file(new URL(url)).bytes()),
    ]),
  ),
);
const {
  createNativeReplayControlModel,
  nativeReplayJumpBack,
  nativeReplayButtonRectangles,
} = await import("../latest-native-replay-control-model.mjs");
const { createNativeReplayButtonInput } =
  await import("../latest-native-replay-button-input.mjs");

const [manifestPath, output] = process.argv.slice(2);
if (!manifestPath || !output)
  throw Error(
    "Usage: check-native-replay-control-model.mjs <closed-manifest> <receipt>",
  );
const bytes = await Bun.file(manifestPath).bytes(),
  manifest = JSON.parse(new TextDecoder().decode(bytes)),
  model = createNativeReplayControlModel(manifest, [0.5, 1, 2, 4]);
let comparisons = 0;
const rectangles = nativeReplayButtonRectangles(model.buttons, [1920, 1080]);
if (
  rectangles.size !== 4 ||
  [...rectangles.values()].some(
    (row) => row[2] - row[0] < 24 || row[3] - row[1] < 24,
  )
)
  throw Error(
    "Actual native geometry did not produce four accessible independent targets",
  );
for (const button of manifest.buttons)
  for (let pressed = 0; pressed < 2; pressed++)
    for (let hovered = 0; hovered < 2; hovered++)
      for (let playing = 0; playing < 2; playing++) {
        const state = {
            playing: Boolean(playing),
            timeSeconds: 79.8,
            durationSeconds: 120,
            rate: 1,
          },
          actual = model
            .snapshot(state, {
              [button.action]: {
                pressed: Boolean(pressed),
                hovered: Boolean(hovered),
              },
            })
            .buttons.find((row) => row.action === button.action),
          expected =
            button.states[
              `${pressed}1${hovered}0${Number(button.action === "Play" && Boolean(playing))}`
            ];
        if (
          actual.slot !== expected.slot ||
          JSON.stringify(actual.visibleIds) !==
            JSON.stringify(expected.visibleIds)
        )
          throw Error(
            "Browser state projection differs from original completed native output",
          );
        comparisons++;
      }
for (const control of manifest.seekCases) {
  const actual = nativeReplayJumpBack(
    control.controlledClockSeconds,
    ...control.controlledSourceBoundsF32,
  );
  if (!Object.is(actual, control.sourceClampedDouble))
    throw Error("Original float clock/add/clamp output differs");
  comparisons++;
}
const calls = [],
  session = {
    value: { playing: false, timeSeconds: 79.8, durationSeconds: 120, rate: 1 },
    getState() {
      return this.value;
    },
    play() {
      this.value.playing = true;
      calls.push("play");
    },
    pause() {
      this.value.playing = false;
      calls.push("pause");
    },
    setRate(value) {
      this.value.rate = value;
      calls.push(["rate", value]);
    },
    seek(value) {
      this.value.timeSeconds = value;
      calls.push(["seek", value]);
    },
  };
model.execute("Play", session);
model.execute("Play", session);
model.execute("SpeedUp", session);
model.execute("SpeedUp", session);
model.execute("SpeedUp", session);
if (
  session.value.rate !== 4 ||
  !model.snapshot(session.value).buttons.find((row) => row.action === "SpeedUp")
    .disabled
)
  throw Error(
    "SDK capability boundary was crossed or unsupported native step was skipped",
  );
model.execute("SpeedDown", session);
model.execute("SpeedDown", session);
model.execute("SpeedDown", session);
model.execute("SpeedDown", session);
model.execute("SkipBack", session);
const expected = [
  "play",
  "pause",
  ["rate", 2],
  ["rate", 4],
  ["rate", 2],
  ["rate", 1],
  ["rate", 0.5],
  ["seek", nativeReplayJumpBack(79.8, 0, 120)],
];
if (JSON.stringify(calls) !== JSON.stringify(expected))
  throw Error("Shared SDK commands used stale state or unsupported rates");
const input = createNativeReplayButtonInput();
input.pointerDown(7, true, 0);
input.pointerEnd(9);
if (!input.snapshot().pressed)
  throw Error("Another pointer released the owned press");
input.pointerLeave(7);
if (input.snapshot().pressed)
  throw Error("Off-target pointer retained pressed artwork");
input.pointerEnter(7, "mouse");
input.keyDown(" ");
input.pointerEnd(7);
input.keyUp("Enter");
if (!input.snapshot().pressed)
  throw Error("Unrelated key/pointer released the owned Space key");
input.keyUp(" ");
input.pointerDown(4, false, 0);
if (input.snapshot().pressed)
  throw Error("Secondary pointer captured presentation");
input.keyDown("Enter");
input.reset();
if (input.snapshot().pressed || input.snapshot().hovered)
  throw Error("Blur/disposal retained input ownership");
for (const [url, expected] of Object.entries(implementationSources))
  if (hash(await Bun.file(new URL(url)).bytes()) !== expected)
    throw Error("Control comparison implementation changed during execution");
const report = {
  schema: 1,
  kind: "original-control-sdk-bridge-comparison",
  manifestSha256: createHash("sha256").update(bytes).digest("hex"),
  implementationSources,
  originalOutputComparisons: comparisons,
  sdkCalls: calls,
  pointerKeyboardOwnership: "passed",
  mismatches: 0,
  accessibleHitTargets: [...rectangles],
  nativeEventServicesAdmitted: false,
};
await Bun.write(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));

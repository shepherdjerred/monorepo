import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const scoutApp = fileURLToPath(
  new URL("../../../../packages/scout-for-lol/packages/app", import.meta.url),
);
const bundle = await Bun.build({
  entrypoints: [
    fileURLToPath(new URL("./scout-terrain-announcer.ts", import.meta.url)),
  ],
  target: "browser",
  plugins: [
    {
      name: "resolve-scout-announcer-test-zod",
      setup(builder) {
        builder.onResolve({ filter: /^zod$/ }, ({ path }) => ({
          path: Bun.resolveSync(path, scoutApp),
        }));
      },
    },
  ],
});
const [output] = bundle.outputs;
if (!bundle.success || output === undefined)
  throw new AggregateError(bundle.logs, "Could not bundle the Scout announcer");
const { CombatCueSchema } = (await import(
  `data:text/javascript;base64,${Buffer.from(await output.arrayBuffer()).toString("base64")}`
)) as typeof import("./scout-terrain-announcer.ts");

const timeline = {
  replaySha256: "a".repeat(64),
  scope: "packet-clock-dry-source",
  mediaId: 329446178,
};

test("accepts both one recorded combat cue and strictly ordered repetitions", () => {
  const single = { ...timeline, timeSeconds: 1719.9504140625 };
  const repeated = {
    ...timeline,
    timesSeconds: [110.62186505126954, 125.86907977294922, 1719.9504140625],
  };
  expect(CombatCueSchema.parse(single)).toEqual(single);
  expect(CombatCueSchema.parse(repeated)).toEqual(repeated);
});

test("rejects unknown media and ambiguous combat clocks", () => {
  for (const corrupt of [
    { ...timeline, mediaId: 1, timesSeconds: [1] },
    { ...timeline, timesSeconds: [] },
    { ...timeline, timesSeconds: [0, 1] },
    { ...timeline, timesSeconds: [2, 1] },
    { ...timeline, timesSeconds: [1, 1] },
    { ...timeline, timesSeconds: Array.from({ length: 47 }, (_, i) => i + 1) },
    { ...timeline, timeSeconds: 1, timesSeconds: [1] },
  ])
    expect(CombatCueSchema.safeParse(corrupt).success).toBe(false);
});

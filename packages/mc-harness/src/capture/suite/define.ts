import { z } from "zod";
import { MediaName, PresentationSchema } from "#protocol/media.ts";
import type { CaptureScene } from "#src/capture/define.ts";
import { CaptureFeatureSchema } from "#protocol/ipc.ts";
import { ClientNameSchema } from "#protocol/client.ts";

const point = z.tuple([z.number().int(), z.number().int()]);
export const PatchSchema = z
  .strictObject({
    world: z.string().regex(/^[a-z][a-z0-9_]*$/u),
    min: point,
    max: point,
    paddingChunks: z.number().int().min(2).max(32),
  })
  .refine(
    (p) => p.min.every((v, i) => v <= (p.max[i] ?? -Infinity)),
    "Inverted patch",
  )
  .refine(
    (p) =>
      (Math.floor(p.max[0] / 16) -
        Math.floor(p.min[0] / 16) +
        1 +
        2 * p.paddingChunks) *
        (Math.floor(p.max[1] / 16) -
          Math.floor(p.min[1] / 16) +
          1 +
          2 * p.paddingChunks) <=
      4096,
    "Terrain patch exceeds 4096 chunk columns",
  );
export type TerrainPatch = z.infer<typeof PatchSchema>;
export type SuiteScenario = {
  id: string;
  scene: CaptureScene;
  anchor: [number, number, number];
  world: string;
  helpers: string[];
  shots: z.infer<typeof PresentationSchema>[];
};
export type CaptureSuite = {
  id: string;
  patches: TerrainPatch[];
  scenarios: SuiteScenario[];
  features?: z.infer<typeof CaptureFeatureSchema>[] | undefined;
  rollout?: { url: string; environment: "prod" | "beta" } | undefined;
};
const SceneSchema = z.object({
  name: MediaName,
  description: z.string(),
  bounds: z.object({
    min: z.tuple([z.number(), z.number(), z.number()]),
    max: z.tuple([z.number(), z.number(), z.number()]),
  }),
  staging: z.tuple([z.number(), z.number(), z.number()]),
  inspectors: z.array(z.string()),
  setup: z.custom<CaptureScene["setup"]>(
    (value) => typeof value === "function",
  ),
  run: z.custom<CaptureScene["run"]>((value) => typeof value === "function"),
});
export const SuiteSchema = z.strictObject({
  id: MediaName,
  patches: z.array(PatchSchema).min(1),
  features: z.array(CaptureFeatureSchema).optional(),
  rollout: z
    .strictObject({
      url: z.url().refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          url.username === "" &&
          url.password === "" &&
          url.search === "" &&
          url.hash === ""
        );
      }),
      environment: z.enum(["prod", "beta"]),
    })
    .optional(),
  scenarios: z
    .array(
      z.strictObject({
        id: MediaName,
        scene: SceneSchema,
        anchor: z.tuple([z.number(), z.number(), z.number()]),
        world: z.string().regex(/^[a-z][a-z0-9_]*$/u),
        helpers: z.array(ClientNameSchema),
        shots: z.array(PresentationSchema).min(1),
      }),
    )
    .min(1),
});

function validateSite(suite: CaptureSuite, scenario: SuiteScenario) {
  const { bounds, staging } = scenario.scene;
  if (bounds.min.some((value, i) => value > (bounds.max[i] ?? -Infinity)))
    throw new Error(`Inverted scene ${scenario.id}`);
  const points = [[0, 0, 0], bounds.min, bounds.max, staging];
  const covered = suite.patches.some(
    (p) =>
      p.world === scenario.world &&
      points.every(
        (offset) =>
          scenario.anchor[0] + (offset[0] ?? 0) >= p.min[0] &&
          scenario.anchor[0] + (offset[0] ?? 0) <= p.max[0] &&
          scenario.anchor[2] + (offset[2] ?? 0) >= p.min[1] &&
          scenario.anchor[2] + (offset[2] ?? 0) <= p.max[1],
      ),
  );
  if (!covered)
    throw new Error(
      `Scenario ${scenario.id} has no terrain patch covering its site and staging`,
    );
  if (
    new Set(scenario.helpers).size !== scenario.helpers.length ||
    scenario.helpers.includes("XiguaJerred")
  )
    throw new Error(
      `Scenario ${scenario.id} has duplicate camera/helper identities`,
    );
}

/** Validate once before starting a server or modifying generated assets. */
export function defineCaptureSuite(suite: CaptureSuite): CaptureSuite {
  SuiteSchema.parse(suite);
  MediaName.parse(suite.id);
  suite.patches.forEach((p) => PatchSchema.parse(p));
  const ids = new Set<string>();
  const shots = new Set<string>();
  for (const scenario of suite.scenarios) {
    MediaName.parse(scenario.id);
    if (ids.has(scenario.id))
      throw new Error(`Duplicate scenario ${scenario.id}`);
    ids.add(scenario.id);
    for (const shot of scenario.shots) {
      PresentationSchema.parse(shot);
      if (shots.has(shot.name)) throw new Error(`Duplicate shot ${shot.name}`);
      shots.add(shot.name);
    }
    validateSite(suite, scenario);
  }
  return suite;
}

export function selectScenarios(
  suite: CaptureSuite,
  selection: { scenario?: string | undefined; shot?: string | undefined },
) {
  const selected = suite.scenarios.filter(
    (s) =>
      (selection.scenario === undefined || s.id === selection.scenario) &&
      (selection.shot === undefined ||
        s.shots.some((p) => p.name === selection.shot)),
  );
  if (selected.length === 0)
    throw new Error("No capture scenarios match the selection");
  return selected;
}

/** Actions still execute in full when selecting a shot; only artifact emission is filtered. */
export function presentScene(
  scenario: SuiteScenario,
  shot?: string,
): CaptureScene {
  const presentation = (name: string) => {
    const result = scenario.shots.find((p) => p.name === name);
    if (result === undefined) throw new Error(`Undeclared shot ${name}`);
    return result;
  };
  const wrap =
    (execute: CaptureScene["run"]): CaptureScene["run"] =>
    async (context) => {
      await execute({
        ...context,
        capture: (p) => {
          const declared = presentation(p.name);
          return shot === undefined || shot === p.name
            ? context.capture(declared)
            : Promise.resolve();
        },
        record: (p, action, seconds) => {
          const declared = presentation(p.name);
          return shot === undefined || shot === p.name
            ? context.record(declared, action, seconds)
            : action();
        },
      });
    };
  return {
    ...scenario.scene,
    setup: wrap(scenario.scene.setup),
    run: wrap(scenario.scene.run),
  };
}

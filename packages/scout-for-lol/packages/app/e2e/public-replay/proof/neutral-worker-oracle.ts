import { expect } from "@playwright/test";
import path from "node:path";
import { z } from "zod";
import {
  recordedWorldPaths,
  verifyWorldUnitPaths,
} from "./world-unit-path-oracle.ts";

const oracleFile = "scout-8428-current-neutral-objective-proof.json";
const oracleSha256 =
  "0f73b2851c6ce90811d739c75b25bf81950f726be558538fbd0f9037c0d260f6";
const campOracleFile = "scout-8428-neutral-camp-scene-oracle.json";
const campOracleSha256 =
  "0682d277f8022890601b848ca512b9e5d70fdbe62da9d06f178e768548313ccc";
const campModelOracleFile = "scout-8428-neutral-camp-model-oracle.json";
const campModelOracleSha256 =
  "c1173c2aafe9ef0fd2f34ad8390a6f7ac66f43791b633febd968fa31f0380818";
const replayDigest =
  "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1";
const oracle = z.object({
  evidence: z.object({
    actors: z.array(z.object({ context: z.number(), modelId: z.string() })),
  }),
  projection: z.object({
    neutralObjectiveInstances: z.array(
      z.looseObject({ context: z.number(), paths: recordedWorldPaths }),
    ),
    neutralObjectiveKills: z.array(z.unknown()),
    neutralObjectiveOmissions: z.unknown(),
    neutralCampCoverage: z
      .object({
        births: z.literal(247),
        closed: z.literal(224),
        open: z.literal(23),
        omissions: z.strictObject({
          unsupportedCampNames: z.literal(0),
          incompleteLifecycle: z.literal(0),
          missingRecordedMotion: z.literal(0),
        }),
      })
      .optional(),
  }),
});

export async function verifyDirectNeutralWorker(
  root: string,
  replaySha256: string,
  {
    directNeutralModels: models,
    directNeutralCamps: camps,
  }: {
    directNeutralModels: [string, number][] | undefined;
    directNeutralCamps: boolean;
  },
  actual: {
    neutralObjectiveInstances?: unknown;
    neutralObjectiveKills?: unknown;
    neutralObjectiveOmissions?: unknown;
    neutralCampCoverage?: unknown;
  },
) {
  if (models === undefined) {
    expect(actual.neutralObjectiveInstances).toBeUndefined();
    expect(actual.neutralObjectiveKills).toBeUndefined();
    expect(actual.neutralObjectiveOmissions).toBeUndefined();
    expect(actual.neutralCampCoverage).toBeUndefined();
    expect(camps).toBe(false);
    return [];
  }
  const extendedCampModels =
    camps && models.some(([name]) => name === "sru_gromp");
  let file = oracleFile;
  let digest = oracleSha256;
  if (extendedCampModels) {
    file = campModelOracleFile;
    digest = campModelOracleSha256;
  } else if (camps) {
    file = campOracleFile;
    digest = campOracleSha256;
  }
  const bytes = await Bun.file(path.join(root, file)).bytes();
  expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(
    digest,
  );
  expect(replaySha256).toBe(replayDigest);
  const { evidence, projection } = oracle.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
  const names = new Map(
    evidence.actors.map(({ context, modelId }) => [context, modelId]),
  );
  const ids = new Map(models);
  const instances = projection.neutralObjectiveInstances.map((instance) => {
    const modelId = names.get(instance.context);
    const participantId = modelId === undefined ? undefined : ids.get(modelId);
    if (participantId === undefined)
      throw new Error("The recorded neutral actor lacks a verified model.");
    return { ...instance, participantId };
  });
  verifyWorldUnitPaths(actual.neutralObjectiveInstances, instances);
  expect(actual.neutralObjectiveKills).toEqual(
    projection.neutralObjectiveKills,
  );
  expect(actual.neutralObjectiveOmissions).toEqual(
    projection.neutralObjectiveOmissions,
  );
  expect(projection.neutralCampCoverage !== undefined).toBe(camps);
  expect(actual.neutralCampCoverage).toEqual(projection.neutralCampCoverage);
  return instances.map(({ context }) => context);
}

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
  }),
});

export async function verifyDirectNeutralWorker(
  root: string,
  replaySha256: string,
  models: [string, number][] | undefined,
  actual: {
    neutralObjectiveInstances?: unknown;
    neutralObjectiveKills?: unknown;
    neutralObjectiveOmissions?: unknown;
  },
) {
  if (models === undefined) {
    expect(actual.neutralObjectiveInstances).toBeUndefined();
    expect(actual.neutralObjectiveKills).toBeUndefined();
    expect(actual.neutralObjectiveOmissions).toBeUndefined();
    return;
  }
  const bytes = await Bun.file(path.join(root, oracleFile)).bytes();
  expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(
    oracleSha256,
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
}

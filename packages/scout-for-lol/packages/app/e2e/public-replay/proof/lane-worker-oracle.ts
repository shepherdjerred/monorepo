import { expect } from "@playwright/test";
import path from "node:path";
import { z } from "zod";
import {
  recordedWorldPaths,
  verifyWorldUnitPaths,
} from "./world-unit-path-oracle.ts";

const oracleFile = "scout-8428-portable-lane-compiled.json";
const oracleSha256 =
  "b47b5b6a61e60c5211e7f9f655264699db287a727704b4ae6f4f40e6b8b078e9";
const laneOracle = z.object({
  replaySha256: z.string(),
  instances: z.array(
    z.object({
      context: z.number().int().positive(),
      modelId: z.string(),
      team: z.union([z.literal(100), z.literal(200)]),
      creationTimeSeconds: z.number().nonnegative(),
      killTimeSeconds: z.number().positive(),
      paths: recordedWorldPaths,
    }),
  ),
  coverage: z.unknown(),
});

export async function verifyDirectLaneWorker(
  root: string,
  replaySha256: string,
  models: [string, number][] | undefined,
  actual: { laneMinionInstances?: unknown; laneMinionCoverage?: unknown },
) {
  if (models === undefined) {
    expect(actual.laneMinionInstances).toBeUndefined();
    expect(actual.laneMinionCoverage).toBeUndefined();
    return;
  }
  const bytes = await Bun.file(path.join(root, oracleFile)).bytes();
  expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(
    oracleSha256,
  );
  const expected = laneOracle.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
  expect(expected.replaySha256).toBe(replaySha256);
  const modelIds = new Map(models);
  const instances = expected.instances.map(({ modelId, team, ...instance }) => {
    const participantId = modelIds.get(modelId);
    if (participantId === undefined)
      throw new Error(`Missing lane model for ${modelId}.`);
    return { ...instance, participantId, teamId: team };
  });
  verifyWorldUnitPaths(actual.laneMinionInstances, instances);
  expect(actual.laneMinionCoverage).toEqual(expected.coverage);
}

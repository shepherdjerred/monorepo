import { expect, type Page } from "@playwright/test";
import path from "node:path";
import { z } from "zod";
import { readDirectWorkerReply } from "./motion-worker-capture.ts";

const oracleFile = "scout-8428-v35-champion-models-oracle.json";
const oracleSha256 =
  "966fdf89b07b90058fa7911d537fceb2a7297e122a86fdf7cf8a73aab5650871";
const preparedPackage =
  "48b50658885f3f6e59c02048800c569cf378efe6ff65296bcf23680b94a5e2b6";
const mainPrimitiveIndexCounts = [
  16_356, 40_497, 24_396, 20_190, 22_014, 43_938, 16_995, 15_324, 14_208,
  30_540,
];
const BindingsSchema = z.strictObject({
  bindings: z
    .array(
      z.strictObject({
        participantId: z.number().int().positive(),
        skinId: z.number().int().nonnegative(),
        skinScale: z.number().positive(),
        hiddenRanges: z.array(z.string()),
        url: z.string().regex(/^\/champion-models\/[a-f0-9]{64}\.glb$/u),
      }),
    )
    .length(10),
});

export async function verifyRecordedChampionModels(
  page: Page,
  fixture: {
    directChampionModels: boolean;
    packageUrl: string;
    descriptor: { sha256: string };
    preparedChampionModels: unknown;
    paths: ReadonlyMap<string, unknown>;
  },
  requested: ReadonlySet<string>,
  draw: { actorIndexCounts: readonly number[] },
) {
  const observed = z
    .object({ championModels: BindingsSchema.optional() })
    .optional()
    .parse(await readDirectWorkerReply(page, ["championModels"]));
  expect(observed?.championModels !== undefined).toBe(
    fixture.directChampionModels,
  );
  const root = fixture.packageUrl.slice(0, fixture.packageUrl.lastIndexOf("/"));
  if (
    !fixture.directChampionModels &&
    path.posix.basename(root) !== preparedPackage
  )
    return;
  const oracleRoot = Bun.env["SCOUT_REPLAY_E2E_STATS_ORACLE_DIRECTORY"];
  if (oracleRoot === undefined || oracleRoot === "")
    throw new Error(
      "Set SCOUT_REPLAY_E2E_STATS_ORACLE_DIRECTORY for champion model verification.",
    );
  const bytes = await Bun.file(path.join(oracleRoot, oracleFile)).bytes();
  expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(
    oracleSha256,
  );
  const oracle = z
    .object({ replaySha256: z.string(), championModels: BindingsSchema })
    .parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  expect(oracle.replaySha256).toBe(fixture.descriptor.sha256);
  const models = fixture.directChampionModels
    ? observed?.championModels
    : BindingsSchema.parse(fixture.preparedChampionModels);
  const ordered = ({ bindings }: z.infer<typeof BindingsSchema>) =>
    bindings.toSorted((a, b) => a.participantId - b.participantId);
  expect(models === undefined ? undefined : ordered(models)).toEqual(
    ordered(oracle.championModels),
  );

  const paths = oracle.championModels.bindings
    .map(({ url }) => `${root}${url}`)
    .sort();
  for (const url of paths) expect(fixture.paths.has(url)).toBe(true);
  expect(
    [...requested]
      .filter((url) => url.startsWith(`${root}/champion-models/`))
      .sort(),
  ).toEqual(paths);
  for (const count of mainPrimitiveIndexCounts)
    expect(draw.actorIndexCounts).toContain(count);
}

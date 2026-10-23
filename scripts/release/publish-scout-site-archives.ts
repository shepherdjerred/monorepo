import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { ArtifactInputSchema } from "@shepherdjerred/delivery/contract";
import { z } from "zod";
import { parseScoutReleaseState } from "../lib/scout/scout-release-state.ts";
import {
  hashSiteArchive,
  assertScoutArchiveSource,
  DELIVERY_SCOUT_RELEASE_WORK_DIR,
} from "../lib/scout/scout-archive.ts";
import { publishStaticSiteArchive } from "../lib/static-site-publication.ts";
import { readRequiredHandoff, writeJsonHandoff } from "../lib/ci/ci-handoff.ts";
import { scoutArchiveRequirements } from "../lib/scout/scout-delivery-backend.ts";
import { requireEnv } from "../lib/run.ts";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  strict: true,
  allowPositionals: true,
  options: { "catalog-v2": { type: "boolean", default: false } },
});
const [file] = positionals;
if (file === undefined || positionals.length !== 1)
  throw new Error("Explicit Scout release state file required");
const state = parseScoutReleaseState(await Bun.file(file).text());
const requires = scoutArchiveRequirements(
  state,
  JSON.parse(await readRequiredHandoff("scout-delivery-backend")),
  {
    sourceRevision: requireEnv("CI_COMMIT_SHA"),
    repositoryId: z.coerce
      .number()
      .int()
      .positive()
      .parse(requireEnv("CI_REPO_ID")),
    pipelineNumber: z.coerce
      .number()
      .int()
      .positive()
      .parse(requireEnv("CI_PIPELINE_NUMBER")),
  },
);
const scratch = await mkdtemp(path.join(tmpdir(), "scout-delivery-archive-"));
try {
  const artifacts = [];
  for (const flavor of ["beta", "prod"] as const) {
    const bucket = flavor === "beta" ? "scout-frontend-beta" : "scout-frontend";
    const source = path.join(DELIVERY_SCOUT_RELEASE_WORK_DIR, flavor);
    if (!(await Bun.file(path.join(source, "index.html")).exists()))
      throw new Error(`Prepared Scout ${flavor} source is missing`);
    const expected =
      flavor === "beta" ? state.betaSiteArchiveDigest : state.siteArchiveDigest;
    await assertScoutArchiveSource(source, flavor);
    if ((await hashSiteArchive(source)) !== expected)
      throw new Error(
        `Scout ${flavor} archive differs from its qualified release state`,
      );
    await publishStaticSiteArchive({
      bucket,
      source,
      metadataDirectory: scratch,
      registry: values["catalog-v2"] ? "v2" : "v1",
      requires,
    });
    const raw: unknown = await Bun.file(
      path.join(scratch, `${bucket}.json`),
    ).json();
    artifacts.push({
      serviceId: "scout-for-lol",
      artifact: ArtifactInputSchema.parse(raw),
    });
  }
  await writeJsonHandoff("scout-site-artifacts", artifacts);
} finally {
  await rm(scratch, { recursive: true });
}

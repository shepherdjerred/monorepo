import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ArtifactInputSchema } from "@shepherdjerred/delivery/contract";
import { parseScoutReleaseState } from "../lib/scout/scout-release-state.ts";
import {
  hashSiteArchive,
  materializeScoutArchive,
  SCOUT_RELEASE_WORK_DIR,
} from "../lib/scout/scout-site-storage.ts";
import { publishStaticSiteArchive } from "../lib/static-site-publication.ts";
import { writeJsonHandoff } from "../lib/ci/ci-handoff.ts";

const file = Bun.argv[2];
if (file === undefined)
  throw new Error("Explicit Scout release state file required");
const state = parseScoutReleaseState(await Bun.file(file).text());
const scratch = await mkdtemp(path.join(tmpdir(), "scout-delivery-archive-"));
try {
  const artifacts = [];
  for (const flavor of ["beta", "prod"] as const) {
    const bucket = flavor === "beta" ? "scout-frontend-beta" : "scout-frontend";
    let source = path.join(SCOUT_RELEASE_WORK_DIR, flavor);
    if (!(await Bun.file(path.join(source, "index.html")).exists())) {
      source = path.join(scratch, flavor);
      await materializeScoutArchive(state, flavor, source);
    }
    const expected =
      flavor === "beta" ? state.betaSiteArchiveDigest : state.siteArchiveDigest;
    if ((await hashSiteArchive(source)) !== expected)
      throw new Error(
        `Scout ${flavor} archive differs from its qualified release state`,
      );
    await publishStaticSiteArchive({
      bucket,
      source,
      metadataDirectory: scratch,
      requires: { "image:scout-for-lol": state.backendImageDigest },
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

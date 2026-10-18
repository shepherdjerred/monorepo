import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDeliveryClient } from "@shepherdjerred/delivery/client";
import { z } from "zod";
import {
  buildTrmnlPluginArchive,
  trmnlArchiveArtifact,
  trmnlBackendDigest,
} from "../../lib/trmnl/publication.ts";
import { publishImmutableArchive } from "../../lib/artifacts/immutable-archive.ts";
import {
  readRequiredHandoff,
  writeJsonHandoff,
} from "../../lib/ci/ci-handoff.ts";
import { DELIVERY_IMAGE_DIGESTS_HANDOFF } from "../../lib/ci/image-publication-handoff.ts";
import { requireEnv, runAllowExit } from "../../lib/run.ts";

if (Bun.argv.length !== 2)
  throw new Error("publish-plugins.ts accepts no arguments");
await writeJsonHandoff("trmnl-plugin-artifacts", []);
const digests = z
  .record(z.string(), z.string().regex(/^sha256:[a-f0-9]{64}$/u))
  .parse(JSON.parse(await readRequiredHandoff(DELIVERY_IMAGE_DIGESTS_HANDOFF)));
const changed = await runAllowExit([
  "bun",
  "--no-install",
  "ci/scripts/selectors/ci-changed.ts",
  "trmnl",
]);
if (changed.exitCode !== 0 && changed.exitCode !== 78)
  throw new Error("TRMNL source selector failed");
const fresh = digests["shepherdjerred/trmnl-dashboard"] !== undefined;
if (fresh || changed.exitCode === 0) {
  const backend = await trmnlBackendDigest(
    digests,
    async () =>
      await createDeliveryClient({
        baseUrl: requireEnv("DELIVERY_URL"),
        headers: {
          Authorization: `Bearer ${requireEnv("DELIVERY_API_TOKEN")}`,
        },
      }).latestQualifiedArtifact({
        serviceId: "trmnl-dashboard",
        component: "image:trmnl-dashboard",
        kind: "image",
      }),
  );
  const archive = await buildTrmnlPluginArchive(
    "packages/trmnl-dashboard/trmnl",
    requireEnv("CI_COMMIT_SHA"),
  );
  const scratch = await mkdtemp(path.join(tmpdir(), "trmnl-archive-"));
  try {
    const file = path.join(scratch, "plugins.json");
    await Bun.write(file, archive.bytes);
    await publishImmutableArchive({
      uri: archive.uri,
      digest: archive.digest,
      file,
      readback: path.join(scratch, "readback.json"),
    });
    await writeJsonHandoff("trmnl-plugin-artifacts", [
      {
        serviceId: "trmnl-dashboard",
        artifact: trmnlArchiveArtifact(archive, backend, {
          repositoryId: requireEnv("CI_REPO_ID"),
          pipelineNumber: requireEnv("CI_PIPELINE_NUMBER"),
        }),
      },
    ]);
  } finally {
    await rm(scratch, { recursive: true });
  }
}

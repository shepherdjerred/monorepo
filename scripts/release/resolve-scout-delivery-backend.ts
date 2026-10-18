import { createDeliveryClient } from "@shepherdjerred/delivery/client";
import { z } from "zod";
import { readRequiredHandoff, writeJsonHandoff } from "../lib/ci/ci-handoff.ts";
import { DELIVERY_IMAGE_DIGESTS_HANDOFF } from "../lib/ci/image-publication-handoff.ts";
import {
  resolveScoutDeliveryBackend,
  scoutDeliveryBackendDigest,
} from "../lib/scout/scout-delivery-backend.ts";
import { requireEnv } from "../lib/run.ts";

if (Bun.argv.length !== 2)
  throw new Error("resolve-scout-delivery-backend.ts accepts no arguments");
const input = await resolveScoutDeliveryBackend(
  {
    digests: JSON.parse(
      await readRequiredHandoff(DELIVERY_IMAGE_DIGESTS_HANDOFF),
    ),
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
  async (query) =>
    await createDeliveryClient({
      baseUrl: requireEnv("DELIVERY_URL"),
      headers: { Authorization: `Bearer ${requireEnv("DELIVERY_API_TOKEN")}` },
    }).latestQualifiedArtifact(query),
);
await writeJsonHandoff("scout-delivery-backend", input);
process.stdout.write(`${scoutDeliveryBackendDigest(input)}\n`);

#!/usr/bin/env bun
/**
 * Register one freshly built CI toolchain image as a Delivery build of the
 * `ci` service. The refresh lane runs this after the pin promotion recorded
 * its outcome, and only a candidate the promotion carries is registered: a
 * declined one (runtime-unchanged, older, superseded or deferred) would add a
 * redundant `ci` revision or an image CI never adopted, so the current
 * qualified artifact stays in place. Delivery qualifies the build on its own
 * and composition carries the sibling image forward from the base set, so no
 * retained ids are sent.
 *
 * This is the v1 producer. With `woodpecker-delivery-catalog-v2-enabled` on,
 * `register-ci-service-build.ts` registers the `ci` service from its pins
 * instead and the refresh lane registers nothing.
 *
 * Usage: register-ci-image-build.ts --candidate <candidate.json> --promotion <promotion.json>
 */
import { createDeliveryClient } from "../../../packages/delivery/src/shared/client.ts";
import type { PublishBuild } from "../../../packages/delivery/src/shared/contract.ts";
import {
  SERVICE_CATALOG,
  ServiceIndex,
} from "../../../packages/ops-model/src/catalog.ts";
import { imageRuntimeDigests } from "../../../scripts/lib/ci/image-runtime-digests.ts";
import { requireEnv } from "../../../scripts/lib/run.ts";
import { runMain } from "../../../scripts/lib/transient.ts";
import { ciImageDefinition } from "./build-ci-image-core.ts";
import {
  ciBuildContextFromEnv,
  inspectManifest,
  pipelinePrefix,
  type CiBuildContext,
  type ManifestInspector,
  type RegistrationClient,
} from "./ci-build-context.ts";
import { parseCiImagePromotionOutcome } from "./ci-image-promotion-outcome.ts";
import {
  parseCiImageCandidate,
  type CiImageCandidate,
} from "./update-ci-image-pin-core.ts";

/** Toolchain images the `ci` service releases; the cross-compilers are not CI service builds. */
const CI_SERVICE_IMAGES: ReadonlySet<string> = new Set([
  "ci-base",
  "ci-playwright",
]);

/** The exact build the refresh lane just pushed, as Delivery's `ci` service build. */
export function ciImageBuild(
  candidate: CiImageCandidate,
  context: CiBuildContext,
  rawManifest: string,
): PublishBuild {
  if (!CI_SERVICE_IMAGES.has(candidate.image))
    throw new Error(
      `${candidate.image} is not a CI service image; only ci-base and ci-playwright register ci builds`,
    );
  if (candidate.buildNumber !== context.releaseNumber)
    throw new Error(
      `Candidate build ${String(candidate.buildNumber)} is not this pipeline's release ${String(context.releaseNumber)}`,
    );
  if (candidate.sourceCommit !== context.sourceRevision)
    throw new Error(
      "Candidate source commit differs from this pipeline's commit",
    );
  const owner = new ServiceIndex(SERVICE_CATALOG).byImage(candidate.image);
  if (owner === undefined)
    throw new Error(`Image ${candidate.image} has no service catalog owner`);
  const definition = ciImageDefinition(candidate.image);
  const uri = `docker.io/shepherdjerred/${candidate.image}`;
  if (definition.repository !== uri)
    throw new Error(`${candidate.image} is not published at ${uri}`);
  const prefix = pipelinePrefix(context);
  return {
    requestId: `${prefix}/ci/${candidate.image}`,
    serviceId: owner.id,
    sourceRevision: context.sourceRevision,
    ciUrl: context.ciUrl,
    verifiedAt: context.verifiedAt,
    artifacts: [
      {
        id: `${prefix}/image/${candidate.image}`,
        component: `image:${candidate.image}`,
        kind: "image",
        uri,
        digest: candidate.digest,
        runtimeDigests: imageRuntimeDigests(rawManifest, candidate.digest),
        requires: {},
        version: `2.0.0-${String(context.releaseNumber)}`,
      },
    ],
    retainedArtifactIds: [],
  };
}

export async function registerCiImageBuild(input: {
  readonly candidatePath: string;
  readonly promotionPath: string;
  readonly context: CiBuildContext;
  readonly client: RegistrationClient;
  readonly inspect: ManifestInspector;
}): Promise<{ buildId: string; artifacts: string[] } | null> {
  const candidate = parseCiImageCandidate(
    await Bun.file(input.candidatePath).json(),
  );
  const promotion = parseCiImagePromotionOutcome(
    await Bun.file(input.promotionPath).json(),
  );
  if (
    promotion.image !== candidate.image ||
    promotion.digest !== candidate.digest
  )
    throw new Error(
      `Promotion outcome for ${promotion.image} ${promotion.digest} does not describe candidate ${candidate.image} ${candidate.digest}`,
    );
  if (!promotion.promoted) {
    console.log(
      `${candidate.image} ${candidate.digest} was not promoted (${promotion.reason}); Delivery keeps the current qualified ci artifact`,
    );
    return null;
  }
  const raw = await input.inspect(
    `docker.io/shepherdjerred/${candidate.image}@${candidate.digest}`,
  );
  const build = ciImageBuild(candidate, input.context, raw);
  const registered = await input.client.publish(build);
  console.log(
    `Registered ${candidate.image} ${candidate.digest} as Delivery build ${registered.buildId}`,
  );
  return registered;
}

async function main(): Promise<void> {
  const usage =
    "Usage: register-ci-image-build.ts --candidate <candidate.json> --promotion <promotion.json>";
  const values = Bun.argv.slice(2);
  if (values.length !== 4) throw new Error(usage);
  const [candidateFlag, candidatePath = "", promotionFlag, promotionPath = ""] =
    values;
  if (
    candidatePath === "" ||
    promotionPath === "" ||
    candidateFlag !== "--candidate" ||
    promotionFlag !== "--promotion"
  )
    throw new Error(usage);
  const client = createDeliveryClient({
    baseUrl: requireEnv("DELIVERY_URL"),
    headers: { Authorization: `Bearer ${requireEnv("DELIVERY_API_TOKEN")}` },
  });
  await registerCiImageBuild({
    candidatePath,
    promotionPath,
    context: ciBuildContextFromEnv(),
    client,
    inspect: inspectManifest,
  });
}

if (import.meta.main) {
  await runMain(main);
}

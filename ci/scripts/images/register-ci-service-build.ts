#!/usr/bin/env bun
/**
 * Register this main push pipeline's build of the `ci` service under the
 * Delivery v2 catalog: one build that fills every component the catalog
 * declares for `ci` from the images this commit pins (R0, B2, B5).
 *
 * The images CI and Delivery's stage runners use are the committed pins, not
 * the refresh lane's candidate. The candidate becomes a pin only when its
 * promotion pull request merges, and in production the refresh lane runs as
 * a manual maintenance pipeline, which the independent qualifier refuses by
 * design. So every main push pipeline registers its pins, one component at
 * a time:
 *
 * - a pin equal to the component's latest qualified artifact retains that
 *   artifact (the unchanged sibling of a changed image);
 * - a pin `ci` qualified before retains its original artifact (B2);
 * - any other pin is read back from the registry by digest, and its bytes
 *   must hash to the pin before it is registered as a new artifact.
 *
 * Like the other producers, it registers even when nothing changed: Delivery
 * composes nothing when every digest equals the live set (R2), and composes
 * the first set when the lineage has none (R0). That covers the cutover,
 * where the catalog starts a new `ci` lineage and no image changed, and any
 * later change to `ci`'s component list. Delivery qualifies the build against
 * this exact push pipeline.
 *
 * Usage: register-ci-service-build.ts
 */
import { createDeliveryClient } from "../../../packages/delivery/src/shared/client.ts";
import { DeliveryClientError } from "../../../packages/delivery/src/shared/client-error.ts";
import type {
  ArtifactVersion,
  FindQualifiedArtifact,
  LatestQualifiedArtifactQuery,
  PublishBuild,
} from "../../../packages/delivery/src/shared/contract.ts";
import {
  catalogService,
  type CatalogCore,
} from "../../../packages/ops-model/src/delivery-catalog/core.ts";
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
import {
  parseCiImagePinState,
  verifyDigestFile,
  type CiImagePinState,
} from "./update-ci-image-pin-core.ts";

const CI_SERVICE = "ci";
const REPO_ROOT = new URL("../../..", import.meta.url).pathname.replace(
  /\/$/,
  "",
);

/** One `ci` component and the image this commit pins for it. */
export type PinnedCiImage = {
  readonly component: string;
  readonly name: string;
  readonly uri: string;
  readonly pin: CiImagePinState;
};

export type CiServiceClient = RegistrationClient & {
  latestQualifiedArtifact: (
    query: LatestQualifiedArtifactQuery,
  ) => Promise<ArtifactVersion>;
  findQualifiedArtifact: (
    query: FindQualifiedArtifact,
  ) => Promise<ArtifactVersion>;
};

/** How this build fills one component. */
type CiComponentFill =
  | { readonly kind: "retained"; readonly artifactId: string }
  | { readonly kind: "new"; readonly image: PinnedCiImage };

type PinReader = (path: string) => Promise<string>;

/**
 * The pinned image of every component the v2 catalog declares for `ci`, in
 * catalog order. A component without a CI image pin cannot reach R0, so it
 * fails here instead of leaving the service without a set.
 */
export async function pinnedCiImages(
  catalog?: CatalogCore,
  read: PinReader = async (path) =>
    await Bun.file(`${REPO_ROOT}/${path}`).text(),
): Promise<PinnedCiImage[]> {
  const service = catalogService(CI_SERVICE, catalog);
  if (service === undefined)
    throw new Error("The Delivery catalog declares no ci service");
  if (service.components.length === 0)
    throw new Error("The Delivery catalog declares no ci components");
  return Promise.all(
    service.components.map(async (component) => {
      const name = component.name.startsWith("image:")
        ? component.name.slice("image:".length)
        : undefined;
      if (name === undefined || component.producer !== "first-party")
        throw new Error(
          `ci component ${component.name} is not a first-party image with a CI pin`,
        );
      const definition = ciImageDefinition(name);
      const pin = parseCiImagePinState(
        JSON.parse(await read(definition.stateFile)),
      );
      verifyDigestFile(await read(definition.digestFile), pin);
      return {
        component: component.name,
        name,
        uri: definition.repository,
        pin,
      };
    }),
  );
}

async function unlessMissing(
  lookup: () => Promise<ArtifactVersion>,
): Promise<ArtifactVersion | undefined> {
  try {
    return await lookup();
  } catch (error) {
    if (error instanceof DeliveryClientError && error.status === 404) return;
    throw error;
  }
}

/** How one build fills every `ci` component from the pins. */
async function planCiServiceBuild(
  pins: readonly PinnedCiImage[],
  client: Pick<
    CiServiceClient,
    "latestQualifiedArtifact" | "findQualifiedArtifact"
  >,
): Promise<CiComponentFill[]> {
  const fills: CiComponentFill[] = [];
  for (const image of pins) {
    const identity = {
      serviceId: CI_SERVICE,
      component: image.component,
      kind: "image",
    } as const;
    const latest = await unlessMissing(() =>
      client.latestQualifiedArtifact(identity),
    );
    if (latest?.digest === image.pin.digest) {
      fills.push({ kind: "retained", artifactId: latest.id });
      continue;
    }
    const original = await unlessMissing(() =>
      client.findQualifiedArtifact({
        ...identity,
        digest: image.pin.digest,
        originKind: "first-party",
      }),
    );
    fills.push(
      original === undefined
        ? { kind: "new", image }
        : { kind: "retained", artifactId: original.id },
    );
  }
  return fills;
}

/** The `ci` build for this pipeline; each new artifact's bytes must hash to its pin. */
function ciServiceBuild(
  fills: readonly CiComponentFill[],
  context: CiBuildContext,
  manifests: ReadonlyMap<string, string>,
): PublishBuild {
  const prefix = pipelinePrefix(context);
  return {
    requestId: `${prefix}/ci/pinned-images`,
    serviceId: CI_SERVICE,
    sourceRevision: context.sourceRevision,
    ciUrl: context.ciUrl,
    verifiedAt: context.verifiedAt,
    artifacts: fills.flatMap((fill) => {
      if (fill.kind === "retained") return [];
      const { image } = fill;
      const raw = manifests.get(image.component);
      if (raw === undefined)
        throw new Error(`${image.component} was not read back by digest`);
      return [
        {
          id: `${prefix}/image/${image.name}`,
          component: image.component,
          kind: "image" as const,
          uri: image.uri,
          digest: image.pin.digest,
          runtimeDigests: imageRuntimeDigests(raw, image.pin.digest),
          requires: {},
          version: `2.0.0-${String(image.pin.buildNumber)}`,
        },
      ];
    }),
    retainedArtifactIds: fills.flatMap((fill) =>
      fill.kind === "retained" ? [fill.artifactId] : [],
    ),
  };
}

export async function registerCiServiceBuild(input: {
  readonly context: CiBuildContext;
  readonly client: CiServiceClient;
  readonly inspect: ManifestInspector;
  readonly pins: readonly PinnedCiImage[];
}): Promise<{ buildId: string; artifacts: string[] }> {
  const fills = await planCiServiceBuild(input.pins, input.client);
  const manifests = new Map<string, string>();
  for (const fill of fills)
    if (fill.kind === "new")
      manifests.set(
        fill.image.component,
        await input.inspect(`${fill.image.uri}@${fill.image.pin.digest}`),
      );
  const registered = await input.client.publish(
    ciServiceBuild(fills, input.context, manifests),
  );
  console.log(
    `Registered ci pins (${fills
      .map((fill) =>
        fill.kind === "new"
          ? `${fill.image.component} new`
          : `retained ${fill.artifactId}`,
      )
      .join(", ")}) as Delivery build ${registered.buildId}`,
  );
  return registered;
}

async function main(): Promise<void> {
  if (Bun.argv.length > 2)
    throw new Error("Usage: register-ci-service-build.ts");
  const client = createDeliveryClient({
    baseUrl: requireEnv("DELIVERY_URL"),
    headers: { Authorization: `Bearer ${requireEnv("DELIVERY_API_TOKEN")}` },
  });
  await registerCiServiceBuild({
    context: ciBuildContextFromEnv(),
    client,
    inspect: inspectManifest,
    pins: await pinnedCiImages(),
  });
}

if (import.meta.main) {
  await runMain(main);
}

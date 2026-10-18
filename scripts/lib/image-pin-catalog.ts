import {
  ServiceIndex,
  SERVICE_CATALOG,
} from "@shepherdjerred/ops-model/catalog.ts";
import { ArtifactVersionSchema } from "@shepherdjerred/delivery/artifact-contract";
import type { ArtifactVersion } from "@shepherdjerred/delivery/contract";
import {
  APPLICATION_IMAGE_TARGETS,
  INFRASTRUCTURE_IMAGE_TARGETS,
} from "../../ci/scripts/images/image-targets.ts";
import { firstPartyImageRepository } from "@shepherdjerred/version-catalog/image-registry";
import type { DeliveryClient } from "@shepherdjerred/delivery/client";
import { readRequiredHandoff } from "./ci/ci-handoff.ts";
import { z } from "zod";
import { requireEnv } from "./run.ts";

export const CANONICAL_IMAGE_TARGETS = [
  ...APPLICATION_IMAGE_TARGETS,
  ...INFRASTRUCTURE_IMAGE_TARGETS,
];
export type QualifiedImageInventory = ReadonlyMap<string, ArtifactVersion>;

export function imageIdentity(name: string) {
  if (!CANONICAL_IMAGE_TARGETS.includes(name))
    throw new Error(`Unknown CI image recipe ${name}`);
  const owner = new ServiceIndex(SERVICE_CATALOG).byImage(name);
  if (owner === undefined)
    throw new Error(`Image ${name} has no canonical service owner`);
  return {
    serviceId: owner.id,
    component: `image:${name}`,
    kind: "image" as const,
    uri: firstPartyImageRepository(name),
  };
}

/** A reuse record is the original qualified artifact, never a new producer output. */
export function qualifiedImage(name: string, raw: unknown): ArtifactVersion {
  const identity = imageIdentity(name);
  const artifact = ArtifactVersionSchema.parse(raw);
  if (
    artifact.serviceId !== identity.serviceId ||
    artifact.component !== identity.component ||
    artifact.uri !== identity.uri ||
    artifact.kind !== identity.kind ||
    artifact.origin.kind !== "first-party"
  ) {
    throw new Error(
      `Qualified image ${name} differs from its canonical owner/component/repository`,
    );
  }
  return artifact;
}

export function unbuiltImageOriginals(
  inventory: QualifiedImageInventory,
  built: readonly string[],
) {
  const produced = new Set(built);
  return [...inventory]
    .filter(([name]) => !produced.has(name))
    .map(([, artifact]) => artifact);
}

/** Transient immutable chart inputs; these never choose an application deployment. */
export async function chartPublicationImages(
  read = readRequiredHandoff,
  injectedClient?: Pick<DeliveryClient, "latestQualifiedArtifact"> & {
    overview: () => Promise<{
      environments: {
        id: string;
        acceptedVersionSetRevisionId: string | null;
      }[];
    }>;
    version: (id: string) => Promise<{
      serviceId: string;
      components: Record<string, ArtifactVersion>;
    }>;
  },
) {
  let client = injectedClient;
  if (client === undefined) {
    const { createDeliveryClient } =
      await import("@shepherdjerred/delivery/client");
    client = createDeliveryClient({
      baseUrl: requireEnv("DELIVERY_URL"),
      headers: { Authorization: `Bearer ${requireEnv("DELIVERY_API_TOKEN")}` },
    });
  }
  const [rawFresh, rawRetained] = await Promise.all([
    read("delivery-image-digests"),
    read("delivery-retained-image-artifacts"),
  ]);
  const fresh = z
    .record(z.string(), z.string().regex(/^sha256:[a-f0-9]{64}$/u))
    .parse(JSON.parse(rawFresh));
  const retained = z
    .array(ArtifactVersionSchema)
    .parse(JSON.parse(rawRetained));
  const images: Record<string, string> = {};
  for (const original of retained) {
    const name = original.component.slice("image:".length);
    qualifiedImage(name, original);
    const key = `shepherdjerred/${name}`;
    if (images[key] !== undefined || fresh[key] !== undefined)
      throw new Error("Fresh and retained chart image originals overlap");
    images[key] = original.digest;
  }
  for (const [key, digest] of Object.entries(fresh)) {
    const name = key.replace(/^shepherdjerred\//u, "");
    imageIdentity(name);
    if (key !== `shepherdjerred/${name}`)
      throw new Error("Chart image key is not canonical");
    images[key] = digest;
  }
  // A fresh publication is immutable chart input, never a claim of qualification.
  // An unchanged candidate retains the exact already-qualified original.
  images["shepherdjerred/the-storm-server/candidate"] =
    images["shepherdjerred/the-storm-server"] ??
    qualifiedImage(
      "the-storm-server",
      await client.latestQualifiedArtifact({
        serviceId: "minecraft",
        component: "image:the-storm-server",
        kind: "image",
      }),
    ).digest;
  const overview = await client.overview();
  const environment = overview.environments.find(
    (entry) => entry.id === "minecraft/tsmc",
  );
  if (
    environment !== undefined &&
    environment.acceptedVersionSetRevisionId !== null
  ) {
    const accepted = await client.version(
      environment.acceptedVersionSetRevisionId,
    );
    const original = qualifiedImage(
      "the-storm-server",
      accepted.components["image:the-storm-server"],
    );
    if (accepted.serviceId !== "minecraft")
      throw new Error("Accepted Minecraft release owner differs");
    images["shepherdjerred/the-storm-server/accepted"] = original.digest;
  }
  return images;
}

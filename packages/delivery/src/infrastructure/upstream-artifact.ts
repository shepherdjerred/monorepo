import { createHash } from "node:crypto";
import { z } from "zod";
import {
  AcquireUpstreamArtifactSchema,
  ArtifactAcquisitionSchema,
  FindQualifiedArtifactSchema,
} from "#shared/contract.ts";
import type {
  AcquireUpstreamArtifact,
  FindQualifiedArtifact,
  Principal,
} from "#shared/contract.ts";
import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "./auth.ts";
import type { Delivery } from "./delivery.ts";
import {
  audit,
  fingerprint,
  lock,
  remember,
  request,
  required,
  wire,
} from "./delivery-records.ts";
import { id, artifactView } from "./delivery-data.ts";

export type UpstreamFetch = (
  url: string | URL,
  init?: RequestInit,
) => Promise<Response>;
const REPOSITORY = "https://itzg.github.io/minecraft-server-charts/";
const MAX_BYTES = 16 * 1024 * 1024;

function reviewed(input: z.output<typeof AcquireUpstreamArtifactSchema>) {
  const { artifact } = input;
  const origin = artifact.origin;
  if (
    origin.kind !== "upstream" ||
    origin.repository !== REPOSITORY ||
    origin.name !== "minecraft" ||
    artifact.kind !== "chart" ||
    artifact.component !== "chart:minecraft" ||
    !/^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?$/i.test(artifact.version)
  )
    throw new DeliveryError(
      "INVALID",
      "Independent acquisition is restricted to the reviewed upstream Minecraft chart",
    );
  const uri = new URL(artifact.uri);
  if (
    ![
      "https://chartmuseum.sjer.red",
      "https://chartmuseum.tailnet-1a49.ts.net",
    ].includes(uri.origin) ||
    uri.href !== `${uri.origin}/charts/minecraft-${artifact.version}.tgz`
  )
    throw new DeliveryError(
      "INVALID",
      "Upstream chart mirror must be the exact reviewed ChartMuseum archive",
    );
  return {
    originKey: fingerprint({
      kind: origin.kind,
      repository: origin.repository,
      name: origin.name,
      version: origin.version,
    }),
    archive: `https://github.com/itzg/minecraft-server-charts/releases/download/minecraft-${artifact.version}/minecraft-${artifact.version}.tgz`,
  };
}

async function boundedRead(
  url: string,
  transport: UpstreamFetch,
  redirects = 0,
): Promise<Uint8Array> {
  const response = await transport(url, {
    signal: AbortSignal.timeout(30_000),
    redirect: "manual",
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const next = new URL(
      required(response.headers.get("location"), "Upstream archive redirect"),
      url,
    );
    if (
      redirects >= 3 ||
      ![
        "github.com",
        "release-assets.githubusercontent.com",
        "objects.githubusercontent.com",
      ].includes(next.hostname) ||
      next.protocol !== "https:" ||
      next.username !== "" ||
      next.password !== ""
    )
      throw new DeliveryError(
        "INVALID",
        "Upstream archive redirected outside reviewed release hosts",
      );
    return boundedRead(next.href, transport, redirects + 1);
  }
  if (!response.ok || response.body === null)
    throw new DeliveryError(
      "PAUSED",
      `Independent upstream byte verification unavailable (${String(response.status)})`,
    );
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > MAX_BYTES)
        throw new DeliveryError(
          "INVALID",
          "Upstream index or archive exceeds verification size limit",
        );
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}

async function verify(
  input: z.output<typeof AcquireUpstreamArtifactSchema>,
  transport: UpstreamFetch,
) {
  const locations = reviewed(input);
  const bytes = await boundedRead(`${REPOSITORY}index.yaml`, transport);
  const index = z
    .object({
      entries: z.object({
        minecraft: z.array(
          z.object({
            name: z.literal("minecraft"),
            version: z.string(),
            digest: z.string().regex(/^[a-f0-9]{64}$/),
            urls: z.array(z.string()).length(1),
          }),
        ),
      }),
    })
    .parse(Bun.YAML.parse(new TextDecoder().decode(bytes)));
  const selected = index.entries.minecraft.filter(
    (entry) => entry.version === input.artifact.version,
  );
  const entry = selected[0];
  if (
    selected.length !== 1 ||
    entry?.urls[0] !== locations.archive ||
    `sha256:${entry.digest}` !== input.artifact.digest
  )
    throw new DeliveryError(
      "INVALID",
      "Upstream index does not attest the exact reviewed chart version, archive and checksum",
    );
  for (const location of [locations.archive, input.artifact.uri]) {
    const archive = await boundedRead(location, transport);
    const digest = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
    if (digest !== input.artifact.digest)
      throw new DeliveryError(
        "INVALID",
        "Upstream or mirrored archive bytes differ from original upstream checksum",
      );
  }
}

export async function findQualifiedArtifact(
  this: Delivery,
  rawInput: FindQualifiedArtifact,
  repositoryId: number,
) {
  const input = FindQualifiedArtifactSchema.parse(rawInput);
  const row = required(
    await this.database.artifact.findFirst({
      where: {
        component: input.component,
        kind: input.kind,
        digest: input.digest,
        version: input.version,
        origin: { path: ["kind"], equals: input.originKind },
        build: {
          serviceId: input.serviceId,
          status: "verified",
          OR: [
            { sourceKind: "ci", repositoryId },
            {
              sourceKind: { in: ["upstream", "licensed-bundle"] },
              repositoryId: null,
            },
          ],
        },
      },
      include: { build: true },
      orderBy: { createdAt: "asc" },
    }),
    "Exact original qualified artifact",
  );
  return artifactView(row);
}

export async function acquireUpstreamArtifact(
  this: Delivery,
  rawInput: AcquireUpstreamArtifact,
  actor: Principal,
  transport: UpstreamFetch = fetch,
) {
  requireScope(actor, "publish");
  const input = AcquireUpstreamArtifactSchema.parse(rawInput);
  const { originKey } = reviewed(input);
  const buildId = await this.database.$transaction(async (tx) => {
    const prior = await request(tx, actor, {
      requestId: input.requestId,
      input,
      resultType: "upstream-build",
    });
    if (prior !== null) return prior.resultId;
    await lock(tx, `artifact-origin:${originKey}`);
    const original = await tx.artifact.findUnique({
      where: { originKey },
      include: { build: true },
    });
    let owner = original?.buildId;
    if (
      original !== null &&
      (original.build.serviceId !== input.serviceId ||
        original.component !== input.artifact.component ||
        original.digest !== input.artifact.digest ||
        original.uri !== input.artifact.uri ||
        fingerprint(original.origin) !== fingerprint(input.artifact.origin))
    )
      throw new DeliveryError(
        "CONFLICT",
        "Immutable upstream origin already identifies different bytes or provenance",
      );
    if (owner === undefined) {
      owner = id();
      await tx.build.create({
        data: {
          id: owner,
          requestId: input.requestId,
          serviceId: input.serviceId,
          sourceRevision: input.sourceRevision,
          sourceKind: "upstream",
          verifiedAt: new Date(),
          artifacts: { create: { ...input.artifact, originKey } },
        },
      });
    }
    await remember(tx, actor, {
      requestId: input.requestId,
      input,
      resultType: "upstream-build",
      resultId: owner,
    });
    return owner;
  });
  const build = await this.database.build.findUniqueOrThrow({
    where: { id: buildId },
  });
  if (build.status !== "verified") {
    await verify(input, transport);
    await this.database.$transaction(async (tx) => {
      const changed = await tx.build.updateMany({
        where: { id: buildId, status: { in: ["pending", "failed"] } },
        data: {
          status: "verified",
          qualificationReason: null,
          verifiedAt: new Date(),
        },
      });
      if (changed.count > 0)
        await audit(tx, actor, {
          action: "artifact.upstream_verified",
          entityId: buildId,
          requestId: input.requestId,
          metadata: {
            originKey,
            origin: input.artifact.origin,
            digest: input.artifact.digest,
          },
        });
    });
  }
  const original = await this.database.artifact.findUniqueOrThrow({
    where: { originKey },
    include: { build: true },
  });
  return ArtifactAcquisitionSchema.parse(
    wire({
      buildId,
      artifact: artifactView(original),
      status: original.build.status,
    }),
  );
}

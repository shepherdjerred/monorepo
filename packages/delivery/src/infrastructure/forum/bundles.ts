import type { Principal, ArtifactVersion } from "#shared/contract.ts";
import {
  ArtifactAcquisitionSchema,
  ArtifactOriginSchema,
} from "#shared/contract.ts";
import {
  PublishForumBundleSchema,
  QualifiedForumBundleQuerySchema,
} from "#shared/forum-contract.ts";
import type { QualifiedForumBundleQuery } from "#shared/forum-contract.ts";
import type { PublishForumBundle } from "#shared/forum-contract.ts";
import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  audit,
  fingerprint,
  lock,
  remember,
  request,
  required,
} from "#infrastructure/delivery-records.ts";
import {
  id,
  artifactRow,
  artifactView,
} from "#infrastructure/delivery-data.ts";
import { replicationPending } from "#infrastructure/artifact-stores/replication.ts";

export type VerifyForumBundle = (artifact: ArtifactVersion) => Promise<void>;
/** Operator-registered bundle builds: `attested` now, `licensed-bundle` for rows older than that kind. */
const BUNDLE_SOURCE_KINDS = ["licensed-bundle", "attested"];
export async function qualifiedForumBundle(
  this: Delivery,
  rawQuery: QualifiedForumBundleQuery,
  actor: Principal,
) {
  requireScope(actor, actor.scopes.includes("read") ? "read" : "publish");
  const query = QualifiedForumBundleQuerySchema.parse(rawQuery);
  const original = required(
    await this.database.artifact.findFirst({
      where: {
        component: "archive:forum-bundle",
        kind: "archive",
        version: query.xenforoVersion,
        origin: { path: ["manifestDigest"], equals: query.manifestDigest },
        build: {
          serviceId: "storm-forum",
          sourceKind: { in: BUNDLE_SOURCE_KINDS },
          status: "verified",
          repositoryId: null,
        },
      },
      include: { build: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    }),
    "Independently qualified forum bundle matching the reviewed dependency policy",
  );
  const selected = artifactView(original);
  if (selected.origin.kind !== "licensed-bundle")
    throw new DeliveryError(
      "CONFLICT",
      "Qualified forum bundle has corrupt origin",
    );
  return selected;
}
function reviewed(raw: PublishForumBundle) {
  const input = PublishForumBundleSchema.parse(raw),
    origin = input.artifact.origin;
  if (origin.kind !== "licensed-bundle")
    throw new DeliveryError(
      "INVALID",
      "Licensed bundle must match the reviewed neutral dependency manifest",
    );
  return {
    input,
    origin,
    originKey: fingerprint({
      kind: origin.kind,
      digest: input.artifact.digest,
    }),
  };
}

export async function publishForumBundle(
  this: Delivery,
  raw: PublishForumBundle,
  actor: Principal,
) {
  requireScope(actor, "publish");
  const { input, origin, originKey } = reviewed(raw);
  const buildId = await this.database.$transaction(async (tx) => {
    const prior = await request(tx, actor, {
      requestId: input.requestId,
      input,
      resultType: "forum-bundle",
    });
    if (prior !== null) return prior.resultId;
    await lock(tx, `artifact-origin:${originKey}`);
    const original = await tx.artifact.findUnique({
      where: { originKey },
      include: { build: true },
    });
    if (
      original !== null &&
      (original.build.serviceId !== "storm-forum" ||
        original.component !== input.artifact.component ||
        original.uri !== input.artifact.uri ||
        original.version !== input.artifact.version ||
        original.origin === null)
    )
      throw new DeliveryError(
        "CONFLICT",
        "Licensed bundle origin already identifies different bytes or provenance",
      );
    // Reacquisition preserves the first independent producer identity, never relabels old bytes as a new CI build.
    if (original !== null) {
      const recorded = ArtifactOriginSchema.parse(original.origin);
      if (
        recorded.kind !== "licensed-bundle" ||
        recorded.manifestDigest !== origin.manifestDigest
      )
        throw new DeliveryError(
          "CONFLICT",
          "Licensed bundle dependency policy is immutable",
        );
    }
    const owner = original?.buildId ?? id();
    if (original === null)
      await tx.build.create({
        data: {
          id: owner,
          requestId: input.requestId,
          serviceId: "storm-forum",
          sourceRevision: origin.producerSourceRevision,
          sourceKind: "attested",
          verifiedAt: new Date(),
          artifacts: { create: { ...artifactRow(input.artifact), originKey } },
        },
      });
    await remember(tx, actor, {
      requestId: input.requestId,
      input,
      resultType: "forum-bundle",
      resultId: owner,
    });
    await audit(tx, actor, {
      action: "forum.bundle_published",
      entityId: owner,
      requestId: input.requestId,
      metadata: { digest: input.artifact.digest, originKey },
    });
    return owner;
  });
  return forumBundle.call(this, buildId);
}

async function forumBundle(this: Delivery, buildId: string) {
  const build = required(
    await this.database.build.findUnique({
      where: { id: buildId },
      include: { artifacts: true },
    }),
    "Licensed bundle build",
  );
  if (
    !BUNDLE_SOURCE_KINDS.includes(build.sourceKind) ||
    build.serviceId !== "storm-forum" ||
    build.artifacts.length !== 1
  )
    throw new DeliveryError(
      "INVALID",
      "Expected an independent licensed forum bundle build",
    );
  const row = build.artifacts[0];
  if (row === undefined)
    throw new DeliveryError("NOT_FOUND", "Licensed archive missing");
  return ArtifactAcquisitionSchema.parse({
    buildId,
    status: build.status,
    artifact: artifactView({ ...row, build }),
  });
}

export async function pendingForumBundles(this: Delivery, actor: Principal) {
  requireScope(actor, "execute");
  const builds = await this.database.build.findMany({
    where: {
      serviceId: "storm-forum",
      sourceKind: { in: BUNDLE_SOURCE_KINDS },
      status: "pending",
    },
    orderBy: [
      { qualificationCheckedAt: { sort: "asc", nulls: "first" } },
      { createdAt: "asc" },
    ],
    take: 10,
  });
  return { builds: builds.map((build) => ({ id: build.id })) };
}

export async function qualifyForumBundle(
  this: Delivery,
  buildId: string,
  actor: Principal,
  verify: VerifyForumBundle,
) {
  requireScope(actor, "execute");
  const current = await forumBundle.call(this, buildId);
  if (current.status !== "pending") return current;
  await this.database.build.update({
    where: { id: buildId },
    data: { qualificationCheckedAt: new Date() },
  });
  // PC1: the licensed bytes get an off-cluster replica before anything reads them.
  if (await replicationPending(this.database, buildId)) return current;
  let status: "verified" | "failed" = "verified",
    reason: string | null = null;
  try {
    await verify(current.artifact);
  } catch (error) {
    if (!(error instanceof DeliveryError && error.code === "INVALID"))
      throw error;
    status = "failed";
    reason = error.message;
  }
  await this.database.$transaction(async (tx) => {
    const changed = await tx.build.updateMany({
      where: { id: buildId, status: "pending" },
      data: { status, qualificationReason: reason, verifiedAt: new Date() },
    });
    if (changed.count > 0)
      await audit(tx, actor, {
        action: `forum.bundle_${status}`,
        entityId: buildId,
        requestId: id(),
        metadata: { digest: current.artifact.digest },
      });
  });
  return forumBundle.call(this, buildId);
}

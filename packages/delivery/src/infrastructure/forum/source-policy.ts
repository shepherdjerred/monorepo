import { ForumBundlePolicySchema } from "@shepherdjerred/ops-model/forum-bundle-policy.ts";
import type { forumBundlePolicy } from "@shepherdjerred/ops-model/forum-bundle-policy.ts";
import { forumBundlePolicyDigest } from "@shepherdjerred/ops-model/forum-bundle-digest.ts";
import type { ArtifactVersion, CreateDeployment } from "#shared/contract.ts";
import { LegacyPipelineRevisionSchema } from "#shared/contract.ts";
import { DeliveryError } from "#domain/error.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { required, wire } from "#infrastructure/delivery-records.ts";
import { version, environment } from "#infrastructure/delivery-data.ts";

export type ForumPolicyReader = (
  revision: string,
) => Promise<typeof forumBundlePolicy>;
type Transport = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
/** Immutable trusted repository source, never caller-chosen URLs, product-config fallback or API-compiled policy. */
export function createForumPolicyReader(
  transport: Transport = fetch,
): ForumPolicyReader {
  return async (revision) => {
    if (!/^[a-f0-9]{40}$/u.test(revision))
      throw new DeliveryError(
        "INVALID",
        "Forum policy requires an immutable original producer revision",
      );
    const response = await transport(
      `https://raw.githubusercontent.com/shepherdjerred/monorepo/${revision}/packages/ops-model/src/forum-bundle-policy.json`,
      { redirect: "error", signal: AbortSignal.timeout(15_000) },
    );
    if (response.status === 404)
      throw new DeliveryError(
        "INVALID",
        "Original source revision has no reviewed neutral forum dependency policy",
      );
    if (response.status !== 200 || response.body === null)
      throw new DeliveryError(
        "PAUSED",
        `Immutable forum policy source unavailable (${String(response.status)})`,
      );
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.length;
        if (size > 32 * 1024)
          throw new DeliveryError(
            "INVALID",
            "Immutable forum policy exceeds its bounded source size",
          );
        chunks.push(item.value);
      }
    } finally {
      await reader.cancel();
    }
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new DeliveryError(
        "INVALID",
        "Original source contains invalid policy JSON",
      );
    }
    const parsed = ForumBundlePolicySchema.safeParse(raw);
    if (!parsed.success)
      throw new DeliveryError(
        "INVALID",
        "Original source contains an invalid neutral forum policy",
      );
    return parsed.data;
  };
}
export function requireBundlePolicy(
  bundle: ArtifactVersion,
  policy: typeof forumBundlePolicy,
) {
  if (
    bundle.origin.kind !== "licensed-bundle" ||
    bundle.origin.manifestDigest !== forumBundlePolicyDigest(policy) ||
    bundle.origin.xenforoVersion !== policy.xenforoVersion ||
    bundle.version !== policy.xenforoVersion
  )
    throw new DeliveryError(
      "INVALID",
      "Licensed bundle differs from its original runtime/producer source dependency policy",
    );
}

/** Run before the PG admission transaction; qualified artifact identities and source revisions are immutable. */
export async function verifyForumCandidateSource(
  this: Delivery,
  input: CreateDeployment,
  read: ForumPolicyReader = createForumPolicyReader(),
) {
  if (input.kind === "rollback") return;
  const env = await environment(this.database, input.environmentId);
  if (env.serviceId !== "storm-forum") return;
  const pipeline = LegacyPipelineRevisionSchema.parse(
      wire(
        required(
          await this.database.pipeline.findUnique({
            where: { id: env.pipelineRevisionId },
          }),
          "Forum pipeline",
        ),
      ),
    ),
    definition = pipeline.definition;
  if (definition.kind !== "argocd" || definition.forumRelease === undefined)
    throw new DeliveryError(
      "INVALID",
      "Forum candidate requires its canonical release pipeline",
    );
  const selected = await version(this.database, input.versionSetRevisionId),
    image = selected.components[definition.forumRelease.imageComponent],
    bundle = selected.components[definition.forumRelease.bundleComponent];
  if (
    bundle === undefined ||
    image?.origin.kind !== "first-party" ||
    image.kind !== "image" ||
    image.uri !== "docker.io/shepherdjerred/storm-forum"
  )
    throw new DeliveryError(
      "INVALID",
      "Forum candidate requires its original qualified runtime and licensed bundle",
    );
  requireBundlePolicy(bundle, await read(image.sourceRevision));
}

import { z } from "zod";
import { ForumBundlePolicySchema } from "@shepherdjerred/ops-model/forum-bundle-policy.ts";
import type { ForumPolicyReader } from "./source-policy.ts";
import { createForumPolicyReader } from "./source-policy.ts";
import { DeliveryError } from "#domain/error.ts";

type Transport = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
export type OriginalForumPolicy = {
  policy: Awaited<ReturnType<ForumPolicyReader>>;
  legacy: boolean;
};
class MissingNeutralPolicy extends Error {}
/** Only original acquisition/adoption may read the reviewed pre-extraction product manifest. Candidates remain neutral-policy strict. */
export function createOriginalForumPolicyReader(transport: Transport = fetch) {
  return async (revision: string): Promise<OriginalForumPolicy> => {
    const neutral = createForumPolicyReader(async (input, init) => {
      const response = await transport(input, init);
      if (response.status === 404) throw new MissingNeutralPolicy();
      return response;
    });
    try {
      return { policy: await neutral(revision), legacy: false };
    } catch (error) {
      if (!(error instanceof MissingNeutralPolicy)) throw error;
    }
    // The strict reader already validated the exact immutable 40-character revision.
    const response = await transport(
      `https://raw.githubusercontent.com/shepherdjerred/monorepo/${revision}/packages/storm-forum/config/forum.json`,
      { redirect: "error", signal: AbortSignal.timeout(15_000) },
    );
    if (response.status !== 200 || response.body === null)
      throw new DeliveryError(
        response.status === 404 ? "INVALID" : "PAUSED",
        "Original legacy forum manifest is unavailable",
      );
    const reader = response.body.getReader();
    const bytes: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 32 * 1024)
          throw new DeliveryError(
            "INVALID",
            "Original legacy forum manifest exceeds its bounded source size",
          );
        bytes.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    let raw: unknown;
    try {
      raw = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(bytes)),
      );
    } catch {
      throw new DeliveryError(
        "INVALID",
        "Original legacy forum manifest is not valid JSON",
      );
    }
    const manifest = z
      .object({
        schemaVersion: z.literal(1),
        xenforoVersion: z.unknown(),
        vendorDependencies: z.unknown(),
      })
      .safeParse(raw);
    if (!manifest.success)
      throw new DeliveryError(
        "INVALID",
        "Original legacy forum manifest lacks its licensed dependency declaration",
      );
    const parsed = ForumBundlePolicySchema.safeParse(manifest.data);
    if (!parsed.success)
      throw new DeliveryError(
        "INVALID",
        "Original legacy forum dependency declaration is invalid",
      );
    return { policy: parsed.data, legacy: true };
  };
}

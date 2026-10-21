import { ciImageDefinition, type CiImageName } from "./build-ci-image-core.ts";
import {
  canonicalDigest,
  exactRecord,
  type CiImageCandidate,
  type CiImagePinState,
} from "./update-ci-image-pin-core.ts";

/**
 * What one refresh decided for its own candidate. Only a candidate whose digest
 * the promotion carries is registered as a Delivery `ci` build; a declined one
 * leaves the current qualified artifact in place.
 */
export type CiImagePromotionOutcome = {
  readonly schema: "ci-image-promotion-outcome/v1";
  readonly image: CiImageName;
  readonly digest: string;
  readonly promoted: boolean;
  readonly reason: string;
};

export function promotionOutcome(
  candidate: CiImageCandidate,
  promoted: boolean,
  reason: string,
): CiImagePromotionOutcome {
  return {
    schema: "ci-image-promotion-outcome/v1",
    image: candidate.image,
    digest: candidate.digest,
    promoted,
    reason,
  };
}

/**
 * The outcome once the promotion pull request write finished. `carried` is the
 * state the branch now holds, which may be a newer pending pin, or undefined
 * when a promotion that became ready meanwhile deferred the write.
 */
export function carriedPromotionOutcome(
  candidate: CiImageCandidate,
  carried: CiImagePinState | undefined,
): CiImagePromotionOutcome {
  if (carried === undefined)
    return promotionOutcome(
      candidate,
      false,
      "a ready promotion is already pending",
    );
  return carried.digest === candidate.digest
    ? promotionOutcome(candidate, true, "promotion pull request carries it")
    : promotionOutcome(candidate, false, "a newer pending promotion is kept");
}

function requiredBoolean(value: unknown, description: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${description} must be a boolean`);
  }
  return value;
}

function nonEmptyString(value: unknown, description: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${description} must be a non-empty string`);
  }
  return value;
}

export function parseCiImagePromotionOutcome(
  value: unknown,
): CiImagePromotionOutcome {
  const record = exactRecord(
    value,
    ["schema", "image", "digest", "promoted", "reason"],
    "CI image promotion outcome",
  );
  if (record["schema"] !== "ci-image-promotion-outcome/v1") {
    throw new TypeError("CI image promotion outcome has an unsupported schema");
  }
  return {
    schema: "ci-image-promotion-outcome/v1",
    image: ciImageDefinition(
      nonEmptyString(record["image"], "promotion outcome image"),
    ).name,
    digest: canonicalDigest(record["digest"], "promotion outcome digest"),
    promoted: requiredBoolean(record["promoted"], "promotion outcome promoted"),
    reason: nonEmptyString(record["reason"], "promotion outcome reason"),
  };
}

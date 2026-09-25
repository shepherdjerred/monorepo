import { runAllowExit } from "../../../scripts/lib/run.ts";
import {
  CI_IMAGE_IGNORED_ENV_PREFIXES,
  imageRuntimeFingerprint,
} from "./application-image-runtime.ts";
import type { CiImageDefinition } from "./build-ci-image-core.ts";
import {
  classifyCiImageRuntimePromotion,
  pendingFirstPinCoversCandidate,
  type CiImagePinState,
} from "./update-ci-image-pin-core.ts";

export async function runtimeFingerprint(
  image: string,
  env: Record<string, string>,
): Promise<string | undefined> {
  return imageRuntimeFingerprint(
    image,
    async (command) => {
      return runAllowExit([...command], { env, capture: true });
    },
    CI_IMAGE_IGNORED_ENV_PREFIXES,
  );
}

/**
 * Declines promotion when the candidate adds no runtime change. Before an
 * image's first pin merges the baseline is the pending first pin: rebuilds are
 * not byte-reproducible, so without it every refresh would replace the pending
 * PR (cancelling its CI) with a runtime-identical candidate.
 */
export async function runtimeGateSkips(options: {
  readonly definition: CiImageDefinition;
  readonly currentPendingState: CiImagePinState | undefined;
  readonly mainState: CiImagePinState | undefined;
  readonly promoted: CiImagePinState;
  readonly env: Record<string, string>;
  /** Records a declined promotion against the main pin. */
  readonly skip: (reason: string) => Promise<void>;
}): Promise<boolean> {
  const { definition, mainState, promoted, env } = options;
  const readFingerprint = async (image: string) =>
    runtimeFingerprint(image, env);
  if (mainState === undefined) {
    if (
      await pendingFirstPinCoversCandidate(
        definition.repository,
        options.currentPendingState,
        promoted,
        readFingerprint,
      )
    ) {
      console.log(
        `${definition.name} pending first pin already has this runtime content; leaving it in place`,
      );
      return true;
    }
    console.log(`${definition.name} has no pin yet; promoting its first build`);
    return false;
  }
  const runtimeOutcome = await classifyCiImageRuntimePromotion(
    {
      repository: definition.repository,
      pinnedDigest: mainState.digest,
      candidateDigest: promoted.digest,
    },
    readFingerprint,
  );
  if (runtimeOutcome === "content-unchanged") {
    await options.skip("candidate runtime content is unchanged");
    return true;
  }
  if (runtimeOutcome === "pin-unresolvable-bumped") {
    console.warn(
      `${definition.name} current pin could not be fingerprinted; promoting the verified candidate`,
    );
  }
  return false;
}

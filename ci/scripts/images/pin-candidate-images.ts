import { imageIdentity } from "../../../scripts/lib/image-pin-catalog.ts";

/** Immutable receipt of this producer's outputs; Workflow routing belongs only to PG. */
export function pinCandidatesForDigests(
  digests: Readonly<Record<string, string>>,
  buildNumber: string,
  gitSha: string,
) {
  if (!/^[0-9a-f]{40}$/.test(gitSha))
    throw new Error("Image source commit must be a 40-character lowercase SHA");
  if (
    !/^[1-9]\d*$/.test(buildNumber) ||
    !Number.isSafeInteger(Number(buildNumber))
  )
    throw new Error("Image build number must be a positive safe integer");
  return Object.fromEntries(
    Object.entries(digests).map(([key, digest]) => {
      const name = key.replace(/^shepherdjerred\//u, "");
      imageIdentity(name);
      if (
        key !== `shepherdjerred/${name}` ||
        !/^sha256:[a-f0-9]{64}$/.test(digest)
      )
        throw new Error(
          "Fresh image receipt requires canonical image identity and digest",
        );
      return [key, { version: `2.0.0-${buildNumber}`, digest, gitSha }];
    }),
  );
}

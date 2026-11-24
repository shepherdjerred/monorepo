import { requireFirstPartyImage } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

/** No image means the parallel application is not installed. Delivery binds
 * the synthesis recipe to the deployment's frozen immutable artifact.
 */
export function mediaImageReference(
  image: string | undefined,
): string | undefined {
  return image === undefined
    ? undefined
    : requireFirstPartyImage("media", image);
}

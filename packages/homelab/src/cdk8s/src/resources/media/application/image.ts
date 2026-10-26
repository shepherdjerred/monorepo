/** No image means the parallel application is not installed. Delivery binds
 * the synthesis recipe to the deployment's frozen immutable artifact.
 */
export function mediaImageReference(
  image: string | undefined,
): string | undefined {
  if (image === undefined) return undefined;
  if (image === "docker.io/shepherdjerred/media:delivery-recipe") return image;
  const digest =
    /^docker\.io\/shepherdjerred\/media@(sha256:[a-f0-9]{64})$/u.exec(
      image,
    )?.[1];
  if (digest === undefined || digest === `sha256:${"0".repeat(64)}`)
    throw new Error("Media requires a published immutable image digest");
  return image;
}

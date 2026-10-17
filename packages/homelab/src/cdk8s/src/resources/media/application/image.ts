const UNPUBLISHED_VERSION = `0.0.0@sha256:${"0".repeat(64)}`;

export function mediaImageReference(version: string): string | undefined {
  if (version === UNPUBLISHED_VERSION) return undefined;
  const digest =
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?@(sha256:[a-f0-9]{64})$/u.exec(
      version,
    )?.[1];
  if (digest === undefined || digest === `sha256:${"0".repeat(64)}`)
    throw new Error("Media requires a published immutable image digest");
  return `docker.io/shepherdjerred/media@${digest}`;
}

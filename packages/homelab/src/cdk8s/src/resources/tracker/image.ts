const UNPUBLISHED_DIGEST = `sha256:${"0".repeat(64)}`;

export function trackerImageReference(version: string): string | undefined {
  const digest = /@(sha256:[a-f0-9]{64})$/u.exec(version)?.[1];
  return digest === undefined || digest === UNPUBLISHED_DIGEST
    ? undefined
    : `ghcr.io/shepherdjerred/tracker@${digest}`;
}

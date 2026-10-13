/**
 * Registry migration compatibility. Both names identify this repository's
 * policy image; neither permits mutable tags or another namespace. Remove
 * GHCR only after the Docker Hub release has passed live acceptance.
 */
export function requireGateImage(value: string): string {
  if (
    !/^(?:ghcr\.io|docker\.io)\/shepherdjerred\/woodpecker-config-extension(?::[^@\s]+)?@sha256:[a-f\d]{64}$/u.test(
      value,
    )
  ) {
    throw new Error(
      "CI_GATE_IMAGE must pin the deployed policy image by digest",
    );
  }
  return value;
}

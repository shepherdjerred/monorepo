import { run } from "./run.ts";

/**
 * Return an image's uncompressed rootfs layer chain (DiffIDs). Config-only
 * rebuilds may change an image digest without changing these content layers.
 */
export async function imageLayers(ref: string): Promise<string> {
  const result = await run(
    [
      "docker",
      "buildx",
      "imagetools",
      "inspect",
      ref,
      "--format",
      "{{json .Image.RootFS.DiffIDs}}",
    ],
    { capture: true },
  );
  return result.stdout.trim();
}

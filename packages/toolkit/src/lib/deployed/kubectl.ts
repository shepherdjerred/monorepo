/**
 * kubectl layer for `toolkit deployed`.
 *
 * The gold deployment signal: a running pod whose container `imageID` digest
 * matches the versions.ts pin. We scan all pods cluster-wide once and match by
 * image substring on the versionKey, sidestepping per-service namespace
 * mapping (mirrors the guide's `kubectl ... | grep shepherdjerred`).
 *
 * Note: the "@sha256:..." digest lives in `imageID`, not `image` (which carries
 * the tag). Degrades to null when kubectl is unavailable or the cluster is
 * unreachable.
 */
import { $ } from "bun";
import { PodListSchema } from "./schemas.ts";
import type { RunningPod } from "./types.ts";

const DIGEST_RE = /@(sha256:[a-f0-9]+)/;

export type PodScanResult =
  | { ok: true; pods: RunningPod[] }
  | { ok: false; reason: string };

let cache: PodScanResult | null = null;

/** Fetch + parse all running pods once per process (cached). */
export async function scanPods(): Promise<PodScanResult> {
  if (cache != null) {
    return cache;
  }
  const result = await $`kubectl get pods -A -o json`.nothrow().quiet();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    cache = {
      ok: false,
      reason:
        stderr.length > 0
          ? (stderr.split("\n").at(-1) ?? "kubectl error")
          : `kubectl exited with code ${String(result.exitCode)}`,
    };
    return cache;
  }

  let json: unknown;
  try {
    json = JSON.parse(result.stdout.toString());
  } catch {
    cache = { ok: false, reason: "kubectl returned non-JSON output" };
    return cache;
  }

  const parsed = PodListSchema.safeParse(json);
  if (!parsed.success) {
    cache = { ok: false, reason: "kubectl output failed schema validation" };
    return cache;
  }

  const pods: RunningPod[] = [];
  for (const item of parsed.data.items) {
    const namespace = item.metadata?.namespace ?? "";
    const pod = item.metadata?.name ?? "";
    for (const cs of item.status?.containerStatuses ?? []) {
      const image = cs.image ?? "";
      const imageID = cs.imageID ?? "";
      const digestMatch = DIGEST_RE.exec(imageID);
      pods.push({
        namespace,
        pod,
        container: cs.name ?? "",
        image,
        imageID,
        digest: digestMatch?.[1] ?? null,
      });
    }
  }
  cache = { ok: true, pods };
  return cache;
}

/** Pods whose image references the given versionKey (e.g. "shepherdjerred/birmel"). */
export function podsForVersionKey(
  pods: RunningPod[],
  versionKey: string,
): RunningPod[] {
  // Match the image repo path, ignoring any "/beta" | "/prod" variant suffix —
  // the ghcr image is "ghcr.io/shepherdjerred/<image>", with no variant in the
  // path. Match against imageID too: some runtimes report `.image` as a bare
  // config sha, with the repo path only present in `.imageID`.
  const imagePath = versionKey.split("/").slice(0, 2).join("/");
  return pods.filter(
    (p) => p.image.includes(imagePath) || p.imageID.includes(imagePath),
  );
}

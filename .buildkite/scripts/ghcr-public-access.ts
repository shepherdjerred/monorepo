import { asRecord } from "../../scripts/lib/json.ts";

const manifestAccept = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

type AnonymousPullOptions = {
  readonly fetcher?: typeof fetch;
  readonly sleeper?: (milliseconds: number) => Promise<unknown>;
  readonly attempts?: number;
  readonly delayMilliseconds?: number;
};

export type AnonymousPullVerifier = (
  name: string,
  reference: string,
) => Promise<void>;

export function anonymousPullVerifier(
  dependency: AnonymousPullVerifier | undefined,
): AnonymousPullVerifier {
  return dependency ?? ensureAnonymousGhcrPull;
}

export async function ensureAnonymousGhcrPull(
  name: string,
  reference: string,
  options: AnonymousPullOptions = {},
): Promise<void> {
  const fetcher = options.fetcher ?? fetch;
  const sleeper = options.sleeper ?? Bun.sleep;
  const attempts = options.attempts ?? 6;
  const delayMilliseconds = options.delayMilliseconds ?? 2000;
  const tokenUrl = new URL("https://ghcr.io/token");
  tokenUrl.searchParams.set("scope", `repository:shepherdjerred/${name}:pull`);
  tokenUrl.searchParams.set("service", "ghcr.io");
  const manifestUrl = `https://ghcr.io/v2/shepherdjerred/${encodeURIComponent(name)}/manifests/${encodeURIComponent(reference)}`;
  let failure = "anonymous pull probe did not run";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const tokenResponse = await fetcher(tokenUrl, {
        signal: AbortSignal.timeout(20_000),
      });
      if (tokenResponse.ok) {
        const token = asRecord(await tokenResponse.json())?.["token"];
        if (typeof token !== "string" || token.length === 0) {
          throw new Error("GHCR anonymous token response omitted token");
        }
        const manifestResponse = await fetcher(manifestUrl, {
          headers: {
            Accept: manifestAccept,
            Authorization: `Bearer ${token}`,
          },
          signal: AbortSignal.timeout(20_000),
        });
        if (manifestResponse.ok) return;
        failure = `manifest endpoint returned HTTP ${manifestResponse.status.toString()}`;
      } else {
        failure = `token endpoint returned HTTP ${tokenResponse.status.toString()}`;
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    if (attempt < attempts) {
      console.log(
        `waiting for anonymous GHCR pull access: ${name}:${reference} (${attempt.toString()}/${attempts.toString()}): ${failure}`,
      );
      await sleeper(delayMilliseconds);
    }
  }

  throw new Error(
    `GHCR package shepherdjerred/${name} is not anonymously pullable at ${reference}: ${failure}. Application images must be public and carry the monorepo OCI source label.`,
  );
}

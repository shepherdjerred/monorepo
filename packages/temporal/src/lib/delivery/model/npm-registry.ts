import { z } from "zod";

/** The public npm registry, the audience-facing store of npm channels (X12). */
export const NPM_REGISTRY = "https://registry.npmjs.org";

/**
 * The dist-tag a publish lands under before the pointer step moves the
 * channel: a new version reaches the audience only when its pointer moves.
 */
export const NPM_STAGING_TAG = "delivery-staged";

const PackumentSchema = z.looseObject({
  "dist-tags": z.record(z.string(), z.string()).default({}),
  versions: z
    .record(
      z.string(),
      z.looseObject({
        dist: z.looseObject({
          integrity: z.string().min(1),
          shasum: z.string().regex(/^[a-f0-9]{40}$/u),
          tarball: z.url(),
        }),
      }),
    )
    .default({}),
});
export type Packument = z.infer<typeof PackumentSchema>;

/** A package name in a registry path: a scope keeps its `@`, its slash is escaped. */
export function packagePath(name: string): string {
  if (!/^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/u.test(name))
    throw new Error(`${name} is not an npm package name`);
  return name.replace("/", "%2F");
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The registry operations a channel step uses; `token` authenticates writes. */
export function npmRegistry(options: {
  token: string | undefined;
  fetch?: Fetch;
  signal?: AbortSignal;
}) {
  const request: Fetch =
    options.fetch ?? (async (url, init) => await fetch(url, init));
  const signal = () =>
    AbortSignal.any([
      ...(options.signal === undefined ? [] : [options.signal]),
      AbortSignal.timeout(30_000),
    ]);
  const token = () => {
    if (options.token === undefined || options.token === "")
      throw new Error("The npm channel credential is not configured");
    return options.token;
  };
  return {
    /** The full packument, or null when the package was never published. */
    async packument(name: string): Promise<Packument | null> {
      const response = await request(`${NPM_REGISTRY}/${packagePath(name)}`, {
        headers: { accept: "application/json", "cache-control": "no-cache" },
        signal: signal(),
      });
      if (response.status === 404) return null;
      if (!response.ok)
        throw new Error(
          `npm registry returned HTTP ${response.status.toString()} for ${name}`,
        );
      return PackumentSchema.parse(await response.json());
    },
    async tarball(url: string): Promise<Uint8Array> {
      const response = await request(url, { signal: signal() });
      if (!response.ok)
        throw new Error(
          `npm registry returned HTTP ${response.status.toString()} for ${url}`,
        );
      return new Uint8Array(await response.arrayBuffer());
    },
    /** Move one dist-tag; the registry's own readback confirms it. */
    async setTag(name: string, tag: string, version: string): Promise<void> {
      const response = await request(
        `${NPM_REGISTRY}/-/package/${packagePath(name)}/dist-tags/${encodeURIComponent(tag)}`,
        {
          method: "PUT",
          headers: {
            authorization: `Bearer ${token()}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(version),
          signal: signal(),
        },
      );
      if (!response.ok)
        throw new Error(
          `npm refused dist-tag ${tag} for ${name}@${version}: HTTP ${response.status.toString()}`,
        );
    },
    async removeTag(name: string, tag: string): Promise<void> {
      const response = await request(
        `${NPM_REGISTRY}/-/package/${packagePath(name)}/dist-tags/${encodeURIComponent(tag)}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${token()}` },
          signal: signal(),
        },
      );
      if (!response.ok && response.status !== 404)
        throw new Error(
          `npm refused removing dist-tag ${tag} of ${name}: HTTP ${response.status.toString()}`,
        );
    },
    token,
  };
}
export type NpmRegistry = ReturnType<typeof npmRegistry>;

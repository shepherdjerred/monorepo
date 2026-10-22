/**
 * npm package tarballs as Delivery archives (model X12).
 *
 * A package released to npm is a `channel` environment's artifact: CI packs
 * it, freezes the tarball in `delivery-artifacts` by digest, and registers it
 * under the package's catalog service. The channel deployment publishes the
 * version if npm lacks it and moves the dist-tag; CI never publishes.
 *
 * The artifact for a version is what npm serves for it: once a version is
 * published its registry bytes are frozen, so an unchanged release keeps one
 * digest across builds. An unpublished version is the reproducible
 * `bun pm pack` of the source, which the channel then publishes as-is.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { ArtifactInputSchema } from "@shepherdjerred/delivery/contract";

/** An npm package one catalog channel environment releases. */
export type NpmChannelPackage = {
  readonly serviceId: string;
  /** The npm package name, as the channel recipe names it. */
  readonly name: string;
  readonly directory: string;
  readonly component: string;
};

export const NPM_CHANNEL_PACKAGES: readonly NpmChannelPackage[] = [
  {
    serviceId: "webring",
    name: "webring",
    directory: "packages/webring",
    component: "archive:webring-package",
  },
];

/** Build-scoped handoff the archive producer writes and registration reads. */
export const NPM_PACKAGE_HANDOFF = "npm-package-artifacts";

const ARCHIVE_BUCKET = "delivery-artifacts";
const DigestSchema = z.string().regex(/^sha256:[a-f\d]{64}$/u);
const VersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u);

export function npmPackageDigest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function npmPackageArchiveUri(
  pkg: NpmChannelPackage,
  digest: string,
): string {
  return `s3://${ARCHIVE_BUCKET}/npm/${pkg.serviceId}/${DigestSchema.parse(digest).slice("sha256:".length)}.tgz`;
}

export function npmPackageArtifactId(
  execution: { repositoryId: number; pipelineNumber: number },
  pkg: NpmChannelPackage,
): string {
  return `ci/${String(execution.repositoryId)}/${String(execution.pipelineNumber)}/npm/${pkg.serviceId}`;
}

/** What npm serves for one exact version, verified against its own integrity. */
export type PublishedTarballReader = (
  name: string,
  version: string,
) => Promise<Uint8Array | null>;

const PackumentSchema = z.looseObject({
  versions: z
    .record(
      z.string(),
      z.looseObject({
        dist: z.looseObject({
          integrity: z.string().regex(/^sha512-[A-Za-z\d+/]+=*$/u),
          tarball: z.url(),
        }),
      }),
    )
    .default({}),
});

/** The public registry's tarball for `name@version`, or null when unpublished. */
export function registryTarballReader(
  fetcher: (url: string) => Promise<Response> = async (url) =>
    await fetch(url, { signal: AbortSignal.timeout(30_000) }),
): PublishedTarballReader {
  return async (name, version) => {
    const packument = await fetcher(
      `https://registry.npmjs.org/${name.replace("/", "%2F")}`,
    );
    if (packument.status === 404) return null;
    if (!packument.ok)
      throw new Error(
        `npm registry returned HTTP ${String(packument.status)} for ${name}`,
      );
    const dist = PackumentSchema.parse(await packument.json()).versions[version]
      ?.dist;
    if (dist === undefined) return null;
    const tarball = await fetcher(dist.tarball);
    if (!tarball.ok)
      throw new Error(
        `npm registry returned HTTP ${String(tarball.status)} for ${dist.tarball}`,
      );
    const bytes = new Uint8Array(await tarball.arrayBuffer());
    const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    if (integrity !== dist.integrity)
      throw new Error(
        `npm served ${name}@${version} bytes that fail its own integrity`,
      );
    return bytes;
  };
}

/**
 * The tarball to freeze for a package's current version: npm's own bytes for
 * a published version, the reproducible pack otherwise.
 */
export async function npmPackageTarball(
  pkg: NpmChannelPackage,
  dependencies: {
    /** `bun pm pack` of the built package and the version its manifest declares. */
    pack: (
      directory: string,
    ) => Promise<{ bytes: Uint8Array; name: string; version: string }>;
    published: PublishedTarballReader;
  },
): Promise<{ bytes: Uint8Array; version: string; published: boolean }> {
  const packed = await dependencies.pack(pkg.directory);
  if (packed.name !== pkg.name)
    throw new Error(
      `${pkg.directory} packs ${packed.name}, not the channel's ${pkg.name}`,
    );
  const version = VersionSchema.parse(packed.version);
  const published = await dependencies.published(pkg.name, version);
  return published === null
    ? { bytes: packed.bytes, version, published: false }
    : { bytes: published, version, published: true };
}

const NpmPackagePublicationSchema = z
  .object({ serviceId: z.string().min(1), artifact: ArtifactInputSchema })
  .strict();
export type NpmPackagePublication = z.output<
  typeof NpmPackagePublicationSchema
>;

/**
 * Exactly one first-party tarball per channel package, each at the URI of
 * its own digest. With `execution`, every artifact must carry this CI
 * execution's identity, so a receipt cannot be replayed from another run.
 */
export function parseNpmPackagePublications(
  raw: unknown,
  execution?: { repositoryId: number; pipelineNumber: number },
): NpmPackagePublication[] {
  const entries = z.array(NpmPackagePublicationSchema).parse(raw);
  const unknown = entries.find(
    (entry) =>
      !NPM_CHANNEL_PACKAGES.some((pkg) => pkg.serviceId === entry.serviceId),
  );
  if (unknown !== undefined)
    throw new Error(
      `npm package handoff names unknown service ${unknown.serviceId}`,
    );
  return NPM_CHANNEL_PACKAGES.map((pkg) => {
    const [entry, ...others] = entries.filter(
      (candidate) => candidate.serviceId === pkg.serviceId,
    );
    if (entry === undefined || others.length > 0)
      throw new Error(
        `npm package handoff must hold exactly one ${pkg.component} for ${pkg.serviceId}`,
      );
    const { artifact } = entry;
    if (
      artifact.kind !== "archive" ||
      artifact.component !== pkg.component ||
      artifact.origin.kind !== "first-party" ||
      artifact.uri !== npmPackageArchiveUri(pkg, artifact.digest) ||
      Object.keys(artifact.requires).length > 0 ||
      artifact.runtimeDigests.length > 0 ||
      !VersionSchema.safeParse(artifact.version).success
    )
      throw new Error(
        `${pkg.component} must be a first-party tarball at its digest's URI, versioned as its package`,
      );
    if (
      execution !== undefined &&
      artifact.id !== npmPackageArtifactId(execution, pkg)
    )
      throw new Error(`${pkg.component} belongs to another CI execution`);
    return entry;
  });
}

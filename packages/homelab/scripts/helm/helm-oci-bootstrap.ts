import { createHash } from "node:crypto";
import { z } from "zod";
import {
  registryLocation,
  resolveManifest,
  type RegistryTransport,
} from "@shepherdjerred/delivery/oci-registry";

const CHARTS_BOOTSTRAP_OCI_LOCATION = registryLocation(
  "https://registry-1.docker.io",
  "shepherdjerred/charts-bootstrap",
);
const HELM_CHART_CONFIG_MEDIA_TYPE = "application/vnd.cncf.helm.config.v1+json";

/**
 * Staged rollout gate: remains `false` until `woodpecker/prod` rolls out the
 * `DOCKERHUB_PUBLISH` grant on `helm-push` and `tofu-dockerhub/prod` creates
 * `shepherdjerred/charts-bootstrap`, then flips to `true` before retiring
 * `chartmuseum`.
 */
export const CHARTS_BOOTSTRAP_OCI_ENABLED = false;

const OciHelmManifestSchema = z.looseObject({
  config: z.looseObject({ mediaType: z.literal(HELM_CHART_CONFIG_MEDIA_TYPE) }),
  layers: z.array(
    z.looseObject({
      digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    }),
  ),
});

function verifyOciChartManifest(
  manifestBytes: Uint8Array,
  expectedArchiveDigest: string,
): void {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    throw new Error("OCI charts-bootstrap manifest is not valid JSON");
  }
  const parsed = OciHelmManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("OCI charts-bootstrap manifest is not a valid Helm chart");
  }
  if (
    !parsed.data.layers.some((layer) => layer.digest === expectedArchiveDigest)
  ) {
    throw new Error(
      `OCI charts-bootstrap manifest layers do not contain expected producer archive digest ${expectedArchiveDigest}`,
    );
  }
}

function isMissingOciManifestError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /^Registry manifest resolution unavailable \((?:401|404)\)$/u.test(
      error.message,
    )
  );
}

async function computeArchiveDigest(archivePath: string): Promise<string> {
  return `sha256:${createHash("sha256")
    .update(new Uint8Array(await Bun.file(archivePath).arrayBuffer()))
    .digest("hex")}`;
}

export async function publishOciBootstrapChart(
  archivePath: string,
  version: string,
  runCommand: (command: readonly string[]) => Promise<void>,
  transport: RegistryTransport = fetch,
  expectedArchiveDigest?: string,
): Promise<string> {
  const archiveDigest =
    expectedArchiveDigest ?? (await computeArchiveDigest(archivePath));
  const ociUser = Bun.env["DOCKERHUB_USERNAME"]?.trim();
  const ociToken = Bun.env["DOCKERHUB_PUBLISH_TOKEN"]?.trim();
  if (
    ociUser !== undefined &&
    ociUser !== "" &&
    ociToken !== undefined &&
    ociToken !== ""
  ) {
    const login = Bun.spawn(
      [
        "helm",
        "registry",
        "login",
        "registry-1.docker.io",
        "--username",
        ociUser,
        "--password-stdin",
      ],
      {
        stdin: new Blob([ociToken]),
        env: { ...Bun.env, OP_SERVICE_ACCOUNT_TOKEN: undefined },
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    const loginExit = await login.exited;
    if (loginExit !== 0) {
      throw new Error(
        `helm registry login registry-1.docker.io failed (${String(loginExit)})`,
      );
    }
  }
  await runCommand([
    "helm",
    "push",
    archivePath,
    "oci://registry-1.docker.io/shepherdjerred",
  ]);
  const resolved = await resolveManifest(
    CHARTS_BOOTSTRAP_OCI_LOCATION,
    version,
    transport,
  );
  verifyOciChartManifest(resolved.bytes, archiveDigest);
  return resolved.digest;
}

/**
 * Ensure `charts-bootstrap@version` exists in Docker Hub OCI on a same-producer
 * retry and return its OCI manifest digest: reuse an existing OCI manifest
 * whose Helm chart layer matches the verified producer tarball digest, or push
 * the tarball if an earlier attempt stopped between HTTP upload and OCI push.
 */
export async function ensureOciBootstrapChart(options: {
  readonly archivePath: string;
  readonly archiveDigest: string;
  readonly version: string;
  readonly runCommand: (command: readonly string[]) => Promise<void>;
  readonly transport?: RegistryTransport;
}): Promise<string> {
  const transport = options.transport ?? fetch;
  try {
    const existing = await resolveManifest(
      CHARTS_BOOTSTRAP_OCI_LOCATION,
      options.version,
      transport,
    );
    verifyOciChartManifest(existing.bytes, options.archiveDigest);
    return existing.digest;
  } catch (error) {
    if (!isMissingOciManifestError(error)) {
      throw error;
    }
  }
  return publishOciBootstrapChart(
    options.archivePath,
    options.version,
    options.runCommand,
    transport,
    options.archiveDigest,
  );
}

export type EnsureOciBootstrapFn = (archive: {
  readonly archivePath: string;
  readonly archiveDigest: string;
  readonly version: string;
}) => Promise<string>;

export type RetainProducerOptions =
  | string
  | {
      readonly version: string;
      readonly ensureOciBootstrap?: EnsureOciBootstrapFn;
    };

export async function resolveRetainedProducerDigest(
  name: string,
  archive: { readonly digest: string; readonly archivePath?: string },
  version: string,
  ensureOciBootstrap?: EnsureOciBootstrapFn,
): Promise<string> {
  if (name !== "charts-bootstrap" || ensureOciBootstrap === undefined) {
    return archive.digest;
  }
  if (archive.archivePath === undefined) {
    throw new Error(
      "Retained same-producer charts-bootstrap requires its verified archive path",
    );
  }
  return ensureOciBootstrap({
    archivePath: archive.archivePath,
    archiveDigest: archive.digest,
    version,
  });
}

export async function publishedChartReceiptDigest(options: {
  readonly name: string;
  readonly archivePath: string;
  readonly archiveDigest: string;
  readonly version: string;
  readonly runCommand: (command: readonly string[]) => Promise<void>;
  readonly ociEnabled?: boolean;
}): Promise<string> {
  const { ociEnabled = CHARTS_BOOTSTRAP_OCI_ENABLED } = options;
  if (options.name !== "charts-bootstrap" || !ociEnabled) {
    return options.archiveDigest;
  }
  return publishOciBootstrapChart(
    options.archivePath,
    options.version,
    options.runCommand,
    fetch,
    options.archiveDigest,
  );
}

export function chartsBootstrapRetainOptions(
  version: string,
  runCommand: (command: readonly string[]) => Promise<void>,
  ociEnabled = CHARTS_BOOTSTRAP_OCI_ENABLED,
): RetainProducerOptions {
  if (!ociEnabled) return { version };
  return {
    version,
    ensureOciBootstrap: ({ archivePath, archiveDigest }) =>
      ensureOciBootstrapChart({
        archivePath,
        archiveDigest,
        version,
        runCommand,
      }),
  };
}

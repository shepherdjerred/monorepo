import {
  ArtifactVersionSchema,
  type ArtifactVersion,
} from "@shepherdjerred/delivery/contract";
import {
  DeliveryClientError,
  type DeliveryClient,
} from "@shepherdjerred/delivery/client";
import type { SandboxCreateRequest } from "@shepherdjerred/mc-harness/protocol/ipc.ts";
import { loadToolkitConfig } from "#lib/toolkit-config.ts";
import { resolveCredentials } from "#lib/credentials.ts";
import { deliveryClient } from "#lib/delivery/client.ts";

type PublishedReader = Pick<
  DeliveryClient,
  "latestQualifiedArtifact" | "overview" | "version"
>;

export type RegisteredReaderOptions = {
  readonly deliveryUrl?: string;
  readonly makeClient?: (url: string, token?: string) => PublishedReader;
  readonly resolveApiToken?: () => Promise<string | undefined>;
};

async function defaultResolveApiToken(): Promise<string | undefined> {
  await resolveCredentials(["DELIVERY_API_TOKEN"]);
  return Bun.env["DELIVERY_API_TOKEN"];
}

async function configuredDeliveryUrl(): Promise<string> {
  const config = await loadToolkitConfig();
  return config.value("deliveryUrl");
}

export async function registeredReader(
  options: RegisteredReaderOptions = {},
): Promise<PublishedReader> {
  const url = options.deliveryUrl ?? (await configuredDeliveryUrl());
  const makeClient = options.makeClient ?? deliveryClient;
  const resolveApiToken = options.resolveApiToken ?? defaultResolveApiToken;
  const ambient = Bun.env["DELIVERY_API_TOKEN"];
  if (ambient !== undefined && ambient.length > 0) {
    return makeClient(url, ambient);
  }
  let activeClient = makeClient(url);
  let tokenResolved = false;
  const withReadAuth = async <T>(
    operation: (client: PublishedReader) => Promise<T>,
  ): Promise<T> => {
    try {
      return await operation(activeClient);
    } catch (error) {
      if (
        tokenResolved ||
        !(error instanceof DeliveryClientError) ||
        (error.status !== 401 && error.code !== "UNAUTHORIZED")
      ) {
        throw error;
      }
      tokenResolved = true;
      activeClient = makeClient(url, await resolveApiToken());
      return operation(activeClient);
    }
  };
  return {
    latestQualifiedArtifact: (input) =>
      withReadAuth((client) => client.latestQualifiedArtifact(input)),
    overview: () => withReadAuth((client) => client.overview()),
    version: (id) => withReadAuth((client) => client.version(id)),
  };
}

async function sourceConfig(response: Response) {
  if (response.status !== 200)
    throw new Error(
      `Original Storm configuration read failed: HTTP ${String(response.status)}`,
    );
  if (response.body === null)
    throw new Error("Original Storm configuration body is missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      const value: unknown = chunk.value;
      if (!(value instanceof Uint8Array))
        throw new TypeError(
          "Original Storm configuration stream contains invalid bytes",
        );
      total += value.byteLength;
      if (total > 64 * 1024)
        throw new Error(
          "Original Storm configuration exceeds its bounded input",
        );
      chunks.push(value);
      chunk = await reader.read();
    }
  } finally {
    await reader.cancel();
  }
  if (total === 0) throw new Error("Original Storm configuration is empty");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    yaml: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  };
}

async function originalProfileArtifact(
  profile: "storm-prod" | "storm-candidate",
  client: PublishedReader,
) {
  if (profile === "storm-candidate")
    return client.latestQualifiedArtifact({
      serviceId: "minecraft",
      component: "image:the-storm-server",
      kind: "image",
    });
  const overview = await client.overview();
  const environment = overview.environments.find(
    (entry) => entry.id === "minecraft/tsmc",
  );
  const acceptedId = environment?.acceptedVersionSetRevisionId;
  if (acceptedId === undefined || acceptedId === null)
    throw new Error(
      "Minecraft has no accepted release; no production sandbox image can be inferred",
    );
  const accepted = await client.version(acceptedId);
  if (accepted.serviceId !== "minecraft")
    throw new Error("Minecraft accepted release owner differs");
  return ArtifactVersionSchema.parse(
    accepted.components["image:the-storm-server"],
  );
}

/** Only original PG metadata or an explicit frozen ArtifactVersion may identify a published profile. */
export async function publishedProfileInputs(
  profile: SandboxCreateRequest["profile"],
  file?: string,
  options: {
    client?: PublishedReader;
    fetch?: (
      input: string | URL | Request,
      init?: RequestInit,
    ) => Promise<Response>;
  } = {},
) {
  if (profile !== "storm-prod" && profile !== "storm-candidate") {
    if (file !== undefined)
      throw new Error("--artifact-file requires a published Storm profile");
    return {};
  }
  const original: ArtifactVersion =
    file === undefined
      ? await originalProfileArtifact(
          profile,
          options.client ?? (await registeredReader()),
        )
      : ArtifactVersionSchema.parse(await Bun.file(file).json());
  if (
    original.serviceId !== "minecraft" ||
    original.component !== "image:the-storm-server" ||
    original.kind !== "image" ||
    original.uri !== "docker.io/shepherdjerred/the-storm-server" ||
    original.origin.kind !== "first-party"
  )
    throw new Error(
      "Published sandbox artifact is not the original Minecraft image",
    );
  const response = await (options.fetch ?? fetch)(
    `https://raw.githubusercontent.com/shepherdjerred/monorepo/${original.sourceRevision}/packages/the-storm/server/owned/plugins/TheStorm/config.yml`,
    { redirect: "error", signal: AbortSignal.timeout(30_000) },
  );
  return {
    publishedArtifact: original,
    publishedConfig: {
      sourceRevision: original.sourceRevision,
      ...(await sourceConfig(response)),
    },
  };
}

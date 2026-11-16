import type https from "node:https";
import { z } from "zod";
import { TEMPORAL_IN_CLUSTER_ADDRESS } from "@shepherdjerred/toolkit/lib/credential-commands.ts";
import { resolveCredentials } from "@shepherdjerred/toolkit/lib/credentials.ts";
import { Connection } from "@temporalio/client";
import {
  KubeConfig,
  ResponseContext,
  ServerConfiguration,
  createConfiguration,
  wrapHttpLibrary,
  type ApiConstructor,
  type ApiType,
} from "@kubernetes/client-node";
import { temporalConnectionOptions } from "#lib/temporal-connection.ts";
import { requiredEnvironment } from "#scripts/cli-arguments.ts";

type Environment = Readonly<Record<string, string | undefined>>;
type ResolveCredentials = (names: readonly string[]) => Promise<void>;

const ExecEnvEntrySchema = z.object({
  name: z.string(),
  value: z.string(),
});

const UserExecSchema = z
  .object({
    apiVersion: z.string().min(1).optional(),
    env: z.array(ExecEnvEntrySchema).nullable().optional(),
  })
  .loose();

export type OperatorFetch = (
  input: string,
  init?: BunFetchRequestInit,
) => Promise<Response>;

function toBunTlsValue(
  value: unknown,
): string | Buffer | (string | Buffer)[] | undefined {
  if (typeof value === "string" || Buffer.isBuffer(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    const items = value.flatMap((item) =>
      typeof item === "string" || Buffer.isBuffer(item) ? [item] : [],
    );
    return items.length > 0 ? items : undefined;
  }
  return undefined;
}

/**
 * Configure a workstation `KubeConfig` to work under Bun:
 * 1. `@kubernetes/client-node` does not set `KUBERNETES_EXEC_INFO` when running
 *    exec credential plugins, which `toolkit kube credential` requires.
 * 2. `@kubernetes/client-node` routes requests through `undici`'s `dispatcher`,
 *    whose custom CA and mTLS client certificate options Bun ignores unless
 *    passed via `fetch(..., { tls })`.
 */
export function configureOperatorKubeConfig(
  kubernetes: KubeConfig,
  transport: OperatorFetch = (input, init) => fetch(input, init),
): KubeConfig {
  const user = kubernetes.getCurrentUser();
  const parsedExec = UserExecSchema.safeParse(user?.exec);
  if (user?.exec !== undefined && parsedExec.success) {
    const existingEnv = parsedExec.data.env ?? [];
    if (!existingEnv.some((entry) => entry.name === "KUBERNETES_EXEC_INFO")) {
      const execRecord: Record<string, unknown> = parsedExec.data;
      execRecord["env"] = [
        ...existingEnv,
        {
          name: "KUBERNETES_EXEC_INFO",
          value: JSON.stringify({
            apiVersion:
              parsedExec.data.apiVersion ?? "client.authentication.k8s.io/v1",
            kind: "ExecCredential",
          }),
        },
      ];
      Object.assign(user.exec, execRecord);
    }
  }

  kubernetes.makeApiClient = <T extends ApiType>(
    apiClientType: ApiConstructor<T>,
  ): T => {
    const cluster = kubernetes.getCurrentCluster();
    if (cluster === null) {
      throw new Error("No active cluster!");
    }
    const httpApi = wrapHttpLibrary({
      send: async (request) => {
        const httpsOptions: https.RequestOptions = {};
        await kubernetes.applyToHTTPSOptions(httpsOptions);
        const headers: Record<string, string> = { ...request.getHeaders() };
        if (httpsOptions.headers !== undefined) {
          for (const [key, value] of Object.entries(httpsOptions.headers)) {
            if (typeof value === "string") {
              headers[key] = value;
            }
          }
        }
        const rawBody = request.getBody();
        const body =
          rawBody === undefined ||
          typeof rawBody === "string" ||
          rawBody instanceof URLSearchParams
            ? rawBody
            : undefined;
        const ca = toBunTlsValue(httpsOptions.ca);
        const cert = toBunTlsValue(httpsOptions.cert);
        const key = toBunTlsValue(httpsOptions.key);
        const signal = request.getSignal();
        const response = await transport(request.getUrl(), {
          method: request.getHttpMethod(),
          headers,
          ...(body === undefined ? {} : { body }),
          ...(signal === undefined ? {} : { signal }),
          tls: {
            ...(ca === undefined ? {} : { ca }),
            ...(cert === undefined ? {} : { cert }),
            ...(key === undefined ? {} : { key }),
            ...(httpsOptions.rejectUnauthorized === undefined
              ? {}
              : { rejectUnauthorized: httpsOptions.rejectUnauthorized }),
            ...(httpsOptions.servername === undefined
              ? {}
              : { servername: httpsOptions.servername }),
          },
        });
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, name) => {
          responseHeaders[name] = value;
        });
        return new ResponseContext(response.status, responseHeaders, {
          text: () => response.text(),
          binary: async () => Buffer.from(await response.arrayBuffer()),
          stream: () => response.body,
        });
      },
    });
    const config = createConfiguration({
      baseServer: new ServerConfiguration(cluster.server, {}),
      authMethods: {},
      httpApi,
    });
    return new apiClientType(config);
  };
  return kubernetes;
}

/** Shared by foreground outage commands; vault access never survives into native children. */
export async function openOperatorRecovery(context: "admin@torvalds") {
  await resolveOperatorTemporalApiKey();
  Reflect.deleteProperty(Bun.env, "OP_SERVICE_ACCOUNT_TOKEN");
  const kubernetes = new KubeConfig();
  kubernetes.loadFromDefault();
  kubernetes.setCurrentContext(context);
  configureOperatorKubeConfig(kubernetes);
  const connection = await Connection.connect(
    temporalConnectionOptions({
      environment: Bun.env,
      defaultAddress: requiredEnvironment(Bun.env, "TEMPORAL_ADDRESS"),
    }),
  );
  return { kubernetes, connection };
}

/**
 * Whether an operator command must broker `TEMPORAL_API_KEY` before it runs.
 *
 * Only an external TLS endpoint needs the key. An explicit nonempty value
 * wins, the in-cluster service never needs it, and a plaintext connection is
 * left alone so `temporalConnectionOptions` keeps rejecting a key without TLS.
 */
export function temporalApiKeyNeedsResolution(
  environment: Environment,
): boolean {
  const apiKey = environment["TEMPORAL_API_KEY"];
  const hasApiKey = apiKey !== undefined && apiKey.length > 0;
  return (
    !hasApiKey &&
    environment["TEMPORAL_ADDRESS"] !== TEMPORAL_IN_CLUSTER_ADDRESS &&
    environment["TEMPORAL_TLS"] === "true"
  );
}

/**
 * Resolve `TEMPORAL_API_KEY` once into `Bun.env` through toolkit's credential
 * broker, which reads the Keychain-enrolled 1Password service account instead
 * of waiting for 1Password desktop approval. Replay and canary subprocesses
 * inherit `Bun.env`, so they receive the key without resolving it again.
 *
 * The broker exports the service account token for its own `op read`. Remove
 * it again unless the operator supplied it, so candidate code and other
 * children receive only the Temporal key, never vault access.
 */
export async function resolveOperatorTemporalApiKey(
  resolve: ResolveCredentials = resolveCredentials,
): Promise<void> {
  if (!temporalApiKeyNeedsResolution(Bun.env)) {
    return;
  }
  const ambientServiceAccount = Bun.env["OP_SERVICE_ACCOUNT_TOKEN"];
  try {
    await resolve(["TEMPORAL_API_KEY"]);
  } finally {
    if (ambientServiceAccount === undefined || ambientServiceAccount === "") {
      Reflect.deleteProperty(Bun.env, "OP_SERVICE_ACCOUNT_TOKEN");
    }
  }
}

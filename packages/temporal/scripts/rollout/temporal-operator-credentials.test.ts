import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BatchV1Api, KubeConfig } from "@kubernetes/client-node";
import { z } from "zod";
import { resolveCredentials } from "@shepherdjerred/toolkit/lib/credentials.ts";
import {
  configureOperatorKubeConfig,
  resolveOperatorTemporalApiKey,
  temporalApiKeyNeedsResolution,
  type OperatorFetch,
} from "./temporal-operator-credentials.ts";

const EXTERNAL = "temporal.example.test:443";
const MANAGED_KEYS = [
  "TEMPORAL_ADDRESS",
  "TEMPORAL_TLS",
  "TEMPORAL_API_KEY",
  "OP_SERVICE_ACCOUNT_TOKEN",
] as const;

describe("temporalApiKeyNeedsResolution", () => {
  test("an explicit key wins", () => {
    expect(
      temporalApiKeyNeedsResolution({
        TEMPORAL_ADDRESS: EXTERNAL,
        TEMPORAL_TLS: "true",
        TEMPORAL_API_KEY: "explicit",
      }),
    ).toBe(false);
  });

  test("the in-cluster service never needs a key", () => {
    expect(
      temporalApiKeyNeedsResolution({
        TEMPORAL_ADDRESS: "temporal-temporal-server-service:7233",
        TEMPORAL_TLS: "true",
      }),
    ).toBe(false);
  });

  test("a plaintext connection is left to the TLS check", () => {
    expect(
      temporalApiKeyNeedsResolution({ TEMPORAL_ADDRESS: "localhost:7233" }),
    ).toBe(false);
    expect(
      temporalApiKeyNeedsResolution({
        TEMPORAL_ADDRESS: EXTERNAL,
        TEMPORAL_TLS: "false",
      }),
    ).toBe(false);
  });

  test("an external TLS endpoint without a usable key needs resolution", () => {
    expect(
      temporalApiKeyNeedsResolution({
        TEMPORAL_ADDRESS: EXTERNAL,
        TEMPORAL_TLS: "true",
      }),
    ).toBe(true);
    expect(
      temporalApiKeyNeedsResolution({
        TEMPORAL_ADDRESS: EXTERNAL,
        TEMPORAL_TLS: "true",
        TEMPORAL_API_KEY: "",
      }),
    ).toBe(true);
  });
});

describe("resolveOperatorTemporalApiKey", () => {
  beforeEach(() => {
    for (const key of MANAGED_KEYS) {
      vi.stubEnv(key, undefined);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("brokers the key once for an external TLS endpoint", async () => {
    Bun.env["TEMPORAL_ADDRESS"] = EXTERNAL;
    Bun.env["TEMPORAL_TLS"] = "true";
    const resolve = vi.fn(() => Promise.resolve());
    await resolveOperatorTemporalApiKey(resolve);
    expect(resolve).toHaveBeenCalledExactlyOnceWith(["TEMPORAL_API_KEY"]);
  });

  test("drops the brokered service account token before children run", async () => {
    Bun.env["TEMPORAL_ADDRESS"] = EXTERNAL;
    Bun.env["TEMPORAL_TLS"] = "true";
    await resolveOperatorTemporalApiKey(() => {
      Bun.env["OP_SERVICE_ACCOUNT_TOKEN"] = "brokered";
      Bun.env["TEMPORAL_API_KEY"] = "resolved";
      return Promise.resolve();
    });
    expect(Bun.env["OP_SERVICE_ACCOUNT_TOKEN"]).toBeUndefined();
    expect(Bun.env["TEMPORAL_API_KEY"]).toBe("resolved");
  });

  test("treats an empty ambient service account token as absent", async () => {
    Bun.env["TEMPORAL_ADDRESS"] = EXTERNAL;
    Bun.env["TEMPORAL_TLS"] = "true";
    Bun.env["OP_SERVICE_ACCOUNT_TOKEN"] = "";
    await resolveOperatorTemporalApiKey(() => {
      Bun.env["OP_SERVICE_ACCOUNT_TOKEN"] = "brokered";
      Bun.env["TEMPORAL_API_KEY"] = "resolved";
      return Promise.resolve();
    });
    expect(Bun.env["OP_SERVICE_ACCOUNT_TOKEN"]).toBeUndefined();
  });

  test("keeps a service account token the operator supplied", async () => {
    Bun.env["TEMPORAL_ADDRESS"] = EXTERNAL;
    Bun.env["TEMPORAL_TLS"] = "true";
    Bun.env["OP_SERVICE_ACCOUNT_TOKEN"] = "operator";
    await resolveOperatorTemporalApiKey(() => {
      Bun.env["TEMPORAL_API_KEY"] = "resolved";
      return Promise.resolve();
    });
    expect(Bun.env["OP_SERVICE_ACCOUNT_TOKEN"]).toBe("operator");
  });

  test("does not broker when the environment already supplies the key", async () => {
    Bun.env["TEMPORAL_ADDRESS"] = EXTERNAL;
    Bun.env["TEMPORAL_TLS"] = "true";
    Bun.env["TEMPORAL_API_KEY"] = "explicit";
    const resolve = vi.fn(() => Promise.resolve());
    await resolveOperatorTemporalApiKey(resolve);
    expect(resolve).not.toHaveBeenCalled();
  });

  test("a failed lookup does not reveal the service account token", async () => {
    Bun.env["TEMPORAL_ADDRESS"] = EXTERNAL;
    Bun.env["TEMPORAL_TLS"] = "true";
    const fakeToken = `ops_${"x".repeat(200)}`;
    const run = vi.fn(async (argv: string[]) =>
      argv[0] === "security"
        ? { exit: 0, stdout: fakeToken, stderr: "" }
        : { exit: 1, stdout: "", stderr: "denied" },
    );
    let message = "";
    try {
      await resolveOperatorTemporalApiKey(async (names) =>
        resolveCredentials(names, {
          run,
          configPath: "/nonexistent/toolkit-config.toml",
        }),
      );
    } catch (error: unknown) {
      message = String(error);
    }
    expect(message).toContain("TEMPORAL_API_KEY");
    expect(message).not.toContain(fakeToken);
    expect(Bun.env["TEMPORAL_API_KEY"]).toBeUndefined();
    expect(Bun.env["OP_SERVICE_ACCOUNT_TOKEN"]).toBeUndefined();
  });
});

describe("configureOperatorKubeConfig", () => {
  test("injects KUBERNETES_EXEC_INFO on exec users and forwards TLS material to fetch", async () => {
    const caPem =
      "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----\n";
    const certPem =
      "-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----\n";
    const keyPem =
      "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n";
    const kubernetes = new KubeConfig();
    kubernetes.loadFromOptions({
      clusters: [
        {
          name: "torvalds",
          server: "https://kubernetes.example.test:6443",
          caData: Buffer.from(caPem).toString("base64"),
          skipTLSVerify: false,
        },
      ],
      users: [
        {
          name: "admin@torvalds",
          certData: Buffer.from(certPem).toString("base64"),
          keyData: Buffer.from(keyPem).toString("base64"),
          exec: {
            apiVersion: "client.authentication.k8s.io/v1",
            command: "nonexistent-kube-credential-plugin",
            args: ["kube", "credential"],
          },
        },
      ],
      contexts: [
        {
          name: "admin@torvalds",
          cluster: "torvalds",
          user: "admin@torvalds",
        },
      ],
      currentContext: "admin@torvalds",
    });

    let capturedInit: BunFetchRequestInit | undefined;
    const transport: OperatorFetch = (_input, init) => {
      capturedInit = init;
      return Promise.resolve(
        Response.json({
          apiVersion: "batch/v1",
          kind: "Job",
          metadata: { name: "test-job", namespace: "storm-forum" },
        }),
      );
    };
    // Avoid spawning a real subprocess by stubbing applyToHTTPSOptions after exec env check
    configureOperatorKubeConfig(kubernetes, transport);

    const execEnv = z
      .object({
        env: z.array(z.object({ name: z.string(), value: z.string() })),
      })
      .parse(kubernetes.getCurrentUser()?.exec).env;
    expect(execEnv).toContainEqual({
      name: "KUBERNETES_EXEC_INFO",
      value: JSON.stringify({
        apiVersion: "client.authentication.k8s.io/v1",
        kind: "ExecCredential",
      }),
    });

    kubernetes.applyToHTTPSOptions = (opts) => {
      opts.ca = Buffer.from(caPem);
      opts.cert = certPem;
      opts.key = keyPem;
      return Promise.resolve();
    };

    const batch = kubernetes.makeApiClient(BatchV1Api);
    const job = await batch.readNamespacedJob({
      namespace: "storm-forum",
      name: "test-job",
    });
    expect(job.metadata?.name).toBe("test-job");
    const tls = z
      .object({
        tls: z.object({
          cert: z.string(),
          key: z.string(),
        }),
      })
      .parse(capturedInit).tls;
    expect(tls.cert).toBe(certPem);
    expect(tls.key).toBe(keyPem);
  });
});

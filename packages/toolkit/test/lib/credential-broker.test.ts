import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CACHE_SERVICE, createCredentialCache } from "#lib/credential-cache.ts";
import type { SecretStore } from "#lib/credential-cache.ts";
import {
  flushCredentialCache,
  credentialReferences,
} from "#lib/credential-overrides.ts";
import {
  resolveCredentialValues,
  withoutServiceAccountToken,
} from "#lib/credentials.ts";
import type { CredentialRun } from "#lib/credentials.ts";
import { CREDENTIAL_REGISTRY } from "#lib/credential-registry.ts";
import {
  buildPassthroughInvocation,
  shimDirectory,
  trustedSearchPath,
} from "#lib/passthrough.ts";
import {
  spawnForwardingSignals,
  signalExitCode,
} from "#lib/spawn-forwarding.ts";
import { findSecrets } from "#lib/brim/sync/redact.ts";
import {
  hasExplicitTalosconfig,
  isCredentialFreeTalosctl,
  refusalFor,
  runTalosctl,
  talosSubcommand,
  talosconfigDocument,
} from "#commands/brokered/talosctl.ts";
import {
  execCredential,
  runKubeCredential,
} from "#commands/brokered/kube-credential.ts";
import {
  AWS_CREDENTIAL_PROFILES,
  credentialProcessOutput,
  runAwsCredential,
} from "#commands/brokered/aws-credential.ts";
import { parseRunArguments } from "#commands/brokered/run.ts";

// Synthetic fixtures only; none of these is a real credential.
const FAKE_SA_TOKEN = `ops_eyJ${"A".repeat(160)}`;
const FAKE_CERT_PEM =
  "-----BEGIN CERTIFICATE-----\nZmFrZS1jZXJ0\n-----END CERTIFICATE-----\n";
// Assembled so the armor never appears literally in source.
const PRIVATE_KEY_LABEL = ["EC", "PRIVATE", "KEY"].join(" ");
const FAKE_KEY_PEM = `-----BEGIN ${PRIVATE_KEY_LABEL}-----\nZmFrZS1rZXktbWF0ZXJpYWwtZm9yLXRlc3Rz\n-----END ${PRIVATE_KEY_LABEL}-----\n`;
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

const directories: string[] = [];
const stderr: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  stderr.length = 0;
  await Promise.all(
    directories.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

async function absentConfig(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "toolkit-broker-"));
  directories.push(directory);
  return path.join(directory, "absent.toml");
}

function captureStderr(): void {
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    stderr.push(args.map(String).join(" "));
  });
}

function storeKey(o: { service: string; name: string }): string {
  return `${o.service}/${o.name}`;
}

const refuseResolution: CredentialRun = () => {
  throw new Error("must not resolve credentials");
};

test("reference inventory evaluates registry and overrides without resolving values", async () => {
  const file = await absentConfig();
  await Bun.write(
    file,
    '[credentials]\nARGOCD_AUTH_TOKEN = "op://test-vault/test-item/TOKEN"\nCUSTOM = "op://other-vault/other-item/password"\nWOODPECKER_TOKEN = "keychain:test-only"\n',
  );
  const spawn = vi.spyOn(Bun, "spawn").mockImplementation(() => {
    throw new Error("must not read a credential");
  });
  const refs = await credentialReferences(file);
  expect(refs).toContainEqual({
    name: "ARGOCD_AUTH_TOKEN",
    ref: "op://test-vault/test-item/TOKEN",
    source: "override",
  });
  expect(refs).toContainEqual({
    name: "CUSTOM",
    ref: "op://other-vault/other-item/password",
    source: "override",
  });
  expect(refs.some((ref) => ref.source === "registry")).toBe(true);
  expect(refs.some((ref) => ref.name === "WOODPECKER_TOKEN")).toBe(false);
  expect(spawn).not.toHaveBeenCalled();
});

function findKinds(text: string): string[] {
  return findSecrets(new TextEncoder().encode(text)).map((match) => match.kind);
}

function memoryStore(): SecretStore & { items: Map<string, string> } {
  const items = new Map<string, string>();
  const key = storeKey;
  return {
    items,
    get: (o) => Promise.resolve(items.get(key(o)) ?? null),
    set: (o) => {
      items.set(key(o), o.value);
      return Promise.resolve();
    },
    delete: (o) => Promise.resolve(items.delete(key(o))),
  };
}

type Call = { argv: string[]; extra: Readonly<Record<string, string>> };

function recordingRun(
  calls: Call[],
  respond: (argv: string[]) => string,
): CredentialRun {
  return (argv, extra = {}) => {
    calls.push({ argv, extra });
    return Promise.resolve({ exit: 0, stdout: respond(argv), stderr: "" });
  };
}

describe("service-account token isolation", () => {
  test("the token reaches only the op child and is never exported", async () => {
    captureStderr();
    const saved = Bun.env["OP_SERVICE_ACCOUNT_TOKEN"];
    Reflect.deleteProperty(Bun.env, "OP_SERVICE_ACCOUNT_TOKEN");
    try {
      const calls: Call[] = [];
      const run = recordingRun(calls, (argv) =>
        argv[0] === "security" ? `${FAKE_SA_TOKEN}\n` : "value-from-op\n",
      );
      const values = await resolveCredentialValues(["CF_API_TOKEN"], {
        run,
        configPath: await absentConfig(),
        cache: null,
      });
      expect(values).toEqual({ CF_API_TOKEN: "value-from-op" });
      expect(Bun.env["OP_SERVICE_ACCOUNT_TOKEN"]).toBeUndefined();
      expect(Bun.env["CF_API_TOKEN"]).toBeUndefined();
      const op = calls.find((call) => call.argv[0] === "op");
      expect(op?.extra).toEqual({ OP_SERVICE_ACCOUNT_TOKEN: FAKE_SA_TOKEN });
      const security = calls.find((call) => call.argv[0] === "security");
      expect(security?.extra).toEqual({});
      expect(stderr.join("\n")).not.toContain(FAKE_SA_TOKEN);
    } finally {
      if (saved !== undefined) Bun.env["OP_SERVICE_ACCOUNT_TOKEN"] = saved;
    }
  });

  test("withoutServiceAccountToken strips only the token", () => {
    expect(
      withoutServiceAccountToken({
        OP_SERVICE_ACCOUNT_TOKEN: "x",
        PATH: "/bin",
      }),
    ).toEqual({ PATH: "/bin" });
  });

  test("passthrough children never inherit the token", () => {
    const invocation = buildPassthroughInvocation("argocd", ["app", "list"], {
      OP_SERVICE_ACCOUNT_TOKEN: "x",
      ARGOCD_AUTH_TOKEN: "argo",
    });
    expect(invocation?.env["OP_SERVICE_ACCOUNT_TOKEN"]).toBeUndefined();
    expect(invocation?.env["ARGOCD_AUTH_TOKEN"]).toBe("argo");
  });
});

describe("credential read cache", () => {
  test("a fresh entry is served without reading 1Password", async () => {
    captureStderr();
    const store = memoryStore();
    let now = 1_000_000;
    const cache = createCredentialCache({
      store,
      ttlSeconds: 3600,
      now: () => now,
    });
    const calls: Call[] = [];
    const run = recordingRun(calls, () => "fresh-value\n");
    const deps = {
      run,
      configPath: await absentConfig(),
      cache,
    };
    const saved = Bun.env["OP_SERVICE_ACCOUNT_TOKEN"];
    Bun.env["OP_SERVICE_ACCOUNT_TOKEN"] = FAKE_SA_TOKEN;
    try {
      expect(await resolveCredentialValues(["CF_API_TOKEN"], deps)).toEqual({
        CF_API_TOKEN: "fresh-value",
      });
      expect(calls).toHaveLength(1);
      expect([...store.items.keys()][0]).toMatch(
        new RegExp(`^${CACHE_SERVICE}/[0-9a-f]{64}$`),
      );
      // The stored entry names neither the credential nor its ref.
      expect([...store.items.keys()].join(",")).not.toContain("op://");

      now += 3599 * 1000;
      await resolveCredentialValues(["CF_API_TOKEN"], deps);
      expect(calls).toHaveLength(1);
      // Cache hits are silent; only the 1Password read was logged.
      expect(stderr).toEqual(["toolkit: CF_API_TOKEN via service-account"]);

      now += 2 * 1000;
      await resolveCredentialValues(["CF_API_TOKEN"], deps);
      expect(calls).toHaveLength(2);
    } finally {
      if (saved === undefined) {
        Reflect.deleteProperty(Bun.env, "OP_SERVICE_ACCOUNT_TOKEN");
      } else {
        Bun.env["OP_SERVICE_ACCOUNT_TOKEN"] = saved;
      }
    }
  });

  test("a malformed entry fails loudly", async () => {
    const store = memoryStore();
    const cache = createCredentialCache({ store, ttlSeconds: 60 });
    await cache.set("op://v/i/f", "value");
    const [key] = [...store.items.keys()];
    if (key === undefined) throw new Error("expected an entry");
    store.items.set(key, JSON.stringify({ unexpected: true }));
    await expect(cache.get("op://v/i/f")).rejects.toThrow(/malformed/);
  });

  test("flush removes registered entries by name", async () => {
    const store = memoryStore();
    const cache = createCredentialCache({ store, ttlSeconds: 60 });
    const source = CREDENTIAL_REGISTRY["CF_API_TOKEN"]?.source;
    if (source?.kind !== "op") throw new Error("expected an op source");
    await cache.set(source.ref, "value");
    const configPath = await absentConfig();
    expect(
      await flushCredentialCache(["CF_API_TOKEN"], { cache, configPath }),
    ).toEqual(["CF_API_TOKEN"]);
    expect(store.items.size).toBe(0);
    await expect(
      flushCredentialCache(["NOT_A_CREDENTIAL"], { cache, configPath }),
    ).rejects.toThrow(/unknown credential/);
  });
});

describe("kube credential", () => {
  test("emits a v1 ExecCredential with decoded PEM and an expiry", () => {
    const output: unknown = JSON.parse(
      execCredential(
        { certificate: b64(FAKE_CERT_PEM), key: b64(FAKE_KEY_PEM) },
        new Date("2026-01-01T00:00:00Z"),
      ),
    );
    expect(output).toEqual({
      apiVersion: "client.authentication.k8s.io/v1",
      kind: "ExecCredential",
      status: {
        clientCertificateData: FAKE_CERT_PEM,
        clientKeyData: FAKE_KEY_PEM,
        expirationTimestamp: "2026-01-01T01:00:00.000Z",
      },
    });
  });

  test("refuses to run outside client-go", async () => {
    captureStderr();
    const run = refuseResolution;
    expect(await runKubeCredential([], {}, { run, cache: null })).toBe(2);
    expect(stderr.join("\n")).toMatch(/KUBERNETES_EXEC_INFO/);
  });

  test("rejects material that is not PEM", () => {
    expect(() =>
      execCredential(
        { certificate: b64("nope"), key: b64(FAKE_KEY_PEM) },
        new Date(),
      ),
    ).toThrow(/not base64-encoded PEM/);
  });
});

describe("aws credential", () => {
  test("every profile maps to registered credentials", () => {
    for (const names of AWS_CREDENTIAL_PROFILES.values()) {
      expect(CREDENTIAL_REGISTRY[names.accessKeyId]).toBeDefined();
      expect(CREDENTIAL_REGISTRY[names.secretAccessKey]).toBeDefined();
    }
  });

  test("prints credential_process JSON", () => {
    expect(
      JSON.parse(
        credentialProcessOutput(
          { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "fake-secret" },
          new Date("2026-01-01T00:00:00Z"),
        ),
      ),
    ).toEqual({
      Version: 1,
      AccessKeyId: "AKIDEXAMPLE",
      SecretAccessKey: "fake-secret",
      Expiration: "2026-01-01T01:00:00.000Z",
    });
  });

  test("refuses a terminal and unknown profiles", async () => {
    captureStderr();
    const run = refuseResolution;
    expect(
      await runAwsCredential(["seaweedfs"], true, { run, cache: null }),
    ).toBe(2);
    expect(await runAwsCredential(["nope"], false, { run, cache: null })).toBe(
      2,
    );
  });
});

describe("talosctl", () => {
  test("finds the subcommand past global flags", () => {
    expect(talosSubcommand(["-n", "node", "health"])).toBe("health");
    expect(talosSubcommand(["--nodes=a", "version"])).toBe("version");
    expect(talosSubcommand(["--", "config"])).toBeUndefined();
  });

  test.each(["config", "kubeconfig", "gen", "cluster"])(
    "refuses %s, which writes secrets to disk",
    (subcommand) => {
      expect(refusalFor(["-n", "x", subcommand, "info"])).toMatch(
        new RegExp(`refusing \`talosctl ${subcommand}\``),
      );
    },
  );

  test("operational commands are not refused", () => {
    expect(refusalFor(["health"])).toBeNull();
    expect(refusalFor(["reboot", "-n", "x"])).toBeNull();
  });

  test("local metadata needs no credentials", () => {
    expect(isCredentialFreeTalosctl(["--help"])).toBe(true);
    expect(isCredentialFreeTalosctl(["version", "--client"])).toBe(true);
    expect(isCredentialFreeTalosctl(["version"])).toBe(false);
  });

  test("local validation does not resolve credentials or inject a talosconfig pipe", async () => {
    const args = ["validate", "--config", "/dev/stdin", "--mode", "metal"];
    expect(isCredentialFreeTalosctl(args)).toBe(true);
    vi.spyOn(Bun, "which").mockReturnValue("/trusted-native/talosctl");
    const spawn = vi.spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error("fixture reached native spawn");
    });
    await expect(
      runTalosctl(args, { run: refuseResolution, cache: null }),
    ).rejects.toThrow("fixture reached native spawn");
    expect(spawn).toHaveBeenCalledExactlyOnceWith(
      ["/trusted-native/talosctl", ...args],
      expect.objectContaining({ stdio: ["inherit", "inherit", "inherit"] }),
    );
    expect(
      isCredentialFreeTalosctl(["apply-config", "--file", "/dev/stdin"]),
    ).toBe(false);
  });

  test("an explicit talosconfig is honored", () => {
    expect(hasExplicitTalosconfig(["--talosconfig", "x", "health"], {})).toBe(
      true,
    );
    expect(hasExplicitTalosconfig(["health"], { TALOSCONFIG: "/x" })).toBe(
      true,
    );
    expect(hasExplicitTalosconfig(["health"], {})).toBe(false);
  });

  test("builds a single-context talosconfig", () => {
    const document = talosconfigDocument({
      ca: b64(FAKE_CERT_PEM),
      crt: b64(FAKE_CERT_PEM),
      key: b64(FAKE_KEY_PEM),
    });
    expect(document).toContain("context: torvalds");
    expect(document).toContain("- torvalds.tailnet-1a49.ts.net");
    expect(document).toContain(`key: ${b64(FAKE_KEY_PEM)}`);
  });
});

describe("toolkit run", () => {
  test("parses names and the command after --", () => {
    expect(
      parseRunArguments(["--env", "A,B", "--env=C", "--", "bun", "x.ts"]),
    ).toEqual({ names: ["A", "B", "C"], command: ["bun", "x.ts"] });
  });

  test("requires --env and a command", () => {
    expect(parseRunArguments(["--", "bun"])).toMatch(/Usage/);
    expect(parseRunArguments(["--env", "A"])).toMatch(/Usage/);
    expect(parseRunArguments(["--bogus", "--", "bun"])).toMatch(/unknown/);
  });
});

describe("trusted binary lookup", () => {
  test("drops shims, relative entries, and node_modules bins", () => {
    const home = "/Users/test";
    const searchPath = [
      "node_modules/.bin",
      "/repo/node_modules/.bin",
      shimDirectory(home),
      "/Users/test/.local/share/mise/shims",
      "/opt/homebrew/bin",
    ].join(path.delimiter);
    expect(trustedSearchPath(searchPath, home)).toBe(
      ["/Users/test/.local/share/mise/shims", "/opt/homebrew/bin"].join(
        path.delimiter,
      ),
    );
  });
});

describe("gcx passthrough", () => {
  test("injects server, org and token without a stored context", () => {
    const invocation = buildPassthroughInvocation("prom", ["query", "up"], {
      GRAFANA_API_KEY: "fake-grafana",
    });
    expect(invocation?.args).toEqual(["metrics", "query", "up"]);
    expect(invocation?.env["GRAFANA_SERVER"]).toBe(
      "https://grafana.tailnet-1a49.ts.net",
    );
    expect(invocation?.env["GRAFANA_ORG_ID"]).toBe("1");
    expect(invocation?.env["GRAFANA_TOKEN"]).toBe("fake-grafana");
  });

  test("an explicit context keeps its own server", () => {
    const invocation = buildPassthroughInvocation(
      "grafana",
      ["--context", "other", "datasources", "list"],
      {},
    );
    expect(invocation?.env["GRAFANA_SERVER"]).toBeUndefined();
  });
});

describe("spawnForwardingSignals", () => {
  test("hands payloads to the child on fd 3 and returns its exit code", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "toolkit-fd3-"));
    directories.push(directory);
    const out = path.join(directory, "out");
    // Read the descriptor directly: Linux cannot reopen a socket-backed
    // /dev/fd path, so the by-path form is exercised only on macOS below.
    const code = await spawnForwardingSignals(
      ["/bin/sh", "-c", `cat <&3 > ${out}; exit 7`],
      { env: { PATH: "/usr/bin:/bin" }, extraFiles: ["piped-payload"] },
    );
    expect(code).toBe(7);
    expect(await Bun.file(out).text()).toBe("piped-payload");
  });

  test.runIf(process.platform === "darwin")(
    "the payload is readable as /dev/fd/3 on macOS",
    async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), "toolkit-fd3-"));
      directories.push(directory);
      const out = path.join(directory, "out");
      await spawnForwardingSignals(
        ["/bin/sh", "-c", `cat /dev/fd/3 > ${out}`],
        { env: { PATH: "/usr/bin:/bin" }, extraFiles: ["by-path"] },
      );
      expect(await Bun.file(out).text()).toBe("by-path");
    },
  );

  test("reports death by signal as 128+N", () => {
    expect(signalExitCode("SIGTERM")).toBe(128 + 15);
  });
});

describe("transcript redaction", () => {
  const find = findKinds;

  test("catches the service-account token after an assignment", () => {
    expect(find(`OP_SERVICE_ACCOUNT_TOKEN=${FAKE_SA_TOKEN}\n`)).toEqual([
      "onepassword-service-account",
    ]);
  });

  test("catches GitHub tokens", () => {
    expect(find(` ghp_${"a".repeat(36)} `)).toEqual(["github-token"]);
    expect(find(` github_pat_${"b".repeat(60)} `)).toEqual(["github-token"]);
  });

  test("catches PEM private keys, raw and JSON-escaped", () => {
    expect(find(FAKE_KEY_PEM)).toEqual(["private-key"]);
    expect(find(JSON.stringify({ key: `x\n${FAKE_KEY_PEM}` }))).toEqual([
      "private-key",
    ]);
  });

  test("catches base64 private keys but not certificates", () => {
    expect(find(`client-key-data: ${b64(FAKE_KEY_PEM)}\n`)).toEqual([
      "private-key-base64",
    ]);
    expect(find(`client-certificate-data: ${b64(FAKE_CERT_PEM)}\n`)).toEqual(
      [],
    );
  });
});

describe("argocd workstation token", () => {
  test("reads the tofu-minted read-only workstation item by title", () => {
    const source = CREDENTIAL_REGISTRY["ARGOCD_AUTH_TOKEN"]?.source;
    expect(source?.kind).toBe("op");
    expect(source?.kind === "op" ? source.ref : "").toMatch(
      /\/argocd-workstation-token\/tokens\/ARGOCD_AUTH_TOKEN$/,
    );
  });
});

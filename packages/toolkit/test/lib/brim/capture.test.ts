import { afterEach, describe, expect, test } from "vitest";
import { readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  captureEnvCommand,
  captureLaunchAgent,
  handleCaptureCommand,
  type CaptureCommandContext,
} from "#commands/brim/capture.ts";
import {
  caOpenSslConfig,
  captureCaStatus,
  ensureCaptureCa,
  runCommand,
} from "#lib/brim/capture/ca.ts";
import {
  CAPTURE_CLIS,
  NEVER_INTERCEPT_HOSTS,
  addonRoutes,
  allCaptureHosts,
  allowHostPattern,
  captureCli,
} from "#lib/brim/capture/clis.ts";
import {
  CAPTURE_PYTHON_VERSION,
  MITMPROXY_VERSION,
  mitmdumpArgv,
  writeAddon,
} from "#lib/brim/capture/engine.ts";
import {
  captureEnvironment,
  renderExports,
  shellQuote,
} from "#lib/brim/capture/env.ts";
import { defaultBrimCapturePaths } from "#lib/brim/capture/paths.ts";
import { BRIM_CAPTURE_CONTRACTS } from "#lib/brim/capture/record.ts";
import type { BrimCaptureSettings } from "#lib/brim/capture/settings.ts";
import { loadBrimCaptureSettings } from "#lib/brim/capture/settings.ts";
import { renderLaunchAgentPlist } from "#lib/launchd.ts";
import { tempDir } from "#test/support/brim-capture.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function scratchDir(): Promise<string> {
  const directory = await tempDir("brim-capture-");
  roots.push(directory);
  return directory;
}

function cli(name: string) {
  const found = captureCli(name);
  if (found === undefined) throw new Error(name);
  return found;
}

type TestContext = CaptureCommandContext & { out: string[]; err: string[] };

function envContext(
  settings: Partial<BrimCaptureSettings>,
  options: { readonly up?: boolean; readonly home?: string } = {},
): TestContext {
  const out: string[] = [];
  const err: string[] = [];
  const home = options.home ?? "/nonexistent";
  return {
    paths: defaultBrimCapturePaths(home),
    capturesDb: path.join(home, "captures.sqlite"),
    loadSettings: () =>
      Promise.resolve({
        enabled: true,
        port: 47_821,
        retentionDays: 30,
        clis: [cli("claude"), cli("codex")],
        ...settings,
      }),
    proxyUp: () => Promise.resolve(options.up ?? true),
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    out,
    err,
  };
}

async function homeWithCa(): Promise<string> {
  const home = await scratchDir();
  const paths = defaultBrimCapturePaths(home);
  await mkdir(path.dirname(paths.caCert), { recursive: true });
  await writeFile(paths.caCert, "cert");
  return home;
}

function quiet(): TestContext {
  const out: string[] = [];
  const err: string[] = [];
  return {
    paths: defaultBrimCapturePaths("/nonexistent"),
    capturesDb: "/nonexistent/captures.sqlite",
    loadSettings: () => Promise.reject(new Error("settings must not load")),
    proxyUp: () => Promise.resolve(false),
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    out,
    err,
  };
}

describe("capture CLI table", () => {
  test("never intercepts an auth or telemetry host", () => {
    const hosts = allCaptureHosts();
    for (const host of NEVER_INTERCEPT_HOSTS) expect(hosts).not.toContain(host);
  });

  test("records only anchored inference paths", () => {
    for (const entry of CAPTURE_CLIS) {
      for (const route of entry.routes) {
        expect(route.path.startsWith("^/")).toBe(true);
      }
    }
    const claude = new RegExp(cli("claude").routes[0]?.path ?? "$^");
    expect(claude.test("/v1/messages?beta=true")).toBe(true);
    expect(claude.test("/v1/messages/count_tokens")).toBe(false);
    expect(claude.test("/api/event_logging/v2/batch")).toBe(false);
  });

  test("only Claude Code and Codex are verified, and they are the default", async () => {
    expect(
      CAPTURE_CLIS.filter((entry) => entry.status === "verified").map(
        (entry) => entry.name,
      ),
    ).toEqual(["claude", "codex"]);
    for (const entry of CAPTURE_CLIS.filter(
      (item) => item.status !== "verified",
    )) {
      expect(entry.routes.every((route) => !route.verified)).toBe(true);
    }
    const settings = await loadBrimCaptureSettings({
      environment: {},
      configPath: "/nonexistent/config.toml",
    });
    expect(settings).toMatchObject({
      enabled: false,
      port: 47_821,
      retentionDays: 30,
    });
    expect(settings.clis.map((entry) => entry.name)).toEqual([
      "claude",
      "codex",
    ]);
  });

  test("reads the wrapped CLIs from a comma list and rejects unknown names", async () => {
    const settings = await loadBrimCaptureSettings({
      environment: { BRIM_CAPTURE_CLIS: "codex, grok" },
      configPath: "/nonexistent/config.toml",
    });
    expect(settings.clis.map((entry) => entry.name)).toEqual(["codex", "grok"]);
    await expect(
      loadBrimCaptureSettings({
        environment: { BRIM_CAPTURE_CLIS: "claude,nope" },
        configPath: "/nonexistent",
      }),
    ).rejects.toThrow();
  });

  test("reads the TOML table the how-to documents", async () => {
    const configPath = path.join(await scratchDir(), "config.toml");
    await writeFile(
      configPath,
      '[brim.capture]\nenabled = true\nport = 48000\nretention.days = 7\nclis = ["codex"]\n',
    );
    const settings = await loadBrimCaptureSettings({
      environment: {},
      configPath,
    });
    expect(settings).toMatchObject({
      enabled: true,
      port: 48_000,
      retentionDays: 7,
    });
    expect(settings.clis.map((entry) => entry.name)).toEqual(["codex"]);
  });

  test("allow_hosts patterns match host:port, not just the host", () => {
    const pattern = new RegExp(allowHostPattern("api.anthropic.com"));
    expect(pattern.test("api.anthropic.com:443")).toBe(true);
    expect(pattern.test("api.anthropic.com")).toBe(true);
    expect(pattern.test("apixanthropic.com:443")).toBe(false);
    expect(pattern.test("evil.api.anthropic.com:443")).toBe(false);
  });
});

describe("capture engine", () => {
  test("runs the pinned mitmdump on loopback, intercepting only the wrapped hosts", () => {
    const paths = defaultBrimCapturePaths("/Users/me");
    const argv = mitmdumpArgv({
      paths,
      port: 47_821,
      clis: [cli("claude"), cli("codex")],
    });
    expect(argv.slice(0, 6)).toEqual([
      "uvx",
      "--python",
      CAPTURE_PYTHON_VERSION,
      "--from",
      `mitmproxy==${MITMPROXY_VERSION}`,
      "mitmdump",
    ]);
    expect(argv).toContain("upstream_cert=false");
    expect(argv.join(" ")).toContain(
      "--listen-host 127.0.0.1 --listen-port 47821",
    );
    const allowed = argv.flatMap((arg, index) =>
      argv[index - 1] === "--allow-hosts" ? [arg] : [],
    );
    expect(allowed).toEqual([
      allowHostPattern("api.anthropic.com"),
      allowHostPattern("chatgpt.com"),
    ]);
    const routes = argv
      .find((arg) => arg.startsWith("brim_capture_routes="))
      ?.slice("brim_capture_routes=".length);
    expect(JSON.parse(routes ?? "[]")).toEqual(
      addonRoutes([cli("claude"), cli("codex")]),
    );
    expect(() => mitmdumpArgv({ paths, port: 1, clis: [] })).toThrow(
      /nothing to capture/,
    );
  });

  test("writes out the embedded addon the Python tests cover", async () => {
    const paths = defaultBrimCapturePaths(await scratchDir());
    await writeAddon(paths);
    const written = await readFile(paths.addon, "utf8");
    const source = await readFile(
      path.join(import.meta.dirname, "../../../capture/brim_capture.py"),
      "utf8",
    );
    expect(written).toBe(source);
    const info = await stat(paths.addon);
    expect(info.mode & 0o777).toBe(0o600);
  });

  test("CI tests the addon against the same mitmproxy and Python", async () => {
    const raw = await readFile(
      path.join(import.meta.dirname, "../../../ci-tests.json"),
      "utf8",
    );
    const ciTests = z
      .object({
        steps: z.array(
          z.object({
            name: z.string().optional(),
            command: z.array(z.string()).optional(),
          }),
        ),
      })
      .parse(JSON.parse(raw));
    const step = ciTests.steps.find((entry) => entry.name === "capture-addon");
    expect(step?.command).toEqual(
      expect.arrayContaining([
        "uvx",
        "--python",
        CAPTURE_PYTHON_VERSION,
        `mitmproxy==${MITMPROXY_VERSION}`,
        "capture",
      ]),
    );
  });

  test("the LaunchAgent keeps the proxy alive", () => {
    const plist = renderLaunchAgentPlist(
      captureLaunchAgent(defaultBrimCapturePaths("/Users/tester"), ["brim"]),
    );
    expect(plist).toContain("<string>com.jerred.brim-capture</string>");
    expect(plist).toContain("<key>KeepAlive</key>\n  <true/>");
    expect(plist).toMatch(
      /<string>brim<\/string>\n {4}<string>capture<\/string>\n {4}<string>run<\/string>/,
    );
    expect(plist).toContain("/Users/tester/.toolkit/brim-capture/logs");
  });
});

describe("capture CA", () => {
  test("renders name constraints for exactly the capture hosts", () => {
    const config = caOpenSslConfig(["api.anthropic.com", "chatgpt.com"]);
    expect(config).toContain(
      "nameConstraints = critical,permitted;DNS:api.anthropic.com,permitted;DNS:chatgpt.com",
    );
    expect(config).toContain("basicConstraints = critical,CA:TRUE,pathlen:0");
    expect(() => caOpenSslConfig([])).toThrow();
    expect(() => caOpenSslConfig(["bad host; rm"])).toThrow();
  });

  test("generates a private, name-constrained CA once and the SSL_CERT_FILE bundle", async () => {
    const paths = defaultBrimCapturePaths(await scratchDir());
    const systemRoots =
      "-----BEGIN CERTIFICATE-----\nROOTS\n-----END CERTIFICATE-----\n";
    const hosts = ["api.anthropic.com", "chatgpt.com"];
    const options = {
      paths,
      hosts,
      systemRoots: () => Promise.resolve(systemRoots),
    };
    expect(await ensureCaptureCa(options)).toBe(true);
    const modes = await Promise.all(
      [paths.caKey, path.dirname(paths.caKey), paths.confDir].map(
        async (file) => {
          const info = await stat(file);
          return info.mode & 0o777;
        },
      ),
    );
    expect(modes).toEqual([0o600, 0o700, 0o700]);
    const text = await runCommand([
      "openssl",
      "x509",
      "-in",
      paths.caCert,
      "-noout",
      "-text",
    ]);
    expect(text.stdout).toMatch(/Name Constraints: critical/);
    expect(text.stdout).toContain("DNS:chatgpt.com");
    const combined = await readFile(
      path.join(paths.confDir, "mitmproxy-ca.pem"),
      "utf8",
    );
    expect(combined).toMatch(/PRIVATE KEY-----[\s\S]*BEGIN CERTIFICATE/);
    const bundle = await readFile(paths.bundle, "utf8");
    const cert = await readFile(paths.caCert, "utf8");
    expect(bundle.startsWith(systemRoots)).toBe(true);
    expect(bundle.endsWith(cert)).toBe(true);
    expect(await ensureCaptureCa(options)).toBe(false);
    const status = await captureCaStatus(paths, hosts);
    expect(status.current).toBe(true);
    expect(
      await ensureCaptureCa({ ...options, hosts: [...hosts, "api.x.ai"] }),
    ).toBe(true);
  });
});

describe("brim capture env", () => {
  test("prints nothing when capture is off or the CLI is not wrapped", async () => {
    const off = envContext({ enabled: false }, { up: false });
    expect(await captureEnvCommand(off, "claude")).toBe(0);
    const unlisted = envContext({}, { up: false });
    expect(await captureEnvCommand(unlisted, "grok")).toBe(0);
    expect(await captureEnvCommand(unlisted, "agent")).toBe(0);
    expect([...off.out, ...off.err, ...unlisted.out, ...unlisted.err]).toEqual(
      [],
    );
  });

  test("fails loudly when capture is on but the proxy is down", async () => {
    const down = envContext({}, { up: false, home: await homeWithCa() });
    expect(await captureEnvCommand(down, "claude")).toBe(1);
    expect(down.out).toEqual([]);
    expect(down.err.join("\n")).toMatch(
      /no proxy is listening on 127\.0\.0\.1:47821/,
    );
  });

  test("fails loudly when the CA is missing", async () => {
    const missing = envContext({}, { home: await scratchDir() });
    expect(await captureEnvCommand(missing, "codex")).toBe(1);
    expect(missing.err.join("\n")).toMatch(/capture-ca\.pem is missing/);
  });

  test("prints the CLI's proxy and CA trust exports", async () => {
    const home = await homeWithCa();
    const up = envContext({}, { home });
    expect(await captureEnvCommand(up, "codex")).toBe(0);
    const paths = defaultBrimCapturePaths(home);
    expect(up.out).toEqual([
      renderExports(captureEnvironment(cli("codex"), paths, 47_821)),
    ]);
    expect(up.out[0]).toContain(
      `export CODEX_CA_CERTIFICATE=${shellQuote(paths.caCert)}`,
    );
    expect(up.out[0]).toContain("export HTTPS_PROXY='http://127.0.0.1:47821'");
    expect(up.out[0]).toContain("export NO_PROXY='localhost,127.0.0.1,::1'");
  });

  test("uses the combined bundle for SSL_CERT_FILE and opts Node into the proxy", () => {
    const paths = defaultBrimCapturePaths("/Users/me");
    const grok = Object.fromEntries(captureEnvironment(cli("grok"), paths, 1));
    expect(grok["SSL_CERT_FILE"]).toBe(paths.bundle);
    expect(grok["NODE_EXTRA_CA_CERTS"]).toBeUndefined();
    const kimi = Object.fromEntries(captureEnvironment(cli("kimi"), paths, 1));
    expect(kimi).toMatchObject({
      NODE_EXTRA_CA_CERTS: paths.caCert,
      NODE_USE_ENV_PROXY: "1",
    });
  });

  test("quotes values for eval", () => {
    expect(shellQuote("/Users/o'brien/ca.pem")).toBe(
      String.raw`'/Users/o'\''brien/ca.pem'`,
    );
  });
});

describe("brim capture arguments", () => {
  test.each([
    [[], 2],
    [["bogus"], 2],
    [["env"], 2],
    [["env", "claude", "extra"], 2],
    [["status", "extra"], 2],
  ])("brim capture %j exits %i", async (args, code) => {
    const context = quiet();
    expect(await handleCaptureCommand([...args], [], context)).toBe(code);
    expect(context.err.length).toBeGreaterThan(0);
  });

  test("--help prints usage and exits 0", async () => {
    const context = quiet();
    expect(await handleCaptureCommand(["--help"], [], context)).toBe(0);
    expect(context.out.join("\n")).toContain("brim capture env <cli>");
  });

  test("redact --dry-run reports without a store", async () => {
    const context = quiet();
    expect(
      await handleCaptureCommand(
        ["redact", "--dry-run", "--json"],
        [],
        context,
      ),
    ).toBe(0);
    expect(JSON.parse(context.out.join("\n"))).toMatchObject({
      spoolFiles: 0,
      blobs: 0,
      dryRun: true,
    });
  });
});

describe("capture record contract", () => {
  const schemaDir = path.join(import.meta.dirname, "../../../schemas");

  test.each(Object.entries(BRIM_CAPTURE_CONTRACTS))(
    "%s matches its checked-in JSON Schema and fixture",
    async (name, schema) => {
      const checkedIn: unknown = JSON.parse(
        await readFile(path.join(schemaDir, `${name}.schema.json`), "utf8"),
      );
      expect(z.toJSONSchema(schema)).toEqual(checkedIn);
      const fixture: unknown = JSON.parse(
        await readFile(path.join(schemaDir, `fixtures/${name}.json`), "utf8"),
      );
      expect(() => schema.parse(fixture)).not.toThrow();
    },
  );
});

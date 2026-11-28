import { chmod, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  defaultDockerTimeoutMs,
  DOCKER_CLI_TIMEOUT_MS,
  docker,
} from "#providers/docker/docker-cli.ts";
import {
  dockerCreateArgs,
  DockerSandboxProvider,
} from "#providers/docker/provider.ts";
import { reapManagedContainers } from "#providers/docker/reap.ts";
import {
  currentDockerEndpoints,
  LABELS,
  parseSandboxRows,
  type SandboxRow,
} from "#providers/docker/rows.ts";
import { BOOT_TIMEOUT_MS, newSandboxId } from "#sandbox/boot.ts";
import { parsePortBinding } from "#providers/docker/paper-container.ts";
import { resolveProfile } from "#sandbox/profiles.ts";
import { SandboxStore, type SandboxRecord } from "#sandbox/record.ts";
import { publishedStorm } from "#test/fixtures/published-storm.ts";

const secrets = { bridgeToken: "b".repeat(48), rconPassword: "c".repeat(48) };

function mounts(instance: string): string[] {
  vi.stubEnv("TOOLKIT_MC_INSTANCE", instance);
  return dockerCreateArgs({
    id: "sbx-abc123",
    profileName: "paper",
    profile: resolveProfile({ profile: "paper", world: "flat" }, secrets),
    pluginsDir: "/tmp/plugins",
    cacheDir: "/tmp/cache",
    expiresAt: "2026-10-04T00:00:00.000Z",
    owner: "me@host",
    keep: false,
  }).filter((arg) => arg.includes(":/data/"));
}

describe("docker sandbox argv", () => {
  it("keeps writable Paperclip mounts disjoint between named instances", () => {
    try {
      const first = mounts("skylands");
      const second = mounts("other-task");
      expect(first).toHaveLength(3);
      expect(first).toContain(
        "/tmp/cache/instances/skylands/paperclip/cache:/data/cache",
      );
      expect(first.every((mount) => !second.includes(mount))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("publishes every port on loopback only and labels the container", () => {
    const profile = resolveProfile(
      { profile: "paper", world: "flat" },
      secrets,
    );
    const options = {
      id: "sbx-abc123",
      profileName: "paper",
      profile,
      pluginsDir: "/tmp/plugins",
      cacheDir: "/tmp/cache",
      expiresAt: "2026-10-04T00:00:00.000Z",
      owner: "me@host",
      keep: false,
    };
    const args = dockerCreateArgs(options, "linux");
    expect(args.filter((_, i) => args[i - 1] === "-p")).toEqual([
      "127.0.0.1::25565",
      "127.0.0.1::25575",
      "127.0.0.1::25580",
    ]);
    expect(args).toContain(`${LABELS.sandbox}=sbx-abc123`);
    expect(args).toContain(
      `${LABELS.expiresAt}=${Date.parse("2026-10-04T00:00:00.000Z").toString()}`,
    );
    expect(args).toContain(`${LABELS.daemonPid}=${process.pid.toString()}`);
    expect(args).toContain(`${LABELS.keep}=false`);
    expect(args).toContain("/tmp/plugins:/plugins:ro");
    expect(args).toContain(`MC_BRIDGE_TOKEN=${secrets.bridgeToken}`);
    expect(args.at(-1)).toMatch(/^itzg\/minecraft-server:.+@sha256:/u);
    expect(args).not.toContain("--add-host");
    profile.env["FLAGS_URL"] = "http://host.docker.internal:12345";
    expect(dockerCreateArgs(options, "linux")).toContain(
      "host.docker.internal:host-gateway",
    );
    expect(dockerCreateArgs(options, "darwin")).not.toContain("--add-host");
  });

  it("mounts storm image overlays as individual files in Docker", () => {
    const request = publishedStorm("storm-candidate");
    const profile = resolveProfile(request, secrets);
    const args = dockerCreateArgs({
      id: "sbx-def456",
      profileName: "storm-candidate",
      profile,
      pluginsDir: "/tmp/storm-staging/plugins",
      cacheDir: "/tmp/cache",
      expiresAt: "2026-10-04T00:00:00.000Z",
      owner: "me@host",
      keep: false,
    });
    expect(args).toContain(
      "/tmp/storm-staging/plugins/TheStorm/config.yml:/plugins/TheStorm/config.yml:ro",
    );
    expect(args).toContain(
      "/tmp/storm-staging/plugins/TheStormFixtures.jar:/plugins/TheStormFixtures.jar:ro",
    );
    expect(args).not.toContain("/tmp/storm-staging/plugins:/plugins:ro");
    expect(args).toContain("1000:3000");
    expect(args).toContain("2000");
    expect(args).toContain("type=volume,destination=/data,volume-nocopy");
    expect(args.at(-1)).toBe(
      `${request.publishedArtifact.uri}@${request.publishedArtifact.digest}`,
    );
  });

  it("parses docker ps rows", () => {
    const rows = parseSandboxRows(
      "abc123def456\tsbx-abc123\t1791072000000\tfalse\trunning\t\tme@host:wt-alpha-111111\t4242\n" +
        "fff123def456\tsbx-fff123\t2026-10-04T00:00:00.000Z\ttrue\texited\n",
    );
    expect(rows).toEqual([
      {
        containerId: "abc123def456",
        id: "sbx-abc123",
        expiresAt: "1791072000000",
        keep: false,
        running: true,
        stale: false,
        ports: "",
        owner: "me@host:wt-alpha-111111",
        daemonPid: 4242,
      },
      {
        containerId: "fff123def456",
        id: "sbx-fff123",
        expiresAt: "2026-10-04T00:00:00.000Z",
        keep: true,
        running: false,
        stale: true,
        ports: "",
        owner: "",
        daemonPid: null,
      },
    ]);
  });

  it("parses the IPv4 loopback port binding", () => {
    expect(parsePortBinding("127.0.0.1:55001\n[::1]:55001\n")).toEqual({
      host: "127.0.0.1",
      port: 55_001,
    });
  });

  it("generates ids the IPC schema accepts", () => {
    expect(newSandboxId()).toMatch(/^sbx-[0-9a-f]{6}$/u);
  });

  it("resolves all current published ports after Docker changes their allocation", () => {
    const endpoints = currentDockerEndpoints(
      "127.0.0.1:32916->25565/tcp, 127.0.0.1:32917->25575/tcp, 127.0.0.1:32918->25580/tcp",
    );
    expect(endpoints).toEqual({
      game: { host: "127.0.0.1", port: 32_916 },
      rcon: { host: "127.0.0.1", port: 32_917 },
      bridge: { host: "127.0.0.1", port: 32_918 },
    });
    expect(() => currentDockerEndpoints("0.0.0.0:32916->25565/tcp")).toThrow(
      "loopback",
    );
  });
});

describe("reapManagedContainers", () => {
  it("reaps current-instance orphans and expired dead-daemon containers across other wt-* instances", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mc-reap-wt-"));
    try {
      const sharedDir = path.join(root, "shared");
      const currentSandboxes = path.join(
        sharedDir,
        "instances",
        "wt-current-aaaaaa",
        "sandboxes",
      );
      const foreignDeadSandboxDir = path.join(
        sharedDir,
        "instances",
        "wt-other-bbbbbb",
        "sandboxes",
        "sbx-dead02",
      );
      await mkdir(foreignDeadSandboxDir, { recursive: true });
      const store = new SandboxStore(currentSandboxes);
      const nowMs = 1_800_000_000_000;
      const allRows: SandboxRow[] = [
        {
          containerId: "cur-expired",
          id: "sbx-aa0001",
          expiresAt: String(nowMs - 1000),
          keep: false,
          running: true,
          stale: false,
          ports: "",
          owner: "me@host:wt-current-aaaaaa",
          daemonPid: 100,
        },
        {
          containerId: "wt-expired-dead",
          id: "sbx-dead02",
          expiresAt: String(nowMs - 1000),
          keep: false,
          running: true,
          stale: false,
          ports: "",
          owner: "me@host:wt-other-bbbbbb",
          daemonPid: 200,
        },
        {
          containerId: "wt-expired-alive",
          id: "sbx-bb0003",
          expiresAt: String(nowMs - 1000),
          keep: false,
          running: true,
          stale: false,
          ports: "",
          owner: "me@host:wt-third-cccccc",
          daemonPid: 300,
        },
        {
          containerId: "wt-future-dead",
          id: "sbx-cc0004",
          expiresAt: String(nowMs + 60_000),
          keep: false,
          running: true,
          stale: false,
          ports: "",
          owner: "me@host:wt-fourth-dddddd",
          daemonPid: 200,
        },
      ];
      const removedContainers: string[] = [];
      const reaped = await reapManagedContainers({
        now: new Date(nowMs),
        baseOwner: "me@host",
        currentOwner: "me@host:wt-current-aaaaaa",
        sharedDir,
        currentDaemonPid: 100,
        isAlive: (pid) => pid === 100 || pid === 300,
        store,
        listRows: async (ownerFilter) =>
          ownerFilter === undefined
            ? allRows
            : allRows.filter((row) => row.owner === ownerFilter),
        removeContainer: async (containerId) => {
          removedContainers.push(containerId);
        },
      });
      expect(reaped).toEqual(["sbx-aa0001", "sbx-dead02"]);
      expect(removedContainers).toEqual(["cur-expired", "wt-expired-dead"]);
      await expect(stat(foreignDeadSandboxDir)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("paper profile", () => {
  it("adds a void generator only for void worlds", () => {
    const flat = resolveProfile({ profile: "paper", world: "flat" }, secrets);
    const empty = resolveProfile({ profile: "paper", world: "void" }, secrets);
    expect(flat.env["GENERATOR_SETTINGS"]).toBeUndefined();
    expect(JSON.parse(empty.env["GENERATOR_SETTINGS"] ?? "{}")).toMatchObject({
      biome: "minecraft:the_void",
    });
    expect(flat.env).toMatchObject({
      ONLINE_MODE: "FALSE",
      ENABLE_RCON: "true",
      MC_BRIDGE_PORT: "25580",
      MC_BRIDGE_BIND: "0.0.0.0",
    });
    expect(flat.plugins.map((plugin) => plugin.name)).toEqual([
      "WorldEdit",
      "Citizens",
    ]);
  });
});

describe("docker CLI timeouts", () => {
  it("uses 15_000ms for fast probes and BOOT_TIMEOUT_MS for create/run/cp", () => {
    for (const fast of ["info", "ps", "port", "logs", "rm"]) {
      expect(defaultDockerTimeoutMs([fast])).toBe(DOCKER_CLI_TIMEOUT_MS);
      expect(defaultDockerTimeoutMs([fast])).toBe(15_000);
    }
    for (const slow of ["create", "run", "cp"]) {
      expect(defaultDockerTimeoutMs([slow])).toBe(BOOT_TIMEOUT_MS);
    }
  });

  it("kills wedged docker children cleanly when timeoutMs expires", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mc-docker-timeout-"));
    const pidFile = path.join(root, "docker.pid");
    const fakeDocker = path.join(root, "docker");
    try {
      await Bun.write(
        fakeDocker,
        `#!${process.execPath}
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setInterval(() => {}, 10_000);
`,
      );
      await chmod(fakeDocker, 0o755);
      vi.stubEnv("PATH", `${root}:${Bun.env["PATH"] ?? ""}`);

      await expect(
        docker(["info", "--format", "{{.ServerVersion}}"], { timeoutMs: 300 }),
      ).rejects.toThrow("docker info timed out after 300ms");

      const pidText = await Bun.file(pidFile).text();
      const childPid = Number(pidText.trim());
      expect(Number.isInteger(childPid)).toBe(true);
      expect(() => process.kill(childPid, 0)).toThrow();
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("surfaces non-zero docker preflight failures with context", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mc-docker-preflight-"));
    const fakeDocker = path.join(root, "docker");
    try {
      await Bun.write(
        fakeDocker,
        String.raw`#!${process.execPath}
process.stderr.write("Cannot connect to the Docker daemon\n");
process.exit(1);
`,
      );
      await chmod(fakeDocker, 0o755);
      vi.stubEnv("PATH", `${root}:${Bun.env["PATH"] ?? ""}`);

      const provider = new DockerSandboxProvider({
        repoRoot: root,
        store: new SandboxStore(path.join(root, "sandboxes")),
      });
      await expect(provider.preflight()).rejects.toThrow(
        "Docker is not available for sandboxes: docker info failed (1): Cannot connect to the Docker daemon",
      );
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function listenEchoBackend(tag: string) {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.once("data", (chunk) => {
      socket.end(`${tag}:${chunk.toString("utf8")}`);
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("missing backend port");
  return {
    port: address.port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function probeProxy(port: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const client = net.createConnection({ host: "127.0.0.1", port }, () => {
      client.write("ping");
    });
    let received = "";
    client.setEncoding("utf8");
    client.on("data", (chunk: string) => {
      received += chunk;
    });
    client.once("error", reject);
    client.once("end", () => resolve(received));
  });
}

describe("docker restart port reconciliation", () => {
  it("persists reassigned ports for plain sandboxes and recreates real-map capture proxies", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mc-docker-restart-"));
    const stateFile = path.join(root, "ps-output.txt");
    const fakeDocker = path.join(root, "docker");
    const backendA = await listenEchoBackend("before");
    const backendB = await listenEchoBackend("after");
    const store = new SandboxStore(path.join(root, "sandboxes"));
    const provider = new DockerSandboxProvider({
      repoRoot: root,
      store,
      owner: "me@host",
    });
    try {
      await Bun.write(
        fakeDocker,
        `#!${process.execPath}\nimport { readFileSync } from "node:fs";\nif (process.argv[2] === "ps") process.stdout.write(readFileSync(${JSON.stringify(stateFile)}, "utf8"));\n`,
      );
      await chmod(fakeDocker, 0o755);
      vi.stubEnv("PATH", `${root}:${Bun.env["PATH"] ?? ""}`);
      vi.stubEnv("TOOLKIT_MC_INSTANCE", "");

      const baseRecord = (
        id: string,
        containerId: string,
        world: SandboxRecord["world"],
      ): SandboxRecord => ({
        id,
        provider: "docker",
        profile: "paper",
        world,
        ...(world === "real-map"
          ? { mapSource: { sha256: "a".repeat(64), files: 1, bytes: 1024 } }
          : {}),
        status: "ready",
        createdAt: "2026-10-04T00:00:00.000Z",
        expiresAt: "2026-10-04T02:00:00.000Z",
        keep: true,
        bootMs: 1200,
        endpoints: {
          game: { host: "127.0.0.1", port: 40_001 },
          rcon: { host: "127.0.0.1", port: 40_002 },
          bridge: { host: "127.0.0.1", port: 40_003 },
        },
        providerRef: { kind: "docker", containerId },
        owner: "me@host",
        secrets,
      });

      await store.write(baseRecord("sbx-aa0001", "111111111111aaaa", "flat"));
      await store.write(
        baseRecord("sbx-bb0002", "222222222222bbbb", "real-map"),
      );
      const rowLine = (row: {
        cid: string;
        id: string;
        ports: readonly [number, number, number];
      }) =>
        `${row.cid}\t${row.id}\t1791079200000\ttrue\trunning\t127.0.0.1:${row.ports[0].toString()}->25565/tcp, 127.0.0.1:${row.ports[1].toString()}->25575/tcp, 127.0.0.1:${row.ports[2].toString()}->25580/tcp\tme@host\t${process.pid.toString()}`;

      await Bun.write(
        stateFile,
        `${rowLine({ cid: "111111111111", id: "sbx-aa0001", ports: [41_001, 41_002, 41_003] })}\n${rowLine({ cid: "222222222222", id: "sbx-bb0002", ports: [backendA.port, 42_002, 42_003] })}\n`,
      );
      const firstList = await provider.list();
      const plainFirst = firstList.find((r) => r.id === "sbx-aa0001");
      const realFirst = firstList.find((r) => r.id === "sbx-bb0002");
      const plainStoredFirst = await store.read("sbx-aa0001");
      expect(plainFirst?.endpoints).toEqual({
        game: { host: "127.0.0.1", port: 41_001 },
        rcon: { host: "127.0.0.1", port: 41_002 },
        bridge: { host: "127.0.0.1", port: 41_003 },
      });
      expect(plainStoredFirst?.endpoints).toEqual(plainFirst?.endpoints);
      expect(realFirst?.endpoints.rcon.port).toBe(42_002);
      expect(realFirst?.endpoints.bridge.port).toBe(42_003);
      const firstProxyPort = realFirst?.endpoints.game.port ?? 0;
      expect(await probeProxy(firstProxyPort)).toContain("before:");

      await Bun.write(
        stateFile,
        `${rowLine({ cid: "111111111111", id: "sbx-aa0001", ports: [51_001, 51_002, 51_003] })}\n${rowLine({ cid: "222222222222", id: "sbx-bb0002", ports: [backendB.port, 52_002, 52_003] })}\n`,
      );
      const secondList = await provider.list();
      const plainSecond = secondList.find((r) => r.id === "sbx-aa0001");
      const realSecond = secondList.find((r) => r.id === "sbx-bb0002");
      const plainStoredSecond = await store.read("sbx-aa0001");
      const realStoredSecond = await store.read("sbx-bb0002");
      expect(plainSecond?.endpoints).toEqual({
        game: { host: "127.0.0.1", port: 51_001 },
        rcon: { host: "127.0.0.1", port: 51_002 },
        bridge: { host: "127.0.0.1", port: 51_003 },
      });
      expect(plainStoredSecond?.endpoints).toEqual(plainSecond?.endpoints);
      expect(realSecond?.endpoints.rcon.port).toBe(52_002);
      expect(realSecond?.endpoints.bridge.port).toBe(52_003);
      const secondProxyPort = realSecond?.endpoints.game.port ?? 0;
      expect(secondProxyPort).not.toBe(firstProxyPort);
      expect(await probeProxy(secondProxyPort)).toContain("after:");
      expect(realStoredSecond?.endpoints).toEqual(realSecond?.endpoints);
    } finally {
      await provider.destroy("sbx-bb0002").catch(() => {
        // Best-effort cleanup when mock docker has no real container.
      });
      await backendA.close();
      await backendB.close();
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });
});

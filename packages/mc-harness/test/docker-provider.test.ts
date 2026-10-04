import { describe, expect, it } from "vitest";
import {
  dockerCreateArgs,
  LABELS,
  parseSandboxRows,
} from "#providers/docker/provider.ts";
import { newSandboxId } from "#sandbox/boot.ts";
import { parsePortBinding } from "#providers/docker/paper-container.ts";
import { resolveProfile } from "#sandbox/profiles.ts";

const secrets = { bridgeToken: "b".repeat(48), rconPassword: "c".repeat(48) };

describe("docker sandbox argv", () => {
  it("publishes every port on loopback only and labels the container", () => {
    const args = dockerCreateArgs({
      id: "sbx-abc123",
      profileName: "paper",
      profile: resolveProfile({ profile: "paper", world: "flat" }, secrets),
      pluginsDir: "/tmp/plugins",
      cacheDir: "/tmp/cache",
      expiresAt: "2026-10-04T00:00:00.000Z",
      owner: "me@host",
      keep: false,
    });
    expect(args.filter((_, i) => args[i - 1] === "-p")).toEqual([
      "127.0.0.1::25565",
      "127.0.0.1::25575",
      "127.0.0.1::25580",
    ]);
    expect(args).toContain(`${LABELS.sandbox}=sbx-abc123`);
    expect(args).toContain(`${LABELS.expiresAt}=2026-10-04T00:00:00.000Z`);
    expect(args).toContain(`${LABELS.keep}=false`);
    expect(args).toContain("/tmp/plugins:/plugins:ro");
    expect(args).toContain(`MC_BRIDGE_TOKEN=${secrets.bridgeToken}`);
    expect(args.at(-1)).toMatch(/^itzg\/minecraft-server:.+@sha256:/u);
  });

  it("parses docker ps rows", () => {
    const rows = parseSandboxRows(
      "abc123def456\tsbx-abc123\t2026-10-04T00:00:00.000Z\tfalse\trunning\n" +
        "fff123def456\tsbx-fff123\t2026-10-04T00:00:00.000Z\ttrue\texited\n",
    );
    expect(rows).toEqual([
      {
        containerId: "abc123def456",
        id: "sbx-abc123",
        expiresAt: "2026-10-04T00:00:00.000Z",
        keep: false,
        running: true,
        stale: false,
      },
      {
        containerId: "fff123def456",
        id: "sbx-fff123",
        expiresAt: "2026-10-04T00:00:00.000Z",
        keep: true,
        running: false,
        stale: true,
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

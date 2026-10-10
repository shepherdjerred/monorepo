import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/minecraft-status.json";
import {
  bedrockPing,
  parseBedrockPong,
  parseQueryReply,
  publicQueryContract,
  queryFullRequest,
  queryHandshake,
} from "#src/minecraft-query.ts";
import {
  MinecraftStatusSchema,
  refreshMinecraftStatus,
} from "#src/minecraft.ts";

const session = Buffer.from([1, 2, 3, 4]);
function queryPacket(
  names: string[],
  overrides: Record<string, string> = {},
): Buffer {
  const stats = {
    version: "26.2",
    plugins: publicQueryContract.queryIdentity,
    numplayers: String(names.length),
    maxplayers: "20",
    ...overrides,
  };
  const fields = Object.entries(stats).flat().join("\0") + "\0";
  return Buffer.concat([
    Buffer.from([0]),
    session,
    Buffer.from("splitnum\0\u{80}\0", "latin1"),
    Buffer.from(fields),
    Buffer.from("\0\u{1}player_\0\0", "latin1"),
    Buffer.from(names.length === 0 ? "\0" : names.join("\0") + "\0\0"),
  ]);
}
function pong(timestamp: bigint): Buffer {
  const value = Buffer.from(
    "MCPE;The Storm;999;26.51;1;20;123;World;Survival;1;19132;19133;",
  );
  const packet = Buffer.alloc(35);
  packet[0] = 0x1c;
  packet.writeBigInt64BE(timestamp, 1);
  Buffer.from("00ffff00fefefefefdfdfdfd12345678", "hex").copy(packet, 17);
  packet.writeUInt16BE(value.length, 33);
  return Buffer.concat([packet, value]);
}
const java = async () => ({
  version: "26.2",
  maximum: 20,
  names: ["Jerred", ".Bedrock Player"],
});
const bedrock = async () => ({ version: "26.51" });
const replicas = async () => ({ desired: 1, ready: 1 });

describe("Minecraft public status", () => {
  it("shares a valid cache fixture with the native PHP reader", () => {
    expect(MinecraftStatusSchema.parse(fixture)).toEqual(fixture);
  });
  it.each([
    { desired: 0, ready: 0, state: "sleeping" },
    { desired: 1, ready: 0, state: "starting" },
  ])("never probes a $state server", async ({ state, ...workload }) => {
    const javaCheck = vi.fn(java),
      bedrockCheck = vi.fn(bedrock);
    expect(
      await refreshMinecraftStatus({
        replicas: async () => workload,
        java: javaCheck,
        bedrock: bedrockCheck,
      }),
    ).toMatchObject({ state, java: { state }, bedrock: { state } });
    expect(javaCheck).not.toHaveBeenCalled();
    expect(bedrockCheck).not.toHaveBeenCalled();
  });
  it("captures actual edition versions and the entire public roster", async () => {
    const status = await refreshMinecraftStatus({ replicas, java, bedrock });
    expect(status).toMatchObject({
      state: "online",
      java: { version: "26.2" },
      bedrock: { version: "26.51" },
      players: { maximum: 20, names: ["Jerred", ".Bedrock Player"] },
    });
    expect(MinecraftStatusSchema.parse(status)).toEqual(status);
  });
  it("keeps Java online when Bedrock fails and logs the failing check", async () => {
    const report = vi.fn();
    const status = await refreshMinecraftStatus({
      replicas,
      java,
      bedrock: async () => {
        throw new Error("timeout");
      },
      report,
    });
    expect(status).toMatchObject({
      state: "online",
      java: { state: "online" },
      bedrock: { state: "unavailable" },
    });
    expect(report).toHaveBeenCalledWith("bedrock-ping", expect.any(Error));
  });
  it("keeps Bedrock online without publishing an unverified Java roster", async () => {
    const status = await refreshMinecraftStatus({
      replicas,
      bedrock,
      java: async () => {
        throw new Error("filter not installed");
      },
      report: vi.fn(),
    });
    expect(status).toMatchObject({
      state: "online",
      java: { state: "unavailable" },
      bedrock: { state: "online" },
    });
    expect(status.players).toBeUndefined();
  });
  it("retains last verified versions but clears players on hibernation and outages", async () => {
    const previous = await refreshMinecraftStatus({ replicas, java, bedrock });
    const status = await refreshMinecraftStatus(
      { replicas: async () => ({ desired: 0, ready: 0 }) },
      previous,
    );
    expect(status.java).toMatchObject({
      state: "sleeping",
      version: "26.2",
      verifiedAt: previous.checkedAt,
    });
    expect(status.players).toBeUndefined();
    const report = vi.fn();
    const broken = await refreshMinecraftStatus(
      {
        replicas: async () => {
          throw new Error("RBAC");
        },
        java: vi.fn(java),
        bedrock: vi.fn(bedrock),
        report,
      },
      previous,
    );
    expect(broken.state).toBe("unavailable");
    expect(broken.players).toBeUndefined();
    expect(report).toHaveBeenCalledWith("workload", expect.any(Error));
  });
  it("rejects cached rosters without healthy Java and incomplete edition metadata", () => {
    expect(() =>
      MinecraftStatusSchema.parse({
        schemaVersion: 2,
        checkedAt: 1,
        state: "online",
        java: { state: "unavailable" },
        bedrock: { state: "unavailable" },
        players: { maximum: 20, names: ["Someone"] },
      }),
    ).toThrow();
    expect(() =>
      MinecraftStatusSchema.parse({
        schemaVersion: 2,
        checkedAt: 1,
        state: "online",
        java: { state: "online" },
        bedrock: { state: "unavailable" },
      }),
    ).toThrow();
  });
});

describe("bounded UDP protocols", () => {
  it("completes Query's challenge with the same session", () => {
    expect(queryHandshake(session)).toEqual(
      Buffer.from([0xfe, 0xfd, 9, 1, 2, 3, 4]),
    );
    const request = queryFullRequest(
      Buffer.concat([Buffer.from([9]), session, Buffer.from("1234\0")]),
      session,
    );
    expect(request.readInt32BE(7)).toBe(1234);
    expect(request.subarray(3, 7)).toEqual(session);
  });
  it("reads full public rosters, including an empty server and Bedrock names", () => {
    expect(
      parseQueryReply(queryPacket(["Jerred", ".Bedrock Player"]), session),
    ).toEqual({
      version: "26.2",
      maximum: 20,
      names: [".Bedrock Player", "Jerred"],
    });
    expect(parseQueryReply(queryPacket([]), session).names).toEqual([]);
  });
  it("refuses unfiltered, mismatched, duplicate and incomplete Query responses", () => {
    expect(() =>
      parseQueryReply(queryPacket(["Staff"], { plugins: "Paper" }), session),
    ).toThrow("filter");
    expect(() =>
      parseQueryReply(queryPacket(["Player"], { numplayers: "2" }), session),
    ).toThrow("count");
    expect(() =>
      parseQueryReply(queryPacket(["Player", "Player"]), session),
    ).toThrow();
    expect(() => parseQueryReply(queryPacket(["<unsafe>"]), session)).toThrow();
    expect(() =>
      parseQueryReply(queryPacket([]).subarray(0, -1), session),
    ).toThrow();
    expect(() => parseQueryReply(queryPacket([]), Buffer.alloc(4))).toThrow(
      "envelope",
    );
    expect(() => parseQueryReply(Buffer.alloc(65_508), session)).toThrow(
      "envelope",
    );
    expect(() =>
      queryFullRequest(
        Buffer.concat([Buffer.from([9]), session, Buffer.from("bad\0")]),
        session,
      ),
    ).toThrow("challenge");
  });
  it("validates Bedrock pong identity, timestamp and length", () => {
    expect(bedrockPing(123n, Buffer.alloc(8))).toHaveLength(33);
    expect(parseBedrockPong(pong(123n), 123n)).toEqual({ version: "26.51" });
    expect(() => parseBedrockPong(pong(123n), 124n)).toThrow();
    expect(() => parseBedrockPong(pong(123n).subarray(0, -1), 123n)).toThrow();
    expect(() => parseBedrockPong(Buffer.alloc(10), 123n)).toThrow();
  });
});

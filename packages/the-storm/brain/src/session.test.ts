import { afterEach, describe, expect, it, vi } from "vitest";
import type { PilotConfig } from "./config.ts";
import { runSession, type SessionClient, type SessionRcon } from "./session.ts";

const CONFIG: PilotConfig = {
  enabled: true,
  timeZone: "America/Los_Angeles",
  startHour: 18,
  endHour: 20,
  minecraftHost: "127.0.0.1",
  minecraftPort: 25_565,
  rconHost: "127.0.0.1",
  rconPort: 25_575,
  clientVersion: "26.1",
  maxCompanions: 1,
  botPlayerName: "Pilot",
  llmEnabled: false,
  llmModel: "gpt-6-luna",
  monthlyBudgetUsd: 20,
};

class FakeClient implements SessionClient {
  private readonly players = new Set(["Pilot", "Alex"]);
  private readonly listeners = new Map<string, Set<(name: string) => void>>();

  username = () => "Pilot";
  playerNames = () => [...this.players];
  onSpawn = (listener: () => void) => this.subscribe("spawn", listener);
  onError = (listener: () => void) => this.subscribe("error", listener);
  onEnd = (listener: () => void) => this.subscribe("end", listener);
  onKicked = (listener: () => void) => this.subscribe("kicked", listener);
  onPlayerJoined = (listener: (name: string) => void) =>
    this.subscribe("joined", listener);
  onPlayerLeft = (listener: (name: string) => void) =>
    this.subscribe("left", listener);

  private subscribe(
    event: string,
    listener: (name: string) => void,
  ): () => void {
    const listeners =
      this.listeners.get(event) ?? new Set<(name: string) => void>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return () => {
      listeners.delete(listener);
    };
  }

  private emit(event: string, name = ""): void {
    for (const listener of this.listeners.get(event) ?? []) listener(name);
  }

  spawn(): void {
    this.emit("spawn");
  }
  joined(name: string): void {
    this.players.add(name);
    this.emit("joined", name);
  }
  left(name: string): void {
    this.players.delete(name);
    this.emit("left", name);
  }
}

async function listPlayers(): Promise<string> {
  return "There are 2 of a max of 20 players online: Pilot, Alex";
}

class FakeRcon implements SessionRcon {
  readonly command = vi.fn(listPlayers);
  private listener: ((error: Error) => void) | undefined;

  onFailure(listener: (error: Error) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  fail(): void {
    this.listener?.(new Error("socket closed"));
  }
}

function start(client: FakeClient, rcon: FakeRcon) {
  const session = runSession(client, rcon, CONFIG);
  client.spawn();
  return session;
}

async function settle(): Promise<void> {
  for (let step = 0; step < 6; step++) await Promise.resolve();
}

afterEach(() => vi.useRealTimers());

describe("companion session", () => {
  it("rejects a connected profile that differs from the configured pilot", async () => {
    const client = new FakeClient();
    client.username = () => "Unexpected";
    const rcon = new FakeRcon();
    await expect(start(client, rcon)).rejects.toThrow(
      "connected Minecraft profile does not match configured pilot name",
    );
  });

  it("disconnects immediately when the last human leaves", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T01:30:00Z"));
    const client = new FakeClient();
    const rcon = new FakeRcon();
    const session = start(client, rcon);
    await settle();
    client.left("Alex");
    expect(await session).toBe("human-left");
    expect(rcon.command).toHaveBeenCalledExactlyOnceWith("list");
  });

  it("keeps the session when another human joins before the first leaves", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T01:30:00Z"));
    const client = new FakeClient();
    const session = start(client, new FakeRcon());
    await settle();
    client.joined("Sam");
    client.left("Alex");
    client.left("Sam");
    expect(await session).toBe("human-left");
  });

  it("keeps a human who joins while the post-spawn RCON result is in flight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T01:30:00Z"));
    const client = new FakeClient();
    const rcon = new FakeRcon();
    let answer!: (value: string) => void;
    rcon.command.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
    );
    const session = start(client, rcon);
    await settle();
    answer("There are 2 of a max of 20 players online: Pilot, Alex");
    client.joined("Sam");
    await settle();
    client.left("Alex");
    await settle();
    expect(await Promise.race([session, Promise.resolve("pending")])).toBe(
      "pending",
    );
    client.left("Sam");
    expect(await session).toBe("human-left");
  });

  it("rechecks RCON when its first roster misses a replacement human", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T01:30:00Z"));
    const client = new FakeClient();
    const rcon = new FakeRcon();
    let firstAnswer!: (value: string) => void;
    rcon.command
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            firstAnswer = resolve;
          }),
      )
      .mockResolvedValueOnce(
        "There are 2 of a max of 20 players online: Pilot, Sam",
      );
    const session = start(client, rcon);
    await settle();
    client.left("Alex");
    client.joined("Sam");
    firstAnswer("There are 2 of a max of 20 players online: Pilot, Alex");
    await settle();
    expect(rcon.command).toHaveBeenCalledTimes(2);
    expect(await Promise.race([session, Promise.resolve("pending")])).toBe(
      "pending",
    );
    client.left("Sam");
    expect(await session).toBe("human-left");
  });

  it("ends at 20:00 Pacific without a recurring timer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T01:30:00Z"));
    const session = start(new FakeClient(), new FakeRcon());
    await settle();
    await vi.advanceTimersByTimeAsync(90 * 60 * 1000);
    expect(await session).toBe("window-end");
  });

  it("fails closed when RCON disconnects after the presence check", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T01:30:00Z"));
    const rcon = new FakeRcon();
    const session = start(new FakeClient(), rcon);
    await settle();
    rcon.fail();
    await expect(session).rejects.toThrow("RCON connection lost");
  });

  it("does not stay if RCON and Mineflayer cannot agree on a human", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T01:30:00Z"));
    const client = new FakeClient();
    client.left("Alex");
    expect(await start(client, new FakeRcon())).toBe("no-human");
  });
});

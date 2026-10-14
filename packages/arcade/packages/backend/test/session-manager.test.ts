import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { games, type GameId } from "@arcade/common/catalog.ts";
import { neutralController } from "@arcade/common/protocol.ts";
import type { PooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/pooled-userbot";
import type { UserbotEntry } from "@shepherdjerred/discord-stream-lifecycle/pool/userbot-pool";
import type { GameServerModule, GameSession } from "#src/games/module.ts";
import { SessionManager } from "#src/session/manager.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function deferred() {
  const { promise, resolve } = Promise.withResolvers<undefined>();
  return {
    promise,
    resolve: () => {
      resolve(undefined);
    },
  };
}

async function harness(
  options: {
    start?: () => Promise<void>;
    stop?: () => Promise<void>;
    clearInput?: (seat: number) => void;
  } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), "arcade-manager-"));
  directories.push(root);
  const accounts: UserbotEntry<PooledUserbot>[] = Array.from(
    { length: 3 },
    (_unused, index) => ({
      busy: false,
      guildIds: new Set(["1", "2"]),
      userbot: {
        login: async () => {
          /* Account lifecycle is observed through pool reservations. */
        },
        destroy: async () => {
          /* Account lifecycle is observed through pool reservations. */
        },
        userId: () => String(index + 10),
        guildIds: () => ["1", "2"],
      },
    }),
  );
  let starts = 0;
  let stops = 0;
  const inputs: number[] = [];
  const cleared: number[] = [];
  const errors: Error[] = [];
  let fatalError: ((error: Error) => void) | undefined;
  const modules = new Map<GameId, GameServerModule<PooledUserbot>>();
  for (const definition of Object.values(games))
    modules.set(definition.id, {
      definition,
      saveEntries: [],
      create: (context) => {
        fatalError = context.fatalError;
        const runtime: GameSession = {
          start: async () => {
            starts++;
            await options.start?.();
          },
          stop: async () => {
            stops++;
            await options.stop?.();
          },
          input: (seat) => {
            inputs.push(seat);
          },
          clearInput: (seat) => {
            cleared.push(seat);
            options.clearInput?.(seat);
          },
          screenshot: async () => Buffer.alloc(0),
        };
        return runtime;
      },
    });
  const manager = new SessionManager({
    pool: {
      acquire: (guildId) => {
        const account = accounts.find(
          (entry) => !entry.busy && entry.guildIds.has(guildId),
        );
        if (account === undefined) return null;
        account.busy = true;
        return account;
      },
      release: (entry) => {
        entry.busy = false;
      },
      canServe: () => true,
    },
    modules,
    stateRoot: root,
    maxSessions: 2,
    maxHeavySessions: 1,
    changed: () => {
      /* These tests observe manager state directly. */
    },
    error: (error) => {
      errors.push(error);
    },
  });
  return {
    manager,
    accounts,
    inputs,
    cleared,
    errors,
    crash: (error: Error) => {
      if (fatalError === undefined) throw new Error("runtime not started");
      fatalError(error);
    },
    counts: () => ({ starts, stops }),
  };
}

const request = (gameId: GameId, channel = "3", guild = "1") => ({
  gameId,
  guildId: guild,
  voiceChannelId: channel,
  textChannelId: "4",
  startedByUserId: "5",
});

describe("Arcade reservations", () => {
  it("releases a crashed runtime before another session acquires its save and account", async () => {
    const h = await harness();
    const result = await h.manager.start(request("melee"));
    expect(result.kind).toBe("started");
    h.crash(new Error("headless browser exited"));
    await expect.poll(() => h.manager.list()).toEqual([]);
    expect(h.accounts.some((account) => account.busy)).toBe(false);
    expect(h.errors[0]?.message).toBe("headless browser exited");
    expect(await resultKind(h.manager.start(request("melee")))).toBe("started");
    await h.manager.shutdown();
  });
  it("reserves a channel and save before boot finishes without blocking another game", async () => {
    const gate = deferred();
    const h = await harness({ start: () => gate.promise });
    const first = h.manager.start(request("mk64"));
    expect(await resultKind(h.manager.start(request("emerald")))).toBe(
      "occupied",
    );
    expect(await resultKind(h.manager.start(request("mk64", "6")))).toBe(
      "save-in-use",
    );
    const second = h.manager.start(request("emerald", "6"));
    expect(await resultKind(h.manager.start(request("melee", "7")))).toBe(
      "capacity",
    );
    gate.resolve();
    expect(await resultKind(first)).toBe("started");
    expect(await resultKind(second)).toBe("started");
    expect(h.accounts.filter((entry) => entry.busy)).toHaveLength(2);
    await h.manager.shutdown();
    expect(h.accounts.some((entry) => entry.busy)).toBe(false);
  });

  it("limits heavy games across guilds while allowing a light game", async () => {
    const h = await harness();
    expect(await resultKind(h.manager.start(request("brawl")))).toBe("started");
    expect(await resultKind(h.manager.start(request("melee", "6", "2")))).toBe(
      "heavy-capacity",
    );
    expect(
      await resultKind(h.manager.start(request("emerald", "6", "2"))),
    ).toBe("started");
    await h.manager.shutdown();
  });

  it("cancels boot and holds reservations until teardown completes", async () => {
    const boot = deferred();
    const teardown = deferred();
    const h = await harness({
      start: () => boot.promise,
      stop: () => teardown.promise,
    });
    const starting = h.manager.start(request("mk64"));
    await expect.poll(() => h.counts().starts).toBe(1);
    const session = h.manager.list()[0];
    if (session === undefined) throw new Error("missing reservation");
    const stopping = h.manager.stop(session.id, {
      userId: "5",
      moderator: false,
    });
    boot.resolve();
    await expect.poll(() => h.counts().stops).toBe(1);
    expect(await resultKind(h.manager.start(request("mk64", "6")))).toBe(
      "save-in-use",
    );
    teardown.resolve();
    expect(await resultKind(starting)).toBe("cancelled");
    expect(await resultKind(stopping)).toBe("stopped");
    expect(h.counts()).toEqual({ starts: 1, stops: 1 });
    expect(h.manager.list()).toEqual([]);
    expect(h.accounts.some((entry) => entry.busy)).toBe(false);
  });

  it("cleans a failed start and surfaces a failed final save", async () => {
    const h = await harness({
      start: async () => {
        throw new Error("boot failed");
      },
      stop: async () => {
        throw new Error("save failed");
      },
    });
    const result = await h.manager.start(request("mk64"));
    expect(result.kind).toBe("failed");
    expect(h.manager.list()).toEqual([]);
    expect(h.accounts.some((entry) => entry.busy)).toBe(false);
    expect(h.errors.map((error) => error.message)).toEqual(["save failed"]);
    expect(h.manager.room("1", "mk64").snapshot().error).toBe("save failed");
  });

  it("rejects unauthorized stops and stale input after a replacement session", async () => {
    const h = await harness();
    const result = await h.manager.start(request("mk64"));
    if (result.kind !== "started") throw new Error("start failed");
    expect(
      await h.manager.stop(result.session.id, {
        userId: "9",
        moderator: false,
      }),
    ).toEqual({ kind: "forbidden" });
    const room = h.manager.room("1", "mk64");
    const player = { discordId: "5", name: "Driver", avatarUrl: null };
    expect(room.claim(result.session.id, "first-tab", player, 0)).toBe(
      "claimed",
    );
    expect(room.claim(result.session.id, "second-tab", player, 0)).toBe(
      "claimed",
    );
    expect(room.input(result.session.id, "first-tab", neutralController)).toBe(
      false,
    );
    expect(room.input(result.session.id, "second-tab", neutralController)).toBe(
      true,
    );
    expect(h.inputs).toEqual([0]);
    expect(h.cleared).toContain(0);
    await h.manager.stop(result.session.id, { userId: "9", moderator: true });
    const replacement = await h.manager.start(request("mk64"));
    if (replacement.kind !== "started") throw new Error("replacement failed");
    expect(room.claim(replacement.session.id, "second-tab", player, 0)).toBe(
      "claimed",
    );
    expect(room.input(result.session.id, "second-tab", neutralController)).toBe(
      false,
    );
    expect(
      await h.manager.stop(result.session.id, {
        userId: "5",
        moderator: false,
      }),
    ).toEqual({ kind: "not-active" });
    expect(h.manager.list()).toHaveLength(1);
    await h.manager.shutdown();
  });

  it("releases accounts and rooms even when the input transport and final save fail", async () => {
    const h = await harness({
      clearInput: () => {
        throw new Error("controller pipe closed");
      },
      stop: async () => {
        throw new Error("save failed");
      },
    });
    const result = await h.manager.start(request("mk64"));
    if (result.kind !== "started") throw new Error("start failed");
    const room = h.manager.room("1", "mk64");
    room.claim(
      result.session.id,
      "controller",
      { discordId: "5", name: "Driver", avatarUrl: null },
      0,
    );
    const stopped = await h.manager.stop(result.session.id, {
      userId: "5",
      moderator: false,
    });
    expect(stopped.kind).toBe("stopped");
    if (stopped.kind !== "stopped") throw new Error("stop failed");
    expect(stopped.error).toBeInstanceOf(AggregateError);
    expect(h.cleared).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(h.counts().stops).toBe(1);
    expect(h.manager.list()).toEqual([]);
    expect(room.snapshot().session).toBeNull();
    expect(room.snapshot().seats).toEqual([null, null, null, null]);
    expect(h.accounts.some((entry) => entry.busy)).toBe(false);
  });
});

async function resultKind(result: Promise<{ kind: string }>) {
  const value = await result;
  return value.kind;
}

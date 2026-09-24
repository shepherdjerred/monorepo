import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { GLOBAL_SCOPE, guildScope } from "#src/reports/duckdb/scope.ts";
import {
  ListServersDataSchema,
  createListMyServersTool,
  resolveTurnScope,
} from "#src/explore/tools/server-scope.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId, testGuildId } from "#src/testing/test-ids.ts";
import {
  passthroughTracker as track,
  runExploreTool as run,
} from "#src/testing/explore-tool-runner.ts";

const { prisma } = createTestDatabase("explore-server-scope");
afterAll(async () => {
  await prisma.$disconnect();
});

const ALPHA = testGuildId("811");
const BETA = testGuildId("812");
const OUTSIDE = testGuildId("819");

describe("resolveTurnScope", () => {
  test("no servers is a global query, names resolving across the turn", () => {
    expect(resolveTurnScope(undefined, [ALPHA, BETA])).toEqual({
      ok: true,
      scope: GLOBAL_SCOPE,
      guildIds: [ALPHA, BETA],
    });
  });

  test("one server is that server's own scope", () => {
    expect(resolveTurnScope([ALPHA], [ALPHA, BETA])).toEqual({
      ok: true,
      scope: guildScope(ALPHA),
      guildIds: [ALPHA],
    });
  });

  test("all is every server in the turn, merged", () => {
    const turn = resolveTurnScope("all", [ALPHA, BETA]);
    expect(turn).toEqual({
      ok: true,
      scope: { kind: "servers", serverIds: [ALPHA, BETA] },
      guildIds: [ALPHA, BETA],
    });
  });

  test("a server the user is not in is refused, not queried", () => {
    const turn = resolveTurnScope([ALPHA, OUTSIDE], [ALPHA, BETA]);
    expect(turn.ok).toBe(false);
    if (turn.ok) throw new Error("expected a refusal");
    expect(turn.message).toContain(OUTSIDE);
    expect(turn.message).toContain("list_my_servers");
  });

  test("all with no servers in the turn is refused", () => {
    expect(resolveTurnScope("all", []).ok).toBe(false);
  });
});

describe("list_my_servers", () => {
  // Fifty servers: a user in many must never have them put in the prompt,
  // and the list must never reach outside the turn.
  const turn = Array.from({ length: 50 }, (_, index) =>
    testGuildId(`83${index.toString().padStart(2, "0")}`),
  );

  beforeEach(async () => {
    await prisma.guildInstall.deleteMany();
    await prisma.guildInstall.createMany({
      data: [...turn, OUTSIDE].map((serverId, index) => ({
        serverId,
        serverName:
          serverId === OUTSIDE
            ? "Rift Rivals"
            : index === 7
              ? "Rift Walkers"
              : `Server ${index.toString().padStart(2, "0")}`,
        ownerDiscordId: testAccountId("8001"),
        addedByDiscordId: testAccountId("8001"),
        memberCount: 10,
        installedAt: new Date(Date.UTC(2026, 0, 1)),
      })),
    });
  });

  async function list(input: { search?: string; limit?: number }) {
    const result = await run(
      createListMyServersTool({ db: prisma, guildIds: turn, track }).execute,
      input,
    );
    return ListServersDataSchema.parse(result.data);
  }

  test("searches by name within the turn only", async () => {
    const result = await list({ search: "rift" });
    expect(result.servers).toEqual([
      { serverId: turn[7], name: "Rift Walkers" },
    ]);
    expect(result.total).toBe(1);
  });

  test("pages a long list and reports the total", async () => {
    const result = await list({ limit: 5 });
    expect(result.servers).toHaveLength(5);
    expect(result.total).toBe(50);
    expect(
      z
        .array(z.string())
        .parse(result.servers.map((server) => server.serverId))
        .every((serverId) => turn.includes(serverId)),
    ).toBe(true);
  });
});

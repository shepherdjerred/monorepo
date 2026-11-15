import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  SCOUT_DESKTOP_API_ROUTES,
  SCOUT_DESKTOP_CONTRACT_HEADER,
  ScoutDesktopApiErrorSchema,
  ScoutDesktopConversationGetResponseSchema,
  ScoutDesktopConversationListResponseSchema,
} from "@scout-for-lol/data";
import { resetConfigurationForTests } from "#src/configuration.ts";
import { scoutTestVisualization } from "#src/discord/scout/test-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma } = createTestDatabase("scout-client-desktop-explore");

vi.doMock("#src/database/index.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  prisma,
}));

const mocks = vi.hoisted(() => ({ fetchUserGuilds: vi.fn() }));
vi.doMock("#src/lib/discord-rest.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchUserGuilds: mocks.fetchUserGuilds,
}));
vi.doMock("#src/trpc/auth-web-helpers.ts", () => ({
  getAppOrigin: () => "https://scout.invalid",
}));

const { handleScoutClientRoute } = await import("#src/scout-client/http.ts");
const { approvePairing, createPairing, exchangePairing, revokeDevice } =
  await import("#src/scout-client/pairing.ts");
const { appendExploreAnswer, startExploreTurn } =
  await import("#src/explore/store.ts");
const {
  resetDesktopReadRateLimitForTests,
  resetDesktopRenderRateLimitForTests,
} = await import("./rate-limit.ts");

const OWNER_ID = DiscordAccountIdSchema.parse("160509172704739328");
const OTHER_USER_ID = DiscordAccountIdSchema.parse("160509172704739329");
const SHARED_GUILD = "111111111111111111";
const OTHER_GUILD = "222222222222222222";
const ORIGIN = "https://scout.invalid";
const originalEnvironment = Bun.env["ENVIRONMENT"];
const originalAllowlist = Bun.env["EXPLORE_GUILD_ALLOWLIST"];

const PAIRING_INPUT = {
  deviceName: "Scout Desktop",
  platform: "windows",
  architecture: "x86_64",
  appVersion: "0.4.0",
  protocolVersion: 1,
} as const;

function guild(id: string) {
  return { id, name: "Server", icon: null, owner: false, permissions: "0" };
}

/** Pair, approve as the owner and exchange, exactly as the client does. */
async function pairedDevice(
  scopes: readonly ("ingest" | "explore")[] | undefined,
): Promise<{ deviceId: string; token: string }> {
  const pairing = await createPairing(PAIRING_INPUT, new Date(), scopes);
  expect(await approvePairing(pairing.pairingId, OWNER_ID)).toBe("approved");
  const exchange = await exchangePairing(
    pairing.pairingId,
    pairing.pairingSecret,
  );
  if (exchange?.status !== "approved") throw new Error("pairing failed");
  return { deviceId: exchange.deviceId, token: exchange.token };
}

async function post(path: string, token: string, body: unknown = {}) {
  const request = new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      [SCOUT_DESKTOP_CONTRACT_HEADER]: "1",
    },
    body: JSON.stringify(body),
  });
  const response = await handleScoutClientRoute(request, new URL(request.url));
  if (response === null) throw new Error("route was not handled");
  return response;
}

async function errorCode(response: Response) {
  return ScoutDesktopApiErrorSchema.parse(await response.json()).error;
}

const LIST_PATH = SCOUT_DESKTOP_API_ROUTES.explore_conversations_list.path;
const GET_PATH = SCOUT_DESKTOP_API_ROUTES.explore_conversations_get.path;
const CHART_PATH = SCOUT_DESKTOP_API_ROUTES.explore_visualization.path;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A question and an answer that carries a chart, as a finished run stores it. */
async function answerWithChart(userId: typeof OWNER_ID) {
  const started = await startExploreTurn(prisma, {
    conversationId: null,
    userId,
    question: "Which champions win most?",
    attach: { kind: "leaf" },
    origin: "desktop",
  });
  const answer = await appendExploreAnswer(prisma, {
    conversationId: started.conversationId,
    parentMessageId: started.messageId,
    guildIds: [],
    answer: {
      answer: "Ahri wins most often.",
      title: null,
      queryText: null,
      includeVisualization: true,
      caveats: [],
      followUps: [],
      matchCards: [],
      loadoutCards: [],
    },
    preview: null,
    visualization: scoutTestVisualization,
    trace: [],
  });
  return {
    conversationId: started.conversationId,
    questionId: started.messageId,
    answerId: answer.id,
  };
}

beforeEach(async () => {
  Bun.env["ENVIRONMENT"] = "beta";
  Bun.env["EXPLORE_GUILD_ALLOWLIST"] = SHARED_GUILD;
  resetConfigurationForTests();
  resetDesktopReadRateLimitForTests();
  resetDesktopRenderRateLimitForTests();
  mocks.fetchUserGuilds.mockReset();
  mocks.fetchUserGuilds.mockResolvedValue([guild(SHARED_GUILD)]);
  await prisma.exploreMessage.deleteMany();
  await prisma.exploreConversation.deleteMany();
  await prisma.scoutClientDeviceVersion.deleteMany();
  await prisma.scoutClientDevice.deleteMany();
  await prisma.scoutClientPairing.deleteMany();
  await prisma.user.deleteMany();
  for (const discordId of [OWNER_ID, OTHER_USER_ID]) {
    await prisma.user.create({
      data: { discordId, discordUsername: `user-${discordId}` },
    });
  }
});

afterAll(async () => {
  if (originalEnvironment === undefined) delete Bun.env["ENVIRONMENT"];
  else Bun.env["ENVIRONMENT"] = originalEnvironment;
  if (originalAllowlist === undefined)
    delete Bun.env["EXPLORE_GUILD_ALLOWLIST"];
  else Bun.env["EXPLORE_GUILD_ALLOWLIST"] = originalAllowlist;
  resetConfigurationForTests();
  await prisma.$disconnect();
});

describe("desktop Explore against a real database", () => {
  test("a v2 pairing grants explore and reads only the owner's conversations", async () => {
    const { deviceId, token } = await pairedDevice(["ingest", "explore"]);
    const stored = await prisma.scoutClientDevice.findUniqueOrThrow({
      where: { id: deviceId },
    });
    expect(stored.scopes).toEqual(["ingest", "explore"]);
    const own = await startExploreTurn(prisma, {
      conversationId: null,
      userId: OWNER_ID,
      question: "Who carries our ARAMs?",
      attach: { kind: "leaf" },
      origin: "web",
    });
    const foreign = await startExploreTurn(prisma, {
      conversationId: null,
      userId: OTHER_USER_ID,
      question: "Someone else's question",
      attach: { kind: "leaf" },
      origin: "web",
    });

    const list = await post(LIST_PATH, token);
    expect(list.status).toBe(200);
    const { conversations } = ScoutDesktopConversationListResponseSchema.parse(
      await list.json(),
    );
    expect(conversations.map((conversation) => conversation.id)).toEqual([
      own.conversationId,
    ]);

    const transcript = await post(GET_PATH, token, {
      conversationId: own.conversationId,
    });
    expect(transcript.status).toBe(200);
    const body = ScoutDesktopConversationGetResponseSchema.parse(
      await transcript.json(),
    );
    expect(body.messages.map((message) => message.content)).toEqual([
      "Who carries our ARAMs?",
    ]);

    const other = await post(GET_PATH, token, {
      conversationId: foreign.conversationId,
    });
    expect(other.status).toBe(404);
    expect(await errorCode(other)).toBe("not_found");
  });

  test("a device paired through the original route keeps ingest only", async () => {
    const { deviceId, token } = await pairedDevice(undefined);
    const stored = await prisma.scoutClientDevice.findUniqueOrThrow({
      where: { id: deviceId },
    });
    expect(stored.scopes).toEqual(["ingest"]);

    const response = await post(LIST_PATH, token);

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("scope_required");
  });

  test("a revoked device is unauthorized", async () => {
    const { deviceId, token } = await pairedDevice(["ingest", "explore"]);
    expect(await revokeDevice(deviceId, OWNER_ID)).toBe(true);

    const response = await post(LIST_PATH, token);

    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("unauthorized");
  });

  test("an owner who shares no eligible server is refused", async () => {
    const { token } = await pairedDevice(["ingest", "explore"]);
    mocks.fetchUserGuilds.mockResolvedValue([guild(OTHER_GUILD)]);

    const response = await post(LIST_PATH, token);

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("explore_forbidden");
  });

  test("the chart route draws only the owner's stored chart", async () => {
    const { token } = await pairedDevice(["ingest", "explore"]);
    const own = await answerWithChart(OWNER_ID);
    const foreign = await answerWithChart(OTHER_USER_ID);

    const drawn = await post(CHART_PATH, token, {
      conversationId: own.conversationId,
      messageId: own.answerId,
    });
    expect(drawn.status).toBe(200);
    expect(drawn.headers.get("Content-Type")).toBe("image/png");
    const bytes = new Uint8Array(await drawn.arrayBuffer());
    expect([...bytes.slice(0, PNG_SIGNATURE.length)]).toEqual(PNG_SIGNATURE);

    for (const body of [
      { conversationId: foreign.conversationId, messageId: foreign.answerId },
      { conversationId: own.conversationId, messageId: foreign.answerId },
      { conversationId: own.conversationId, messageId: own.questionId },
    ]) {
      const refused = await post(CHART_PATH, token, body);
      expect(refused.status).toBe(404);
      expect(await errorCode(refused)).toBe("not_found");
    }
  });

  test("the database refuses a scope outside the contract", async () => {
    const pairing = await createPairing(PAIRING_INPUT);

    await expect(
      prisma.$executeRaw`UPDATE "ScoutClientPairing" SET "scopes" = ARRAY['admin'] WHERE "id" = ${pairing.pairingId}`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`UPDATE "ScoutClientPairing" SET "scopes" = ARRAY[]::TEXT[] WHERE "id" = ${pairing.pairingId}`,
    ).rejects.toThrow();
  });
});

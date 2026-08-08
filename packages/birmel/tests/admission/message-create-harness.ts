// Runs in a dedicated Bun test process because module mocks are process-global.
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Client } from "discord.js";
import type { TurnInput } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import type { MessageContext } from "@shepherdjerred/birmel/discord/events/message-create.ts";
import { resetConfig } from "@shepherdjerred/birmel/config/index.ts";

const BOT_ID = "100000000000000001";
const TRUSTED_USER_ID = "100000000000000002";
const UNTRUSTED_USER_ID = "100000000000000003";
const GUILD_ID = "100000000000000004";
const CHANNEL_ID = "100000000000000005";
const THREAD_ID = "100000000000000006";
const VOICE_CHANNEL_ID = "100000000000000007";

const trustedUserIds = [TRUSTED_USER_ID];
let recentlyEngaged = false;
let classifierDecision = false;
let classifierCalls = 0;
let activeSessionId: string | null = null;

const previousTrustedUserIds = Bun.env["TRUSTED_USER_IDS"];
Bun.env["TRUSTED_USER_IDS"] = JSON.stringify(trustedUserIds);
resetConfig();

void mock.module(
  "@shepherdjerred/birmel/database/repositories/activity.ts",
  () => ({ recordMessageActivity: () => null }),
);

void mock.module(
  "@shepherdjerred/birmel/database/repositories/guild-owner.ts",
  () => ({
    getOrCreateGuildOwner: () => Promise.resolve({ currentOwner: "jerred" }),
  }),
);

void mock.module(
  "@shepherdjerred/birmel/discord/engagement-tracker.ts",
  () => ({
    isRecentlyEngaged: () => recentlyEngaged,
    markEngaged() {
      recentlyEngaged = true;
    },
  }),
);

void mock.module(
  "@shepherdjerred/birmel/discord/should-respond-classifier.ts",
  () => ({
    classifyShouldRespond: () => {
      classifierCalls += 1;
      return Promise.resolve(classifierDecision);
    },
  }),
);

void mock.module(
  "@shepherdjerred/birmel/discord/utils/channel-history.ts",
  () => ({
    getRecentChannelMessages: () => Promise.resolve([]),
    formatTranscript: () => "",
  }),
);

void mock.module("@shepherdjerred/birmel/persona/guild-persona.ts", () => ({
  getGuildPersona: () => Promise.resolve("virmel"),
}));

void mock.module("@shepherdjerred/birmel/sessions/service.ts", () => ({
  getActiveSessionForThread: () =>
    Promise.resolve(activeSessionId == null ? null : { id: activeSessionId }),
}));

const { setMessageHandler, setupMessageCreateHandler } =
  await import("@shepherdjerred/birmel/discord/events/message-create.ts");

let registeredListener: ((message: unknown) => void) | undefined;
const client = new Client({ intents: [] });
Reflect.set(client, "user", { id: BOT_ID });
Reflect.set(client, "on", (eventName: string, candidate: unknown) => {
  if (eventName === "messageCreate" && typeof candidate === "function") {
    registeredListener = (message: unknown): void => {
      Reflect.apply(candidate, client, [message]);
    };
  }
  return client;
});
setupMessageCreateHandler(client);

let messageSequence = 100;

function nextMessageId(): string {
  messageSequence += 1;
  return String(100_000_000_000_000_000n + BigInt(messageSequence));
}

type FakeMessageOptions = {
  id?: string;
  authorId?: string;
  authorBot?: boolean;
  content?: string;
  mentionsBot?: boolean;
  thread?: boolean;
  image?: boolean;
};

function fakeMessage(
  options: FakeMessageOptions = {},
): Record<string, unknown> {
  const thread = options.thread ?? false;
  const attachments = new Map<string, Record<string, unknown>>();
  if (options.image === true) {
    attachments.set("image-1", {
      id: "image-1",
      url: "https://cdn.example.test/image.png",
      name: "image.png",
      contentType: "image/png",
      size: 1234,
      width: 640,
      height: 480,
    });
  }
  return {
    id: options.id ?? nextMessageId(),
    guild: { id: GUILD_ID },
    author: {
      id: options.authorId ?? TRUSTED_USER_ID,
      username: "trusted-friend",
      bot: options.authorBot ?? false,
    },
    channel: {
      id: thread ? THREAD_ID : CHANNEL_ID,
      isThread: () => thread,
    },
    mentions: {
      has: (userId: string) =>
        options.mentionsBot === true && userId === BOT_ID,
    },
    member: { voice: { channelId: VOICE_CHANNEL_ID } },
    content: options.content ?? "hello",
    attachments,
    createdAt: new Date("2026-08-08T12:00:00.000Z"),
  };
}

function emitMessage(message: unknown): void {
  if (registeredListener == null) {
    throw new Error("messageCreate listener was not registered");
  }
  registeredListener(message);
}

async function drainAdmission(): Promise<void> {
  await Bun.sleep(5);
}

let deliveries: MessageContext[] = [];

beforeEach(() => {
  trustedUserIds.splice(0, trustedUserIds.length, TRUSTED_USER_ID);
  recentlyEngaged = false;
  classifierDecision = false;
  classifierCalls = 0;
  activeSessionId = null;
  deliveries = [];
  setMessageHandler((context) => {
    deliveries.push(context);
    return Promise.resolve();
  });
});

afterAll(() => {
  if (previousTrustedUserIds == null) {
    delete Bun.env["TRUSTED_USER_IDS"];
  } else {
    Bun.env["TRUSTED_USER_IDS"] = previousTrustedUserIds;
  }
  resetConfig();
});

describe("Birmel 3.0 Discord admission", () => {
  test("treats the trusted allowlist as the authority and ignores bots", async () => {
    emitMessage(fakeMessage({ mentionsBot: true }));
    emitMessage(
      fakeMessage({ authorId: UNTRUSTED_USER_ID, mentionsBot: true }),
    );
    emitMessage(fakeMessage({ authorBot: true, mentionsBot: true }));
    await drainAdmission();

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.turn.userId).toBe(TRUSTED_USER_ID);
    expect(deliveries[0]?.turn.triggerKind).toBe("mention");
  });

  test("admits wake words and classifier-approved engaged follow-ups", async () => {
    emitMessage(fakeMessage({ content: "hey berred" }));
    await drainAdmission();

    recentlyEngaged = true;
    classifierDecision = true;
    emitMessage(fakeMessage({ content: "and what about tomorrow?" }));
    await drainAdmission();

    expect(deliveries.map(({ turn }) => turn.triggerKind)).toEqual([
      "wake-word",
      "engaged-follow-up",
    ]);
    expect(classifierCalls).toBe(1);
  });

  test("does not admit an unengaged or classifier-rejected follow-up", async () => {
    emitMessage(fakeMessage({ content: "unrelated chatter" }));
    await drainAdmission();
    expect(deliveries).toHaveLength(0);
    expect(classifierCalls).toBe(0);

    recentlyEngaged = true;
    classifierDecision = false;
    emitMessage(fakeMessage({ content: "still unrelated" }));
    await drainAdmission();
    expect(deliveries).toHaveLength(0);
    expect(classifierCalls).toBe(1);
  });

  test("lets trusted actors bypass classification in an active session thread", async () => {
    activeSessionId = "session-1";
    emitMessage(fakeMessage({ thread: true, content: "continue" }));
    emitMessage(
      fakeMessage({
        thread: true,
        content: "intrude",
        authorId: UNTRUSTED_USER_ID,
      }),
    );
    await drainAdmission();

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.activeSessionId).toBe("session-1");
    expect(deliveries[0]?.turn.triggerKind).toBe("session-thread");
    expect(classifierCalls).toBe(0);
  });

  test("leaves restart-safe deduplication to AgentRun persistence", async () => {
    const id = nextMessageId();
    emitMessage(fakeMessage({ id, mentionsBot: true }));
    emitMessage(fakeMessage({ id, mentionsBot: true }));
    await drainAdmission();

    expect(deliveries).toHaveLength(2);
    expect(deliveries.map(({ turn }) => turn.discordMessageId)).toEqual([
      id,
      id,
    ]);
  });

  test("constructs a typed turn with Discord provenance and image metadata", async () => {
    const id = nextMessageId();
    emitMessage(
      fakeMessage({
        id,
        mentionsBot: true,
        thread: true,
        image: true,
        content: `<@${BOT_ID}> inspect this`,
      }),
    );
    await drainAdmission();

    const turn: TurnInput | undefined = deliveries[0]?.turn;
    expect(turn).toEqual({
      discordMessageId: id,
      guildId: GUILD_ID,
      channelId: THREAD_ID,
      threadId: THREAD_ID,
      userId: TRUSTED_USER_ID,
      username: "trusted-friend",
      content: `<@${BOT_ID}> inspect this`,
      attachments: [
        {
          id: "image-1",
          url: "https://cdn.example.test/image.png",
          contentType: "image/png",
          name: "image.png",
        },
      ],
      voiceChannelId: VOICE_CHANNEL_ID,
      triggerKind: "mention",
      receivedAt: new Date("2026-08-08T12:00:00.000Z"),
    });
  });
});

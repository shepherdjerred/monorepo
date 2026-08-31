import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  CustomGameParticipant,
  CustomGameSnapshot,
  CustomNightParticipant,
  CustomNightSnapshot,
} from "@scout-for-lol/data";

const NIGHT_ID = "c83f3ef2-2ef4-4bd2-935b-83f439e771e4";
const GAME_ID = "e0b71754-09fe-4c1e-9954-6412538bfe35";
const GUILD_ID = "1337623164146155593";
const CHANNEL_ID = "1337623164146155594";
const HOST_ID = "160509172704739328";
const NOW = "2026-08-29T20:00:00.000Z";

function discordId(index: number): string {
  return (160_509_172_704_739_328n + BigInt(index)).toString();
}

function nightParticipant(index: number): CustomNightParticipant {
  return {
    discordId: index === 0 ? HOST_ID : discordId(index),
    displayName: index === 0 ? "Customs Host" : `Player ${index.toString()}`,
    avatarUrl: null,
    role: index === 0 ? "HOST" : "MEMBER",
    availability: "READY",
    readyAt: NOW,
    awayUntil: null,
    awayOverdue: false,
    held: false,
    consentedAt: NOW,
    playerId: index + 1,
    playerAlias: `player-${index.toString()}`,
    accounts: [
      {
        accountId: index + 1,
        puuid: `puuid-${index.toString()}`,
        region: "AMERICA_NORTH",
        riotGameName: `Player${index.toString()}`,
        riotTagLine: "NA1",
      },
    ],
    selectedAccountId: index + 1,
  };
}

function gameParticipant(index: number): CustomGameParticipant {
  const team = index < 5 ? "A" : "B";
  return {
    discordId: index === 0 ? HOST_ID : discordId(index),
    displayName: index === 0 ? "Customs Host" : `Player ${index.toString()}`,
    playerId: index + 1,
    playerAlias: `player-${index.toString()}`,
    accountId: index + 1,
    puuid: `puuid-${index.toString()}`,
    riotGameName: `Player${index.toString()}`,
    riotTagLine: "NA1",
    rosterOrder: index,
    benchOrder: null,
    team,
    side: team === "A" ? "BLUE" : "RED",
    captain: index === 0 || index === 5,
    pickOrder: null,
    championId: null,
    won: null,
  };
}

function pendingGame(): CustomGameSnapshot {
  return {
    id: GAME_ID,
    sequence: 1,
    state: "RESULT_PENDING",
    rosterMode: "FIRST_TEN",
    map: "SUMMONERS_RIFT",
    pickMode: "TOURNAMENT_DRAFT",
    participants: Array.from({ length: 10 }, (_, index) =>
      gameParticipant(index),
    ),
    activeCaptain: null,
    tournamentLobby: { state: "resolved", code: "NA-TEST-CODE" },
    winner: null,
    voiceState: "READY",
    voiceReady: true,
    voiceOverride: false,
    voiceError: null,
    createdAt: NOW,
    startedAt: NOW,
    completedAt: null,
  };
}

function snapshot(game: CustomGameSnapshot | null): CustomNightSnapshot {
  return {
    id: NIGHT_ID,
    guildId: GUILD_ID,
    guildName: "Scout Beta Guild",
    launchChannelId: CHANNEL_ID,
    voiceLobbyChannelId: CHANNEL_ID,
    hostDiscordId: HOST_ID,
    cohostDiscordIds: [],
    state: game === null ? "RECRUITING" : "PLAYING",
    revision: 3,
    viewerRole: "HOST",
    participants: Array.from({ length: 10 }, (_, index) =>
      nightParticipant(index),
    ),
    currentGame: game,
    recruitmentCounts: {
      ready: 10,
      maybe: 0,
      away: 0,
      held: 0,
      remaining: 0,
    },
    recruitmentMessageId: "1337623164146155598",
    teamAVoiceChannelId: "1337623164146155596",
    teamBVoiceChannelId: "1337623164146155597",
    lastActivityAt: NOW,
    expiresAt: "2026-08-30T08:00:00.000Z",
    endedAt: null,
  };
}

async function installDiscordAdapter(page: Page): Promise<void> {
  await page.addInitScript(
    ({ guildId, channelId, hostId }) => {
      class TestWebSocket extends EventTarget {
        static readonly OPEN = 1;
        readonly readyState = TestWebSocket.OPEN;
        constructor() {
          super();
          queueMicrotask(() => this.dispatchEvent(new Event("open")));
        }
        close() {}
        send() {}
      }
      Object.defineProperty(window, "WebSocket", { value: TestWebSocket });
      window.scoutCustomsSdkAdapter = {
        clientId: "1311755320745394317",
        instanceId: "activity-instance",
        guildId,
        channelId,
        ready: () => Promise.resolve(),
        authorize: () => Promise.resolve("oauth-code"),
        authenticate: () =>
          Promise.resolve({
            id: hostId,
            displayName: "Customs Host",
            avatar: null,
          }),
        invite: () => Promise.resolve(),
        setReadyPresence: () => Promise.resolve(),
        connectedParticipantCount: () => Promise.resolve(10),
        subscribeLayout: () => Promise.resolve(() => Promise.resolve()),
        subscribeParticipants: () => Promise.resolve(() => Promise.resolve()),
      };
    },
    { guildId: GUILD_ID, channelId: CHANNEL_ID, hostId: HOST_ID },
  );
}

async function fulfillTrpc(route: Route, data: unknown): Promise<void> {
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{ result: { data } }]),
  });
}

async function mockBackend(
  page: Page,
  initial: CustomNightSnapshot,
): Promise<void> {
  await page.route("**/api/customs/config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        applicationId: "1311755320745394317",
        contractHash: "test-contract",
      }),
    });
  });
  await page.route("**/api/customs/auth/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        discordAccessToken: "discord-access",
        discordRefreshToken: "discord-refresh",
        activityToken: "activity-token",
        expiresAt: "2099-01-01T00:10:00.000Z",
        refreshUntil: "2099-01-01T02:00:00.000Z",
        contractHash: "test-contract",
      }),
    });
  });
  await page.route("**/trpc/**", async (route) => fulfillTrpc(route, initial));
}

test.beforeEach(async ({ page }) => installDiscordAdapter(page));

test("renders recruitment on desktop in light mode", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await mockBackend(page, snapshot(null));
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Scout Customs" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Close recruitment" }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("customs-recruiting-light-desktop.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.015,
  });
});

test("renders Riot result waiting on mobile in dark mode", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await mockBackend(page, snapshot(pendingGame()));
  await page.goto("./");
  await expect(page.getByText("Waiting for Riot Match-V5")).toBeVisible();
  await expect(page).toHaveScreenshot(
    "customs-result-pending-dark-mobile.png",
    {
      animations: "disabled",
      fullPage: true,
      maxDiffPixelRatio: 0.015,
    },
  );
});

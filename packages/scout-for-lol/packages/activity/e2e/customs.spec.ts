import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  CustomGameParticipant,
  CustomGameSnapshot,
  CustomNightParticipant,
  CustomNightSnapshot,
} from "@scout-for-lol/data";

const NIGHT_ID = "c83f3ef2-2ef4-4bd2-935b-83f439e771e4";
const GAME_ID = "e0b71754-09fe-4c1e-9954-6412538bfe35";
const NOW = "2026-08-15T20:00:00.000Z";

function nightParticipant(index: number): CustomNightParticipant {
  return {
    discordId: index.toString(),
    displayName: `Player ${index.toString()}`,
    avatarUrl: null,
    role: index === 1 ? "HOST" : "MEMBER",
    availability: "READY",
    readyAt: NOW,
    awayUntil: null,
    awayOverdue: false,
    held: false,
    consentedAt: NOW,
    playerId: index,
    playerAlias: `player-${index.toString()}`,
    accounts: [
      {
        accountId: index,
        puuid: `puuid-${index.toString()}`,
        region: "AMERICA_NORTH",
        riotGameName: `Player${index.toString()}`,
        riotTagLine: "NA1",
      },
    ],
    selectedAccountId: index,
  };
}

function gameParticipant(index: number): CustomGameParticipant {
  const captainTeam = index === 1 ? "A" : index === 2 ? "B" : null;
  return {
    discordId: index.toString(),
    displayName: `Player ${index.toString()}`,
    playerId: index,
    playerAlias: `player-${index.toString()}`,
    accountId: index,
    puuid: `puuid-${index.toString()}`,
    riotGameName: `Player${index.toString()}`,
    riotTagLine: "NA1",
    rosterOrder: index - 1,
    benchOrder: null,
    team: captainTeam,
    side: captainTeam === "A" ? "BLUE" : captainTeam === "B" ? "RED" : null,
    captain: captainTeam !== null,
    pickOrder: null,
    championId: null,
    won: null,
  };
}

function game(): CustomGameSnapshot {
  return {
    id: GAME_ID,
    sequence: 1,
    state: "DRAFTING",
    rosterMode: "FIRST_TEN",
    map: "SUMMONERS_RIFT",
    pickMode: "TOURNAMENT_DRAFT",
    participants: Array.from({ length: 10 }, (_, index) =>
      gameParticipant(index + 1),
    ),
    activeCaptain: "A",
    tournamentCode: null,
    tournamentCodeProvisioning: null,
    voiceArrangementProvisioning: null,
    riotMatchId: null,
    winner: null,
    resultSource: null,
    resultDisagreement: false,
    repeatChampionWarnings: [],
    voiceReady: false,
    voiceOverride: false,
    voiceError: null,
    createdAt: NOW,
    startedAt: null,
    completedAt: null,
  };
}

function snapshot(
  overrides: {
    revision?: number;
    guildName?: string;
    currentGame?: CustomGameSnapshot | null;
    hostDiscordId?: string;
    cohostDiscordIds?: string[];
    state?: CustomNightSnapshot["state"];
  } = {},
): CustomNightSnapshot {
  const participants = Array.from({ length: 10 }, (_, index) =>
    nightParticipant(index + 1),
  );
  return {
    id: NIGHT_ID,
    guildId: "guild-1",
    guildName: overrides.guildName ?? "Test Guild",
    launchChannelId: "channel-1",
    voiceLobbyChannelId: "voice-1",
    hostDiscordId: overrides.hostDiscordId ?? "1",
    cohostDiscordIds: overrides.cohostDiscordIds ?? [],
    state: overrides.state ?? "RECRUITING",
    revision: overrides.revision ?? 3,
    participants,
    currentGame: overrides.currentGame ?? null,
    recruitmentCounts: {
      ready: 10,
      maybe: 0,
      away: 0,
      held: 0,
      remaining: 0,
    },
    recruitmentMessageId: "message-1",
    riotTournamentId: null,
    teamAVoiceChannelId: null,
    teamBVoiceChannelId: null,
    lastActivityAt: NOW,
    expiresAt: "2026-08-16T08:00:00.000Z",
    endedAt: null,
  };
}

async function installDiscordAdapter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const sockets: EventTarget[] = [];
    const layoutListeners = new Set<(layoutMode: -1 | 0 | 1 | 2) => void>();
    class TestWebSocket extends EventTarget {
      constructor() {
        super();
        sockets.push(this);
        queueMicrotask(() => this.dispatchEvent(new Event("open")));
      }

      close() {
        this.dispatchEvent(new Event("close"));
      }

      send() {}
    }
    Object.defineProperty(window, "WebSocket", { value: TestWebSocket });
    Object.defineProperty(window, "__testSocketCount", {
      get: () => sockets.length,
    });
    window.addEventListener("scout-test-snapshot", (event) => {
      if (!(event instanceof CustomEvent)) return;
      for (const socket of sockets) {
        socket.dispatchEvent(
          new MessageEvent("message", {
            data: JSON.stringify({ kind: "snapshot", snapshot: event.detail }),
          }),
        );
      }
    });
    window.addEventListener("scout-test-close-sockets", () => {
      for (const socket of sockets) socket.dispatchEvent(new Event("close"));
    });
    window.addEventListener("scout-test-layout", (event) => {
      if (!(event instanceof CustomEvent)) return;
      if (
        event.detail !== -1 &&
        event.detail !== 0 &&
        event.detail !== 1 &&
        event.detail !== 2
      ) {
        throw new Error("Invalid test layout mode");
      }
      for (const listener of layoutListeners) listener(event.detail);
    });
    window.scoutCustomsSdkAdapter = {
      clientId: "123456789012345678",
      instanceId: "instance-1",
      guildId: "guild-1",
      channelId: "channel-1",
      ready: async () => {},
      authorize: async () => "oauth-code",
      authenticate: async () => ({
        id: "1",
        displayName: "Player 1",
        avatar: null,
      }),
      invite: async () => {},
      setReadyPresence: async () => {},
      connectedParticipantCount: async () => 4,
      subscribeLayout: async (listener) => {
        layoutListeners.add(listener);
        window.setTimeout(() => listener(2), 0);
        return async () => {
          layoutListeners.delete(listener);
        };
      },
      subscribeParticipants: async (listener) => {
        window.setTimeout(() => listener(6), 0);
        return async () => {};
      },
    };
  });
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
  mutation?: CustomNightSnapshot,
): Promise<void> {
  await page.route("**/api/customs/auth/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        discordAccessToken: "discord-token",
        discordRefreshToken: "discord-refresh-token",
        activityToken: "activity-token",
        expiresAt: "2099-01-01T00:00:00.000Z",
        contractHash: "test-contract",
      }),
    });
  });
  await page.route("**/trpc/**", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillTrpc(route, initial);
      return;
    }
    await fulfillTrpc(route, { applied: true, snapshot: mutation ?? initial });
  });
}

test.beforeEach(async ({ page }) => {
  await installDiscordAdapter(page);
});

test("cohosts can manage holds without receiving delegation controls", async ({
  page,
}) => {
  await mockBackend(
    page,
    snapshot({ hostDiscordId: "2", cohostDiscordIds: ["1"] }),
  );
  await page.goto("./");

  await page.getByRole("button", { name: "Manage players" }).click();
  await expect(
    page.getByRole("button", { name: "Hold slot" }).first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Make cohost" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Remove cohost" })).toHaveCount(
    0,
  );
});

test("renders recruitment, tracks Discord layout, reconnects, and rejects stale snapshots", async ({
  page,
}) => {
  await mockBackend(page, snapshot());
  await page.goto("./");

  await expect(
    page.getByRole("heading", { name: "Test Guild Customs" }),
  ).toBeVisible();
  await expect(page.getByText("10 eligible · 0 more needed")).toBeVisible();
  await expect(page.getByText("6 viewing")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-scout-skin",
    "modern",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-scout-mode",
    "light",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-discord-layout",
    "grid",
  );

  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("scout-test-close-sockets")),
  );
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__testSocketCount")))
    .toBeGreaterThan(1);

  await page.evaluate(
    (next) => {
      window.dispatchEvent(
        new CustomEvent("scout-test-snapshot", { detail: next }),
      );
    },
    snapshot({ revision: 2, guildName: "Stale Guild" }),
  );
  await expect(page.getByText("Stale Guild Customs")).toHaveCount(0);

  await page.evaluate(
    (next) => {
      window.dispatchEvent(
        new CustomEvent("scout-test-snapshot", { detail: next }),
      );
    },
    snapshot({ revision: 4, guildName: "Updated Guild" }),
  );
  await expect(
    page.getByRole("heading", { name: "Updated Guild Customs" }),
  ).toBeVisible();

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("scout-test-layout", { detail: 1 }));
  });
  await expect(page.locator("html")).toHaveAttribute(
    "data-discord-layout",
    "pip",
  );
  await expect(
    page.getByRole("button", { name: "Choose Scout theme" }),
  ).toBeHidden();
});

test("persists the shared Scout theme and follows system appearance", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await mockBackend(page, snapshot());
  await page.goto("./");

  await expect(page.locator("html")).toHaveAttribute("data-scout-mode", "dark");
  await page.getByRole("button", { name: "Choose Scout theme" }).click();
  await expect(
    page.locator("#activity-overlay-root").getByText("Appearance"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Classic" }).click();
  await page.getByRole("button", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-scout-skin",
    "classic",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-scout-mode",
    "light",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute(
    "data-scout-skin",
    "classic",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-scout-mode",
    "light",
  );

  await page.getByRole("button", { name: "Choose Scout theme" }).click();
  await page.getByRole("button", { name: "System" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-scout-mode", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute(
    "data-scout-mode",
    "light",
  );
});

test("lets only the active captain make the next accessible draft pick", async ({
  page,
}) => {
  const initialGame = game();
  const pickedGame: CustomGameSnapshot = {
    ...initialGame,
    activeCaptain: "B",
    participants: initialGame.participants.map((participant) =>
      participant.discordId === "3"
        ? { ...participant, team: "A", side: "BLUE", pickOrder: 1 }
        : participant,
    ),
  };
  await mockBackend(
    page,
    snapshot({ state: "DRAFTING", currentGame: initialGame }),
    snapshot({ revision: 4, state: "DRAFTING", currentGame: pickedGame }),
  );
  await page.goto("./");

  await expect(page.getByText("Your pick—choose a player")).toBeVisible();
  await page.getByRole("button", { name: "Player 3" }).click();
  await expect(page.getByText("Waiting for Player 2 to pick")).toBeVisible();
  await expect(page.getByText("Pick 1")).toBeVisible();
});

test("offers substitutions when retained teams await locking", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const retainedGame = game();
  retainedGame.state = "CAPTAINS_SET";
  retainedGame.activeCaptain = null;
  retainedGame.participants = retainedGame.participants.map(
    (participant, index) => ({
      ...participant,
      team: index < 5 ? "A" : "B",
      side: index < 5 ? "BLUE" : "RED",
      captain: index === 0 || index === 5,
    }),
  );
  await mockBackend(
    page,
    snapshot({ state: "PREPARING", currentGame: retainedGame }),
  );
  await page.goto("./");

  await expect(
    page.getByRole("button", { name: "Substitute player" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Choose Scout theme" }).click();
  await page.getByRole("button", { name: "Classic" }).click();
  await page.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-scout-skin",
    "classic",
  );
  await expect(page.locator("html")).toHaveAttribute("data-scout-mode", "dark");
  await page.getByRole("button", { name: "Substitute player" }).click();
  const substitutionDialog = page
    .locator("#activity-overlay-root")
    .getByRole("dialog", { name: "Roster substitution" });
  await expect(substitutionDialog).toBeVisible();
  await expect(substitutionDialog).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Substitute player" }),
  ).toBeFocused();
});

const visualThemes = [
  { skin: "modern", mode: "light" },
  { skin: "modern", mode: "dark" },
  { skin: "classic", mode: "light" },
  { skin: "classic", mode: "dark" },
] as const;
const visualLayouts = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;
const visualStates = ["recruiting", "drafting"] as const;

for (const theme of visualThemes) {
  for (const layout of visualLayouts) {
    for (const visualState of visualStates) {
      test(`visual ${visualState} in ${theme.skin} ${theme.mode} on ${layout.name}`, async ({
        page,
      }) => {
        await page.setViewportSize({
          width: layout.width,
          height: layout.height,
        });
        await page.addInitScript((preference) => {
          localStorage.setItem(
            "scout-theme-v1",
            JSON.stringify({ version: 1, ...preference }),
          );
        }, theme);
        await mockBackend(
          page,
          visualState === "drafting"
            ? snapshot({ state: "DRAFTING", currentGame: game() })
            : snapshot(),
        );
        await page.goto("./");
        await expect(
          page.getByRole("heading", { name: "Test Guild Customs" }),
        ).toBeVisible();
        if (visualState === "drafting") {
          await expect(
            page.getByText("Your pick—choose a player"),
          ).toBeVisible();
        }
        await expect(page).toHaveScreenshot(
          `customs-${visualState}-${theme.skin}-${theme.mode}-${layout.name}.png`,
          { animations: "disabled", fullPage: true },
        );
      });
    }
  }
}

import { describe, expect, test } from "vitest";
import { inferMediaIntent } from "@shepherdjerred/streambot/discovery/media-intent.ts";
import { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import { CommandHandler } from "@shepherdjerred/streambot/discord/commands/command-handler.ts";
import type {
  CommandHandlerDeps,
  CommandInteraction,
} from "@shepherdjerred/streambot/discord/commands/command-types.ts";
import type { PlaybackView } from "@shepherdjerred/streambot/machine/view.ts";
import type {
  PlaybackEvent,
  ResolvedSource,
} from "@shepherdjerred/streambot/machine/types.ts";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import {
  UserIdSchema,
  type UserId,
} from "@shepherdjerred/streambot/types/ids.ts";
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";

const USER = UserIdSchema.parse("100000000000000001");
const GUILD = "208425771172102144";
const CHANNEL = "692223827475824650";

const EMPTY_VIEW: PlaybackView = {
  state: "idle",
  current: null,
  queue: [],
  loop: "off",
  volume: 100,
  positionSeconds: null,
};

const RESOLVED_STUB: ResolvedSource = {
  title: "resolved",
  ffmpegInput: "resolved://input",
  mediaKind: "video",
  chapters: [],
};

let nextTimestampMs = 1000;

function recordLocalPlay(
  history: MediaHistoryStore,
  entry: LibraryEntry,
  userId: UserId = USER,
): void {
  const nowMs = nextTimestampMs;
  nextTimestampMs += 1000;
  const scope = { guildId: GUILD, channelId: CHANNEL, userId };
  const media = {
    title: entry.title,
    provider: "local" as const,
    source: { kind: "file" as const, path: entry.path, title: entry.title },
  };
  const requestId = history.recordQueueRequest({
    scope,
    rawQuery: entry.title,
    intent: inferMediaIntent({ query: entry.title }),
    media,
    nowMs,
  });
  history.recordPlaybackStart({ requestId, scope, media, nowMs });
}

function makePersonalHarness(
  library: readonly LibraryEntry[],
  history: MediaHistoryStore,
): {
  readonly runContinue: () => Promise<readonly string[]>;
  readonly events: readonly PlaybackEvent[];
} {
  const events: PlaybackEvent[] = [];
  let subtitleMenuPending = false;
  const deps: CommandHandlerDeps = {
    config: loadConfig({
      BOT_TOKEN: "bot-token",
      TOKEN: "user-token",
      GUILD_ID: GUILD,
      COMMAND_CHANNEL_ID: CHANNEL,
      VIDEO_CHANNEL_ID: CHANNEL,
      ADMIN_IDS: "",
      VIDEOS_DIR: "/tmp/videos",
    }),
    dispatch: (event) => {
      events.push(event);
    },
    view: () => EMPTY_VIEW,
    library: () => library,
    setVolume: () => Promise.resolve(true),
    seek: () => Promise.resolve(true),
    expandPlaylist: () => Promise.resolve([]),
    listSources: () => Promise.resolve([]),
    resolvePlaySource: () => Promise.resolve(RESOLVED_STUB),
    announce: () => Promise.resolve(),
    listSubtitleCandidates: () => Promise.resolve([]),
    currentSourceId: () => null,
    hasPendingSubtitleMenu: () => subtitleMenuPending,
    claimSubtitleMenu: () => {
      subtitleMenuPending = true;
      return true;
    },
    releaseSubtitleMenu: () => {
      subtitleMenuPending = false;
    },
    startVoiceDebugCapture: () => ({ outcome: "disabled" }),
    stopVoiceDebugCapture: () => ({ outcome: "none" }),
    voiceDebugCaptureStatus: () => null,
    guildId: GUILD,
    channelId: CHANNEL,
    history,
  };
  const handler = new CommandHandler(deps);

  return {
    events,
    runContinue: async () => {
      const replies: string[] = [];
      const interaction: CommandInteraction = {
        userId: USER,
        subcommand: () => "continue",
        subcommandGroup: () => "personal",
        getString: () => null,
        getInteger: () => null,
        getStringRequired: (name) => {
          throw new Error(`Unexpected getStringRequired(${name})`);
        },
        getIntegerRequired: (name) => {
          throw new Error(`Unexpected getIntegerRequired(${name})`);
        },
        reply: (content) => {
          replies.push(content);
          return Promise.resolve();
        },
        defer: () => Promise.resolve(),
        editReply: (content) => {
          replies.push(content);
          return Promise.resolve();
        },
        replyPaginated: () => Promise.resolve(),
        replySelectMenu: () => Promise.resolve(null),
      };
      await handler.run(interaction);
      return replies;
    },
  };
}

describe("MediaCommandHandler /stream personal continue", () => {
  const bearS01E07: LibraryEntry = {
    title: "The Bear - S01E07",
    path: "/media/tv/The Bear/Season 01/The Bear - S01E07.mkv",
    relativePath: "The Bear/Season 01/The Bear - S01E07.mkv",
    library: "tv",
    series: "The Bear",
    season: 1,
    episode: 7,
  };
  const bearS01E08: LibraryEntry = {
    title: "The Bear - S01E08",
    path: "/media/tv/The Bear/Season 01/The Bear - S01E08.mkv",
    relativePath: "The Bear/Season 01/The Bear - S01E08.mkv",
    library: "tv",
    series: "The Bear",
    season: 1,
    episode: 8,
  };
  const bearS02E01: LibraryEntry = {
    title: "The Bear - S02E01",
    path: "/media/tv/The Bear/Season 02/The Bear - S02E01.mkv",
    relativePath: "The Bear/Season 02/The Bear - S02E01.mkv",
    library: "tv",
    series: "The Bear",
    season: 2,
    episode: 1,
  };
  const severanceS01E02: LibraryEntry = {
    title: "Severance (2022)",
    path: "/media/tv/Severance (2022)/Season 01/Severance_(2022)_S01E02_1080p.mkv",
    relativePath:
      "Severance (2022)/Season 01/Severance_(2022)_S01E02_1080p.mkv",
    library: "tv",
    year: 2022,
    series: "Severance (2022)",
    season: 1,
    episode: 2,
  };
  const severanceS01E03: LibraryEntry = {
    title: "Severance (2022) - S01E03",
    path: "/media/tv/Severance (2022)/Season 01/Severance_(2022)_S01E03_1080p.mkv",
    relativePath:
      "Severance (2022)/Season 01/Severance_(2022)_S01E03_1080p.mkv",
    library: "tv",
    year: 2022,
    series: "Severance (2022)",
    season: 1,
    episode: 3,
  };

  test("rolls over cleanly across season boundaries from S01E08 to S02E01", async () => {
    const history = new MediaHistoryStore(":memory:");
    try {
      recordLocalPlay(history, bearS01E08);
      const harness = makePersonalHarness(
        [bearS01E07, bearS01E08, bearS02E01],
        history,
      );
      const replies = await harness.runContinue();
      expect(replies).toEqual(["Queued next episode: **The Bear - S02E01**."]);
      expect(harness.events).toMatchObject([
        {
          type: "ADD",
          source: {
            kind: "file",
            path: bearS02E01.path,
            title: bearS02E01.title,
          },
          requesterId: USER,
        },
      ]);
    } finally {
      history.close();
    }
  });

  test("reports no next episode when at the series finale without rewinding to an older episode", async () => {
    const history = new MediaHistoryStore(":memory:");
    try {
      recordLocalPlay(history, bearS01E07);
      recordLocalPlay(history, bearS01E08);
      const harness = makePersonalHarness([bearS01E07, bearS01E08], history);
      const replies = await harness.runContinue();
      expect(replies).toEqual([
        "I could not find a next local episode in your recent history.",
      ]);
      expect(harness.events).toEqual([]);
    } finally {
      history.close();
    }
  });

  test("skips a finished series and advances another in-progress show via file path lookup", async () => {
    const history = new MediaHistoryStore(":memory:");
    try {
      recordLocalPlay(history, severanceS01E02);
      recordLocalPlay(history, bearS02E01);
      const harness = makePersonalHarness(
        [bearS01E08, bearS02E01, severanceS01E02, severanceS01E03],
        history,
      );
      const replies = await harness.runContinue();
      expect(replies).toEqual([
        "Queued next episode: **Severance (2022) - S01E03**.",
      ]);
      expect(harness.events).toMatchObject([
        {
          type: "ADD",
          source: {
            kind: "file",
            path: severanceS01E03.path,
            title: severanceS01E03.title,
          },
        },
      ]);
    } finally {
      history.close();
    }
  });
});

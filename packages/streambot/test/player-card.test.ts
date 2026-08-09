import { describe, expect, test } from "bun:test";
import {
  renderPlayerCard,
  renderProgressBar,
  type PlayerCardPayload,
} from "@shepherdjerred/streambot/discord/player-card.ts";
import {
  ControlAction,
  encodeControlId,
} from "@shepherdjerred/streambot/discord/player-controls.ts";
import type { PlaybackView } from "@shepherdjerred/streambot/discord/queue-text.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";

const REQUESTER = UserIdSchema.parse("100000000000000002");

const CHAPTERS = [
  { index: 1, title: "Intro", startSeconds: 0, endSeconds: 90 },
  { index: 2, title: "The Heist", startSeconds: 90, endSeconds: 600 },
];

function view(over: Partial<PlaybackView> = {}): PlaybackView {
  return {
    state: "streaming",
    current: {
      title: "Heat (1995)",
      requesterId: REQUESTER,
      chapters: CHAPTERS,
      kind: "file",
      durationSeconds: 600,
    },
    queue: [],
    loop: "off",
    volume: 100,
    positionSeconds: 300,
    ...over,
  };
}

function render(
  over: Partial<PlaybackView> = {},
  options: {
    posterUrl?: string | null;
    enabled?: boolean;
    finished?: boolean;
  } = {},
): PlayerCardPayload {
  return renderPlayerCard({
    view: view(over),
    posterUrl: options.posterUrl ?? null,
    enabled: options.enabled ?? true,
    finished: options.finished ?? false,
  });
}

/** Flatten every button id in the payload, in row order. */
function buttonIds(payload: PlayerCardPayload): string[] {
  return payload.rows.flatMap((row) => row.map((button) => button.id));
}

function findButton(payload: PlayerCardPayload, action: ControlAction) {
  const id = encodeControlId(action);
  return payload.rows.flat().find((button) => button.id === id);
}

describe("renderProgressBar", () => {
  test("puts the knob at the start, middle, and end", () => {
    expect(renderProgressBar(0, 100)).toBe(`●${"─".repeat(23)}`);
    expect(renderProgressBar(100, 100)).toBe(`${"━".repeat(23)}●`);
    const half = renderProgressBar(50, 100);
    expect(half).not.toBeNull();
    expect(half?.length).toBe(24);
    expect(half?.indexOf("●")).toBe(12);
  });

  test("clamps a position past the end rather than overflowing the bar", () => {
    expect(renderProgressBar(500, 100)).toBe(`${"━".repeat(23)}●`);
  });

  test("returns null when there is no usable duration or position", () => {
    expect(renderProgressBar(10, null)).toBeNull();
    expect(renderProgressBar(10, 0)).toBeNull();
    expect(renderProgressBar(null, 100)).toBeNull();
  });
});

describe("player card body", () => {
  test("shows the bar, both timecodes, the chapter, and the meta line", () => {
    const description = render().embed?.description ?? "";
    expect(description).toContain("`5:00 / 10:00`");
    expect(description).toContain("●");
    expect(description).toContain("📖 Chapter 2: The Heist");
    expect(description).toContain(`Requested by <@${REQUESTER}>`);
    expect(description).toContain("🔁 off");
    expect(description).toContain("🔊 100%");
  });

  test("titles the embed with the current track", () => {
    expect(render().embed?.title).toBe("▶️ Heat (1995)");
  });

  test("falls back to elapsed-only when the duration is unknown", () => {
    const description =
      render({
        current: {
          title: "Live Stream",
          requesterId: REQUESTER,
          chapters: [],
          kind: "url",
          durationSeconds: null,
        },
      }).embed?.description ?? "";
    expect(description).toContain("`5:00`");
    expect(description).not.toContain("●");
  });

  test("names the queue depth only when something is queued", () => {
    expect(render().embed?.description).not.toContain("in queue");
    const queued = render({
      queue: [
        {
          title: "Next Up",
          requesterId: REQUESTER,
          chapters: [],
          kind: "search",
          durationSeconds: null,
        },
      ],
    });
    expect(queued.embed?.description).toContain("1 in queue");
  });

  test("explains itself while joining or preparing instead of looking stalled", () => {
    expect(render({ state: "joining" }).embed?.description).toContain(
      "🔗 Joining the voice channel…",
    );
    expect(render({ state: "resolving" }).embed?.description).toContain(
      "⏳ Preparing the video…",
    );
  });

  test("hangs the poster off the side as a thumbnail, not a full-width image", () => {
    const payload = render({}, { posterUrl: "https://img/poster.jpg" });
    expect(payload.embed?.thumbnailUrl).toBe("https://img/poster.jpg");
    expect(payload.embed?.imageUrl).toBeNull();
  });
});

describe("player card controls", () => {
  test("renders both control rows", () => {
    const ids = buttonIds(render());
    expect(ids).toEqual([
      encodeControlId(ControlAction.Back),
      encodeControlId(ControlAction.Forward),
      encodeControlId(ControlAction.Skip),
      encodeControlId(ControlAction.Stop),
      encodeControlId(ControlAction.Loop),
      encodeControlId(ControlAction.VolumeDown),
      encodeControlId(ControlAction.VolumeUp),
      encodeControlId(ControlAction.Shuffle),
      encodeControlId(ControlAction.Queue),
      encodeControlId(ControlAction.Subtitles),
    ]);
  });

  test("the loop button reports the current mode", () => {
    expect(
      findButton(render({ loop: "queue" }), ControlAction.Loop)?.label,
    ).toBe("🔁 Loop: queue");
  });

  test("item controls are disabled while nothing is playing", () => {
    const waiting = render({
      state: "waiting",
      current: null,
      positionSeconds: null,
    });
    for (const action of [
      ControlAction.Back,
      ControlAction.Forward,
      ControlAction.Skip,
      ControlAction.Subtitles,
    ]) {
      expect(findButton(waiting, action)?.disabled).toBe(true);
    }
  });

  test("volume buttons disable at their bounds", () => {
    expect(
      findButton(render({ volume: 0 }), ControlAction.VolumeDown)?.disabled,
    ).toBe(true);
    expect(
      findButton(render({ volume: 0 }), ControlAction.VolumeUp)?.disabled,
    ).toBe(false);
    expect(
      findButton(render({ volume: 200 }), ControlAction.VolumeUp)?.disabled,
    ).toBe(true);
  });

  test("shuffle needs at least two queued items to do anything", () => {
    expect(findButton(render(), ControlAction.Shuffle)?.disabled).toBe(true);
  });
});

describe("chapter menu", () => {
  test("appears only when the current item has chapters", () => {
    expect(render().select?.options.map((option) => option.value)).toEqual([
      "1",
      "2",
    ]);
    const noChapters = render({
      current: {
        title: "Heat (1995)",
        requesterId: REQUESTER,
        chapters: [],
        kind: "file",
        durationSeconds: 600,
      },
    });
    expect(noChapters.select).toBeNull();
  });

  test("labels options with number, title, and start time", () => {
    const option = render().select?.options[1];
    expect(option).toEqual({
      label: "2. The Heist",
      value: "2",
      description: "1:30",
    });
  });

  test("truncates past Discord's 25-option cap and says so", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      index: index + 1,
      title: `Chapter ${String(index + 1)}`,
      startSeconds: index * 60,
      endSeconds: (index + 1) * 60,
    }));
    const payload = render({
      current: {
        title: "Long Movie",
        requesterId: REQUESTER,
        chapters: many,
        kind: "file",
        durationSeconds: 2400,
      },
    });
    expect(payload.select?.options).toHaveLength(25);
    expect(payload.select?.placeholder).toBe(
      "Jump to a chapter (first 25 of 40)",
    );
  });
});

describe("finished card", () => {
  test("drops every control and states the outcome", () => {
    const payload = render({}, { finished: true });
    expect(payload.rows).toEqual([]);
    expect(payload.select).toBeNull();
    expect(payload.embed?.description).toContain("⏹️ Stopped.");
    expect(payload.embed?.title).toBe("Heat (1995)");
  });
});

describe("card disabled by config", () => {
  test("renders the plain now-playing announcement with no components", () => {
    const payload = render({}, { enabled: false });
    expect(payload).toEqual({
      content: `▶️ Now playing **Heat (1995)** (requested by <@${REQUESTER}>)`,
      embed: null,
      rows: [],
      select: null,
    });
  });

  test("keeps the poster as a full-width embed image, as it was before the card", () => {
    const payload = render(
      {},
      { enabled: false, posterUrl: "https://img/poster.jpg" },
    );
    expect(payload.embed).toEqual({
      title: "Heat (1995)",
      description: null,
      imageUrl: "https://img/poster.jpg",
      thumbnailUrl: null,
    });
  });
});

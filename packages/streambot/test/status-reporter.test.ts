import { describe, expect, test } from "bun:test";
import {
  StatusReporter,
  type StatusSnapshot,
} from "@shepherdjerred/streambot/discord/status-reporter.ts";
import type { CrashNotice } from "@shepherdjerred/streambot/machine/types.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";

const REQUESTER = UserIdSchema.parse("100000000000000001");

function collector(): {
  reporter: StatusReporter;
  messages: string[];
  /** Fire the pending "preparing…" notice timer (the injected scheduler defers it deterministically). */
  fireNotice: () => void;
} {
  const messages: string[] = [];
  let pending: (() => void) | null = null;
  const reporter = new StatusReporter(
    (message) => {
      messages.push(message);
      return Promise.resolve();
    },
    {
      schedule: (fn) => {
        pending = fn;
        return () => {
          if (pending === fn) {
            pending = null;
          }
        };
      },
    },
  );
  return {
    reporter,
    messages,
    fireNotice: () => {
      const fn = pending;
      pending = null;
      fn?.();
    },
  };
}

function streaming(
  title: string,
  kind: StatusSnapshot["currentKind"] = "search",
): StatusSnapshot {
  return {
    state: "streaming",
    currentKind: kind,
    currentSourceLabel: title,
    blockedNonce: 0,
    blockedRequester: null,
    lastError: null,
    crashNotice: null,
  };
}

function resolving(
  label: string,
  kind: StatusSnapshot["currentKind"] = "file",
): StatusSnapshot {
  return {
    state: "resolving",
    currentKind: kind,
    currentSourceLabel: label,
    blockedNonce: 0,
    blockedRequester: null,
    lastError: null,
    crashNotice: null,
  };
}

describe("StatusReporter scope", () => {
  test("does not announce now playing — that is the player card's job", () => {
    const { reporter, messages } = collector();
    reporter.handle(streaming("Song A"));
    reporter.handle(streaming("Song A"));
    reporter.handle(streaming("Song B"));
    expect(messages).toEqual([]);
  });
});

describe("StatusReporter preparing notice", () => {
  test("posts a preparing notice when a local file resolves slowly", () => {
    const { reporter, messages, fireNotice } = collector();
    reporter.handle(resolving("Avengers - Endgame (2019)"));
    // Nothing is posted until the delay elapses.
    expect(messages).toHaveLength(0);
    fireNotice();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toBe(
      "⏳ Preparing **Avengers - Endgame (2019)** — extracting subtitles from a large file, " +
        "which can take up to a minute. Playback will start automatically when it's ready.",
    );
  });

  test("cancels the notice when resolving finishes before the delay", () => {
    const { reporter, messages, fireNotice } = collector();
    reporter.handle(resolving("Song A", "file"));
    // Stream starts before the notice timer fires → the notice is cancelled.
    reporter.handle(streaming("Song A", "file"));
    fireNotice();
    expect(messages).toEqual([]);
  });

  test("does not post a preparing notice for non-file (yt-dlp) sources", () => {
    const { reporter, messages, fireNotice } = collector();
    reporter.handle(resolving("https://youtu.be/abc", "url"));
    fireNotice();
    expect(messages).toHaveLength(0);
  });

  test("de-dupes the notice across re-rendered resolving snapshots", () => {
    const { reporter, messages, fireNotice } = collector();
    reporter.handle(resolving("Song A"));
    reporter.handle(resolving("Song A"));
    reporter.handle(resolving("Song A"));
    fireNotice();
    expect(messages).toHaveLength(1);
  });
});

describe("StatusReporter blocked shaming", () => {
  test("shames once when the blocked nonce advances with a requester", () => {
    const { reporter, messages } = collector();
    reporter.handle({
      state: "idle",
      currentKind: null,
      currentSourceLabel: null,
      blockedNonce: 1,
      blockedRequester: REQUESTER,
      lastError: null,
      crashNotice: null,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(`<@${REQUESTER}>`);
  });

  test("does not re-shame while the nonce is unchanged", () => {
    const { reporter, messages } = collector();
    const blocked: StatusSnapshot = {
      state: "idle",
      currentKind: null,
      currentSourceLabel: null,
      blockedNonce: 1,
      blockedRequester: REQUESTER,
      lastError: null,
      crashNotice: null,
    };
    reporter.handle(blocked);
    reporter.handle(blocked);
    expect(messages).toHaveLength(1);
  });

  test("respects the initial nonce so a resume doesn't re-shame", () => {
    const messages: string[] = [];
    const reporter = new StatusReporter(
      (message) => {
        messages.push(message);
        return Promise.resolve();
      },
      { initialNonce: 1 },
    );
    reporter.handle({
      state: "idle",
      currentKind: null,
      currentSourceLabel: null,
      blockedNonce: 1,
      blockedRequester: REQUESTER,
      lastError: null,
      crashNotice: null,
    });
    expect(messages).toHaveLength(0);
  });
});

function idleWith(lastError: string | null): StatusSnapshot {
  return {
    state: "idle",
    currentKind: null,
    currentSourceLabel: null,
    blockedNonce: 0,
    blockedRequester: null,
    lastError,
    crashNotice: null,
  };
}

describe("StatusReporter stop reasons", () => {
  test("announces the reason once on the active→idle edge", () => {
    const { reporter, messages } = collector();
    reporter.handle(streaming("Song A"));
    reporter.handle(idleWith("voice connection dropped (close code 4006)"));
    reporter.handle(idleWith("voice connection dropped (close code 4006)"));
    const stops = messages.filter((m) => m.includes("Stream stopped"));
    expect(stops).toEqual([
      "⏹️ Stream stopped: voice connection dropped (close code 4006)",
    ]);
  });

  test("stays silent on a natural end (no lastError)", () => {
    const { reporter, messages } = collector();
    reporter.handle(streaming("Song A"));
    reporter.handle(idleWith(null));
    expect(messages.some((m) => m.includes("Stream stopped"))).toBe(false);
  });

  test("does not announce for an idle-timeout leave (waiting→idle)", () => {
    const { reporter, messages } = collector();
    reporter.handle(streaming("Song A"));
    reporter.handle({ ...idleWith("stale error"), state: "waiting" });
    reporter.handle(idleWith("stale error"));
    expect(messages.some((m) => m.includes("Stream stopped"))).toBe(false);
  });

  test("a fresh session announcing a new stop reason is not deduped", () => {
    const { reporter, messages } = collector();
    reporter.handle(streaming("Song A"));
    reporter.handle(idleWith("voice connection dropped (close code 4006)"));
    reporter.handle(streaming("Song B"));
    reporter.handle(idleWith("voice connection dropped (close code 4014)"));
    const stops = messages.filter((m) => m.includes("Stream stopped"));
    expect(stops).toHaveLength(2);
  });
});

function crashNotice(over: Partial<CrashNotice> = {}): CrashNotice {
  return {
    nonce: 1,
    kind: "retry",
    reason: "crash",
    title: "Spider-Man 3 (2007)",
    positionSeconds: 2,
    attempt: 1,
    maxAttempts: 3,
    pipelineMode: "hw",
    ...over,
  };
}

describe("StatusReporter crash notices", () => {
  test("announces a retry with position, attempt, and pipeline", () => {
    const { reporter, messages } = collector();
    reporter.handle({
      ...streaming("Spider-Man 3 (2007)"),
      crashNotice: crashNotice(),
    });
    expect(messages.filter((m) => m.startsWith("⚠️"))).toEqual([
      "⚠️ **Spider-Man 3 (2007)** crashed at 0:02 — retrying from there (attempt 1/3, hardware)…",
    ]);
  });

  test("dedupes by nonce across re-rendered snapshots, announces new nonces", () => {
    const { reporter, messages } = collector();
    const first = {
      ...streaming("Movie"),
      crashNotice: crashNotice({ title: "Movie" }),
    };
    reporter.handle(first);
    reporter.handle(first);
    reporter.handle({
      ...streaming("Movie"),
      crashNotice: crashNotice({
        title: "Movie",
        nonce: 2,
        attempt: 2,
        reason: "stall",
        positionSeconds: 3671,
      }),
    });
    const warnings = messages.filter((m) => m.startsWith("⚠️"));
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toContain("stalled at 1:01:11");
    expect(warnings[1]).toContain("attempt 2/3");
  });

  test("announces the give-up with the last position and reason", () => {
    const { reporter, messages } = collector();
    reporter.handle({
      ...streaming("Movie"),
      crashNotice: crashNotice({
        title: "Movie",
        kind: "gave-up",
        reason: "ended-short",
        positionSeconds: 40,
        attempt: 3,
      }),
    });
    expect(messages.filter((m) => m.startsWith("🛑"))).toEqual([
      "🛑 Gave up on **Movie** after 3 retries (last ended early at 0:40). Skipping it.",
    ]);
  });

  test("software retry announces as software", () => {
    const { reporter, messages } = collector();
    reporter.handle({
      ...streaming("Movie"),
      crashNotice: crashNotice({
        title: "Movie",
        attempt: 3,
        pipelineMode: "sw",
      }),
    });
    const warnings = messages.filter((m) => m.startsWith("⚠️"));
    expect(warnings.at(-1)).toContain("attempt 3/3, software");
  });
});

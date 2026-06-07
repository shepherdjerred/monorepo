import { describe, expect, test } from "bun:test";
import {
  StatusReporter,
  type StatusSnapshot,
} from "@shepherdjerred/streambot/discord/status-reporter.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";

const REQUESTER = UserIdSchema.parse("100000000000000001");

function collector(): {
  reporter: StatusReporter;
  messages: string[];
} {
  const messages: string[] = [];
  const reporter = new StatusReporter((message) => {
    messages.push(message);
    return Promise.resolve();
  });
  return { reporter, messages };
}

function streaming(title: string): StatusSnapshot {
  return {
    state: "streaming",
    currentTitle: title,
    currentRequester: REQUESTER,
    blockedNonce: 0,
    blockedRequester: null,
  };
}

describe("StatusReporter now-playing", () => {
  test("announces once when a stream starts, with the requester", () => {
    const { reporter, messages } = collector();
    reporter.handle(streaming("Song A"));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toBe(
      `▶️ Now playing **Song A** (requested by <@${REQUESTER}>)`,
    );
  });

  test("de-dupes repeated identical snapshots", () => {
    const { reporter, messages } = collector();
    reporter.handle(streaming("Song A"));
    reporter.handle(streaming("Song A"));
    reporter.handle(streaming("Song A"));
    expect(messages).toHaveLength(1);
  });

  test("re-announces a track that plays again after an idle gap", () => {
    const { reporter, messages } = collector();
    reporter.handle(streaming("Song A"));
    reporter.handle({
      state: "idle",
      currentTitle: null,
      currentRequester: null,
      blockedNonce: 0,
      blockedRequester: null,
    });
    reporter.handle(streaming("Song A"));
    expect(messages).toHaveLength(2);
  });

  test("does not announce when not streaming", () => {
    const { reporter, messages } = collector();
    reporter.handle({
      state: "resolving",
      currentTitle: "Song A",
      currentRequester: REQUESTER,
      blockedNonce: 0,
      blockedRequester: null,
    });
    expect(messages).toHaveLength(0);
  });
});

describe("StatusReporter blocked shaming", () => {
  test("shames once when the blocked nonce advances with a requester", () => {
    const { reporter, messages } = collector();
    reporter.handle({
      state: "idle",
      currentTitle: null,
      currentRequester: null,
      blockedNonce: 1,
      blockedRequester: REQUESTER,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(`<@${REQUESTER}>`);
  });

  test("does not re-shame while the nonce is unchanged", () => {
    const { reporter, messages } = collector();
    const blocked: StatusSnapshot = {
      state: "idle",
      currentTitle: null,
      currentRequester: null,
      blockedNonce: 1,
      blockedRequester: REQUESTER,
    };
    reporter.handle(blocked);
    reporter.handle(blocked);
    expect(messages).toHaveLength(1);
  });

  test("respects the initial nonce so a resume doesn't re-shame", () => {
    const messages: string[] = [];
    const reporter = new StatusReporter((message) => {
      messages.push(message);
      return Promise.resolve();
    }, 1);
    reporter.handle({
      state: "idle",
      currentTitle: null,
      currentRequester: null,
      blockedNonce: 1,
      blockedRequester: REQUESTER,
    });
    expect(messages).toHaveLength(0);
  });
});

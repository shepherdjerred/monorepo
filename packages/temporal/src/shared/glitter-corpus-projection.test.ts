import { describe, expect, test } from "bun:test";
import {
  CorpusObservationSchema,
  type CorpusObservation,
} from "./glitter-corpus.ts";
import {
  buildCurrentProjection,
  mergeCurrentProjection,
  projectionChecksum,
  selectCurrentObservation,
  serializeProjection,
} from "./glitter-corpus-projection.ts";

function observation(input: {
  source?: "seed" | "discord-rest";
  sourceKey: string;
  messageId?: string;
  content: string;
  editedTimestamp?: string | null;
  observedAt?: string;
  guildId?: string | null;
  pinned?: boolean;
}): CorpusObservation {
  return CorpusObservationSchema.parse({
    schemaVersion: 1,
    source: input.source ?? "discord-rest",
    sourceKey: input.sourceKey,
    observedAt: input.observedAt ?? "2026-07-26T00:00:00.000Z",
    guildId: input.guildId ?? "123",
    guildSlug: "glitter-boys",
    channelId: "456",
    messageId: input.messageId ?? "789",
    author: {
      id: "111",
      username: "person",
      globalName: "Person",
      discriminator: "0",
      bot: false,
      avatar: null,
    },
    content: input.content,
    timestamp: "2025-01-01T00:00:00.000Z",
    editedTimestamp: input.editedTimestamp ?? null,
    type: 0,
    flags: "0",
    pinned: input.pinned ?? false,
    tts: false,
    attachments: [],
    referencedMessageId: null,
    raw: { sourceKey: input.sourceKey },
  });
}

describe("Glitter corpus current projection", () => {
  test("newest edited timestamp wins independent of observation order", () => {
    const original = observation({
      sourceKey: "page/original",
      content: "before",
    });
    const edited = observation({
      sourceKey: "page/edited",
      content: "after",
      editedTimestamp: "2025-02-01T00:00:00.000Z",
    });

    expect(selectCurrentObservation([edited, original]).content).toBe("after");
    expect(selectCurrentObservation([original, edited]).content).toBe("after");
  });

  test("Discord observation enriches an equivalent trusted seed row", () => {
    const seed = observation({
      source: "seed",
      sourceKey: "seed/row",
      content: "same",
      guildId: null,
    });
    const discord = observation({
      source: "discord-rest",
      sourceKey: "discord/page",
      content: "same",
      guildId: "123",
    });

    const selected = selectCurrentObservation([seed, discord]);
    expect(selected.source).toBe("discord-rest");
    expect(selected.guildId).toBe("123");
  });

  test("same message version with different content fails loudly", () => {
    expect(() =>
      selectCurrentObservation([
        observation({ sourceKey: "page/a", content: "a" }),
        observation({ sourceKey: "page/b", content: "b" }),
      ]),
    ).toThrow("conflicting payloads");
  });

  test("a later observation captures pin changes without an edit timestamp", () => {
    const first = observation({
      source: "discord-rest",
      sourceKey: "page-1",
      content: "same",
      observedAt: "2026-01-01T00:00:00.000Z",
      pinned: false,
    });
    const later = observation({
      source: "discord-rest",
      sourceKey: "page-2",
      content: "same",
      observedAt: "2026-01-02T00:00:00.000Z",
      pinned: true,
    });

    expect(buildCurrentProjection([later, first])[0]?.pinned).toBe(true);
    expect(
      mergeCurrentProjection(buildCurrentProjection([first]), [later])[0]
        ?.pinned,
    ).toBe(true);
  });

  test("daily merge retains captured messages absent from the overlap", () => {
    const baseline = buildCurrentProjection([
      observation({
        sourceKey: "page/old",
        messageId: "100",
        content: "captured before deletion",
      }),
      observation({
        sourceKey: "page/current",
        messageId: "200",
        content: "before edit",
      }),
    ]);
    const merged = mergeCurrentProjection(baseline, [
      observation({
        sourceKey: "page/overlap",
        messageId: "200",
        content: "after edit",
        editedTimestamp: "2025-02-01T00:00:00.000Z",
      }),
    ]);

    expect(merged.map((message) => message.messageId)).toEqual(["100", "200"]);
    expect(merged[0]?.content).toBe("captured before deletion");
    expect(merged[1]?.content).toBe("after edit");
  });

  test("serialization and checksum are independent of input ordering", () => {
    const first = buildCurrentProjection([
      observation({
        sourceKey: "page/2",
        messageId: "20",
        content: "twenty",
      }),
      observation({
        sourceKey: "page/1",
        messageId: "10",
        content: "ten",
      }),
    ]);
    const second = first.toReversed();
    expect(serializeProjection(first)).toBe(serializeProjection(second));
    expect(projectionChecksum(first)).toBe(projectionChecksum(second));
  });
});

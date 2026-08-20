import { describe, expect, test } from "bun:test";
import {
  dialogueFirstExcerpt,
  messageMatchesQuery,
  selectShowMessages,
} from "#lib/history/context.ts";
import { dialogueText, toolOutputText } from "#lib/history/messages.ts";
import {
  collectHistoryResults,
  prepareResults,
  sourceWarnings,
} from "#lib/history/results.ts";
import {
  renderHistoryRecords,
  renderHistoryShow,
} from "#lib/history/render.ts";
import type {
  HistoryMessage,
  HistorySourceName,
  IndexedHistoryRecord,
} from "#lib/history/types.ts";

function record(
  id: number,
  values: {
    readonly source?: HistorySourceName;
    readonly createdAt?: string;
    readonly runtimeId?: string;
    readonly promptHash?: string | null;
  } = {},
): IndexedHistoryRecord {
  const source = values.source ?? "conductor";
  const createdAt = values.createdAt ?? "2026-08-18T00:00:00.000Z";
  return {
    id,
    source,
    sourceId: `${source}-${String(id)}`,
    title: `Session ${String(id)}`,
    path: `/fixture/${String(id)}`,
    workspace: "/fixture",
    agent: "fixture",
    createdAt,
    updatedAt: createdAt,
    excerpt: null,
    runtimeId: values.runtimeId ?? `${source}-${String(id)}`,
    openingPromptHash: values.promptHash ?? null,
  };
}

describe("history result filtering and grouping", () => {
  test("excludes the current runtime unless requested", () => {
    const records = [
      record(1, { runtimeId: "current" }),
      record(2, { source: "codex", runtimeId: "current" }),
    ];
    const hidden = prepareResults(records, {
      includeCurrent: false,
      includeDuplicates: false,
      currentRuntimes: [{ source: "conductor", runtimeId: "current" }],
      limit: 20,
    });
    expect(hidden.map((entry) => entry.id)).toEqual([2]);
    const included = prepareResults(records, {
      includeCurrent: true,
      includeDuplicates: false,
      currentRuntimes: [{ source: "conductor", runtimeId: "current" }],
      limit: 20,
    });
    expect(included.map((entry) => entry.id)).toEqual([1, 2]);
  });

  test("groups cross-source prompts in earliest-anchored 30-minute clusters", () => {
    const records = [
      record(2, {
        source: "codex",
        promptHash: "same",
        createdAt: "2026-08-18T00:20:00.000Z",
      }),
      record(1, {
        promptHash: "same",
        createdAt: "2026-08-18T00:00:00.000Z",
      }),
      record(3, {
        source: "claude",
        promptHash: "same",
        createdAt: "2026-08-18T00:40:00.000Z",
      }),
    ];
    const grouped = prepareResults(records, {
      includeCurrent: true,
      includeDuplicates: false,
      currentRuntimes: [],
      limit: 20,
    });
    expect(grouped).toHaveLength(2);
    expect(grouped[0]?.id).toBe(2);
    expect(grouped[0]?.members.map((member) => member.id)).toEqual([2, 1]);
    expect(grouped[1]?.members.map((member) => member.id)).toEqual([3]);
  });

  test("applies limit after grouping and can return duplicates individually", () => {
    const records = [
      record(1, { promptHash: "same" }),
      record(2, { promptHash: "same" }),
      record(3),
    ];
    const grouped = prepareResults(records, {
      includeCurrent: true,
      includeDuplicates: false,
      currentRuntimes: [],
      limit: 2,
    });
    expect(grouped.map((entry) => entry.id)).toEqual([1, 3]);
    expect(grouped[0]?.members).toHaveLength(2);

    const duplicates = prepareResults(records, {
      includeCurrent: true,
      includeDuplicates: true,
      currentRuntimes: [],
      limit: 2,
    });
    expect(duplicates.map((entry) => entry.id)).toEqual([1, 2]);
    expect(duplicates.every((entry) => entry.members.length === 1)).toBe(true);
  });

  test("reads bounded pages until the post-grouping limit is satisfied", () => {
    const duplicates = Array.from({ length: 200 }, (_, index) =>
      record(index + 1, { promptHash: "same" }),
    );
    const ranked = [...duplicates, record(201)];
    const requestedPageLimits: number[] = [];
    const grouped = collectHistoryResults(
      (offset, limit) => {
        requestedPageLimits.push(limit);
        return ranked.slice(offset, offset + limit);
      },
      (promptHash) =>
        ranked.filter((entry) => entry.openingPromptHash === promptHash),
      {
        includeCurrent: true,
        includeDuplicates: false,
        currentRuntimes: [],
        limit: 2,
      },
    );

    expect(requestedPageLimits).toEqual([128, 128]);
    expect(grouped.map((entry) => entry.id)).toEqual([1, 201]);
    expect(grouped[0]?.members).toHaveLength(200);
  });

  test("includes non-matching prompt siblings while preserving the ranked representative", () => {
    const matching = record(2, {
      source: "codex",
      promptHash: "same",
      createdAt: "2026-08-18T00:10:00.000Z",
    });
    const nonMatching = record(1, {
      promptHash: "same",
      createdAt: "2026-08-18T00:00:00.000Z",
    });
    const grouped = collectHistoryResults(
      () => [matching],
      () => [nonMatching, matching],
      {
        includeCurrent: true,
        includeDuplicates: false,
        currentRuntimes: [],
        limit: 1,
      },
    );

    expect(grouped[0]?.id).toBe(2);
    expect(grouped[0]?.members.map((member) => member.id)).toEqual([2, 1]);
  });

  test("warns on source errors and explicit unavailable sources", () => {
    const statuses = [
      {
        source: "cursor" as const,
        label: "Cursor",
        available: false,
        indexedDocuments: 0,
        lastScanAt: null,
        error: "unable to open fixture",
      },
      {
        source: "claude" as const,
        label: "Claude Code",
        available: false,
        indexedDocuments: 0,
        lastScanAt: null,
        error: null,
      },
    ];
    expect(sourceWarnings(statuses, null)).toEqual([
      { source: "cursor", message: "unable to open fixture" },
    ]);
    expect(sourceWarnings(statuses, "claude")).toEqual([
      { source: "cursor", message: "unable to open fixture" },
      {
        source: "claude",
        message:
          "Claude Code is not installed or its history store is unavailable.",
      },
    ]);
  });
});

function message(role: HistoryMessage["role"], text: string): HistoryMessage {
  return { role, text, createdAt: null };
}

describe("bounded history context", () => {
  test("strips terminal control sequences only from human rendering", () => {
    const unsafe = "before\u{1B}]52;c;payload\u{7}after\u{1B}[31mred\u{1B}[0m";
    const historyRecord = record(1);
    const shown = renderHistoryShow(
      { ...historyRecord, title: unsafe, path: unsafe },
      [message("assistant", unsafe)],
      false,
    );
    const listed = renderHistoryRecords("History", [
      {
        ...historyRecord,
        title: unsafe,
        path: unsafe,
        excerpt: unsafe,
        members: [],
      },
    ]);

    expect(shown).toContain("beforeafterred");
    expect(listed).toContain("beforeafterred");
    expect(`${shown}${listed}`).not.toContain("\u{1B}");
    expect(`${shown}${listed}`).not.toContain("\u{7}");
    expect(unsafe).toContain("\u{1B}]52");
  });

  test("bounds indexed dialogue and low-weight tool payloads", () => {
    const messages = [
      message("assistant", "d".repeat(300_000)),
      message("tool", "t".repeat(100_000)),
    ];
    expect(dialogueText(messages).length).toBeLessThanOrEqual(64_000);
    expect(toolOutputText(messages).length).toBeLessThanOrEqual(2000);
  });

  test("centers query context and admits only matching tools by default", () => {
    const messages = [
      message("user", "Opening request"),
      message("assistant", "Unrelated setup"),
      message("tool", "tool output unrelated"),
      message("assistant", "Bryan Bucks model analysis"),
      message("tool", "Bryan Bucks calibration output"),
      message("tool", "credentials output unrelated"),
      message("assistant", "Final answer"),
    ];
    const selected = selectShowMessages(messages, {
      query: '"Bryan Bucks"',
      messageLimit: 4,
      includeTools: false,
    });
    expect(selected.messages.map((entry) => entry.text)).toContain(
      "Bryan Bucks model analysis",
    );
    expect(selected.messages.map((entry) => entry.text)).toContain(
      "Bryan Bucks calibration output",
    );
    expect(selected.messages.map((entry) => entry.text)).not.toContain(
      "credentials output unrelated",
    );

    const withTools = selectShowMessages(messages, {
      query: '"Bryan Bucks"',
      messageLimit: 7,
      includeTools: true,
    });
    expect(withTools.messages.map((entry) => entry.text)).toContain(
      "credentials output unrelated",
    );
  });

  test("centers on a matching tool when dialogue does not match", () => {
    const messages = [
      ...Array.from({ length: 10 }, (_, index) =>
        message("assistant", `Unrelated dialogue ${String(index)}`),
      ),
      message("tool", "Bryan Bucks branch result"),
      message("assistant", "Latest unrelated dialogue"),
    ];
    const selected = selectShowMessages(messages, {
      query: "Bryan Bucks",
      messageLimit: 4,
      includeTools: false,
    });

    expect(selected.messages.map((entry) => entry.text)).toContain(
      "Bryan Bucks branch result",
    );
    expect(selected.messages[0]?.text).toBe("Unrelated dialogue 8");
  });

  test("shows the opening request plus latest dialogue without a query", () => {
    const messages = [
      message("user", "Opening request"),
      message("assistant", "Old response"),
      message("tool", "large tool output"),
      message("user", "Latest question"),
      message("assistant", "Latest response"),
    ];
    const selected = selectShowMessages(messages, {
      query: null,
      messageLimit: 3,
      includeTools: false,
    });
    expect(selected.messages.map((entry) => entry.text)).toEqual([
      "Opening request",
      "Latest question",
      "Latest response",
    ]);
    expect(selected.truncated).toBe(true);
  });

  test("enforces message and character bounds", () => {
    const messages = Array.from({ length: 12 }, (_, index) =>
      message("assistant", `${String(index)}-${"x".repeat(1000)}`),
    );
    const selected = selectShowMessages(messages, {
      query: null,
      messageLimit: 8,
      includeTools: false,
    });
    expect(selected.messages.length).toBeLessThanOrEqual(8);
    expect(
      selected.messages.reduce((total, entry) => total + entry.text.length, 0),
    ).toBeLessThanOrEqual(6000);
    expect(selected.truncated).toBe(true);
  });
});

describe("query-aware bounded history context", () => {
  test("preserves the query when truncating a long matching tool message", () => {
    const selected = selectShowMessages(
      [
        message("assistant", "Relevant dialogue about Bryan Bucks"),
        message("tool", `${"x".repeat(7000)} Bryan Bucks tool result`),
      ],
      {
        query: "Bryan Bucks",
        messageLimit: 2,
        includeTools: false,
      },
    );
    const tool = selected.messages.find((entry) => entry.role === "tool");

    expect(tool).toBeDefined();
    expect(messageMatchesQuery(tool?.text ?? "", "Bryan Bucks")).toBe(true);
    expect(selected.truncated).toBe(true);
  });

  test("preserves the centered match after a long preceding message", () => {
    const selected = selectShowMessages(
      [
        message("assistant", `Earlier context ${"x".repeat(7000)}`),
        message("assistant", "Bryan Bucks centered answer"),
        message("assistant", "Later context"),
      ],
      {
        query: "Bryan Bucks",
        messageLimit: 3,
        includeTools: false,
      },
    );

    expect(selected.messages.map((entry) => entry.text)).toContain(
      "Bryan Bucks centered answer",
    );
    expect(
      selected.messages.reduce((total, entry) => total + entry.text.length, 0),
    ).toBeLessThanOrEqual(6000);
    expect(selected.truncated).toBe(true);
  });

  test("keeps surrounding context after excerpting a long match", () => {
    const selected = selectShowMessages(
      [
        message("assistant", "Earlier context"),
        message(
          "assistant",
          `${"a".repeat(3500)} Bryan Bucks ${"b".repeat(3500)}`,
        ),
        message("assistant", "Later context"),
      ],
      {
        query: "Bryan Bucks",
        messageLimit: 3,
        includeTools: false,
      },
    );

    expect(selected.messages.map((entry) => entry.text)).toContain(
      "Earlier context",
    );
    expect(selected.messages.map((entry) => entry.text)).toContain(
      "Later context",
    );
    expect(
      selected.messages.some((entry) =>
        messageMatchesQuery(entry.text, "Bryan Bucks"),
      ),
    ).toBe(true);
  });

  test("preserves a one-character query in a long tool match", () => {
    const selected = selectShowMessages(
      [
        message("assistant", "Nearby dialogue"),
        message("tool", `${"a".repeat(7000)} q result`),
      ],
      {
        query: "q",
        messageLimit: 2,
        includeTools: false,
      },
    );

    expect(
      selected.messages.some(
        (entry) =>
          entry.role === "tool" && messageMatchesQuery(entry.text, "q"),
      ),
    ).toBe(true);
  });

  test("keeps the opening request and latest dialogue within the bound", () => {
    const selected = selectShowMessages(
      [
        message("user", `Opening ${"x".repeat(7000)}`),
        message("assistant", "Latest response"),
      ],
      {
        query: null,
        messageLimit: 2,
        includeTools: false,
      },
    );

    expect(selected.messages.at(-1)?.text).toBe("Latest response");
    expect(
      selected.messages.reduce((total, entry) => total + entry.text.length, 0),
    ).toBeLessThanOrEqual(6000);
  });

  test("uses AND-prefix matching and dialogue-first excerpts", () => {
    expect(messageMatchesQuery("Deploy Bryan Bucks", "depl buck")).toBe(true);
    expect(messageMatchesQuery("Bryan model Bucks", '"Bryan Bucks"')).toBe(
      false,
    );
    expect(messageMatchesQuery("Deploy foo.bar safely", '"foo bar"')).toBe(
      true,
    );
    expect(messageMatchesQuery("Deploy foo bar safely", '"foo.bar"')).toBe(
      true,
    );
    expect(messageMatchesQuery("the artist", '"he art"')).toBe(false);
    const excerpt = dialogueFirstExcerpt(
      [
        message("assistant", "Dialogue explains Bryan Bucks in context"),
        message("tool", "Tool branch bryan-bucks-v1"),
      ],
      "Bryan Bucks",
    );
    expect(excerpt).toStartWith("Dialogue explains");
    expect(
      dialogueFirstExcerpt(
        [message("user", `prefix ${"detail ".repeat(100)}Bryan Bucks result`)],
        "Bryan Bucks",
      ).length,
    ).toBeLessThanOrEqual(360);
  });

  test("centers accent-insensitive matches like FTS5", () => {
    const selected = selectShowMessages(
      [
        message("assistant", "Unrelated setup"),
        message(
          "assistant",
          `${"detail ".repeat(1000)}The café forecast is ready`,
        ),
      ],
      {
        query: "cafe",
        messageLimit: 2,
        includeTools: false,
      },
    );

    expect(messageMatchesQuery("The café forecast", "cafe")).toBe(true);
    expect(selected.messages.at(-1)?.text).toContain("café forecast");
  });

  test("centers exact phrases on token boundaries like FTS5", () => {
    const selected = selectShowMessages(
      [
        message(
          "assistant",
          `${"prefix ".repeat(20)}he art is the exact phrase`,
        ),
        message("assistant", "Unrelated middle context"),
        message("assistant", "the artist is only a substring match"),
        message("assistant", "Unrelated latest context"),
      ],
      {
        query: '"he art"',
        messageLimit: 2,
        includeTools: false,
      },
    );

    expect(
      selected.messages.some((entry) => entry.text.includes("he art")),
    ).toBe(true);
    expect(
      selected.messages.some((entry) => entry.text.includes("the artist")),
    ).toBe(false);
  });
});

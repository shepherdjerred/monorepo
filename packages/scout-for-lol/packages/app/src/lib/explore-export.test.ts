import { describe, expect, test } from "bun:test";
import { ExploreMessageSchema, type ExploreMessage } from "@scout-for-lol/data";
import {
  conversationToMarkdown,
  exportFilename,
} from "#src/lib/explore-export.ts";

const QUESTION_ID = "33333333-3333-4333-8333-333333333333";
const ANSWER_ID = "44444444-4444-4444-8444-444444444444";

function answerWithPreview(preview: unknown): ExploreMessage[] {
  return [
    ExploreMessageSchema.parse({
      id: QUESTION_ID,
      role: "user",
      content: "Which champion wins most?",
      createdAt: "2026-08-14T12:00:00.000Z",
    }),
    ExploreMessageSchema.parse({
      id: ANSWER_ID,
      role: "assistant",
      parentId: QUESTION_ID,
      content: "Jinx, narrowly.",
      preview,
      createdAt: "2026-08-14T12:00:30.000Z",
    }),
  ];
}

const PREVIEW = {
  columns: [
    { key: "label", label: "Player", format: "text" },
    { key: "games", label: "Games", format: "integer" },
    { key: "win_rate", label: "Win rate", format: "percent" },
  ],
  rows: [
    {
      label: "Faker",
      values: [
        { column: "games", value: 12 },
        { column: "win_rate", value: 0.5833 },
      ],
    },
  ],
  rowsScanned: 12,
  renderKind: "TABLE",
};

describe("conversationToMarkdown", () => {
  test("heads the table with the preview's label column instead of a stray Row column", () => {
    const markdown = conversationToMarkdown("Wins", answerWithPreview(PREVIEW));
    expect(markdown).toContain("| Player | Games | Win rate |");
    expect(markdown).not.toContain("| Row |");
    // The label lands once, in the label column — not beside an empty cell.
    expect(markdown).toContain("| Faker | 12 |");
  });

  test("formats metric values through the display formatter", () => {
    const markdown = conversationToMarkdown("Wins", answerWithPreview(PREVIEW));
    expect(markdown).toContain("58.3%");
    expect(markdown).not.toContain("0.5833");
  });

  test("escapes pipes and flattens newlines in cells and headers", () => {
    const preview = {
      ...PREVIEW,
      columns: [
        { key: "label", label: "Riot ID", format: "text" },
        { key: "games", label: "Games", format: "integer" },
      ],
      rows: [
        {
          label: "foo|bar\nbaz",
          values: [{ column: "games", value: 3 }],
        },
      ],
    };
    const markdown = conversationToMarkdown("Wins", answerWithPreview(preview));
    expect(markdown).toContain(String.raw`| foo\|bar baz | 3 |`);
  });

  test("collapses newlines in the title and question headings", () => {
    const markdown = conversationToMarkdown(
      "Two\nlines",
      answerWithPreview(null),
    );
    expect(markdown.startsWith("# Two lines\n")).toBe(true);
  });
});

describe("exportFilename", () => {
  test("drops hyphens introduced by truncation", () => {
    // 60 characters in, the cut lands on a separator.
    const title = `${"a".repeat(59)} ${"b".repeat(20)}`;
    expect(exportFilename(title).endsWith("-.md")).toBe(false);
  });

  test("falls back for symbol-only titles", () => {
    expect(exportFilename("???")).toBe("conversation.md");
  });
});

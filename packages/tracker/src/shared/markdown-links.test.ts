import { describe, expect, it } from "vitest";
import { issueLinks } from "./markdown-links.ts";

describe("issueLinks markdown transformer", () => {
  const transform = issueLinks();

  it("links FM-<N> references to /forum/FM-<N> and team issues to /issues/<TEAM>-<N>", () => {
    const tree = transform({
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "text",
              value: "See FM-1 and FM-42 alongside AI-12 and FMT-9.",
            },
          ],
        },
      ],
    });
    expect(tree).toEqual({
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "text", value: "See " },
            {
              type: "link",
              url: "/forum/FM-1",
              children: [{ type: "text", value: "FM-1" }],
            },
            { type: "text", value: " and " },
            {
              type: "link",
              url: "/forum/FM-42",
              children: [{ type: "text", value: "FM-42" }],
            },
            { type: "text", value: " alongside " },
            {
              type: "link",
              url: "/issues/AI-12",
              children: [{ type: "text", value: "AI-12" }],
            },
            { type: "text", value: " and " },
            {
              type: "link",
              url: "/issues/FMT-9",
              children: [{ type: "text", value: "FMT-9" }],
            },
            { type: "text", value: "." },
          ],
        },
      ],
    });
  });

  it("leaves inlineCode, code blocks, and existing links untouched", () => {
    const original = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "inlineCode", children: [{ type: "text", value: "FM-1" }] },
            {
              type: "link",
              url: "https://example.com/FM-42",
              children: [{ type: "text", value: "FM-42 and AI-12" }],
            },
          ],
        },
        {
          type: "code",
          children: [{ type: "text", value: "FM-1 AI-12" }],
        },
      ],
    };
    expect(transform(original)).toEqual(original);
  });
});

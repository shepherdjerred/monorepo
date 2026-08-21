import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownAnswer } from "#src/components/markdown-answer.tsx";

/**
 * An explore answer is model output, and a shared transcript renders it for an
 * anonymous viewer through this same component. Anything here that makes the
 * browser fetch a URL is a request the share-link holder never asked for.
 */
describe("MarkdownAnswer", () => {
  test("renders ordinary markdown", () => {
    const markup = renderToStaticMarkup(
      <MarkdownAnswer>{"Jinx leads with **42** games."}</MarkdownAnswer>,
    );
    expect(markup).toContain("<strong");
    expect(markup).toContain("42");
  });

  test("does not emit an image for markdown image syntax", () => {
    // `skipHtml` does not cover this: it drops raw HTML, but `![]()` is
    // markdown's own syntax and survives it.
    const markup = renderToStaticMarkup(
      <MarkdownAnswer>
        {"Here you go ![pixel](https://tracker.example/beacon.png)"}
      </MarkdownAnswer>,
    );
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("tracker.example");
    // The alt text goes too — it is an attribute, not child content.
    expect(markup).not.toContain("pixel");
    expect(markup).toContain("Here you go");
  });

  test("does not emit an image for raw HTML either", () => {
    const markup = renderToStaticMarkup(
      <MarkdownAnswer>
        {'Sneaky <img src="https://tracker.example/beacon.png" />'}
      </MarkdownAnswer>,
    );
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("tracker.example");
  });

  test("keeps links but marks them safe for cross-origin", () => {
    const markup = renderToStaticMarkup(
      <MarkdownAnswer>{"See [the docs](https://example.com)"}</MarkdownAnswer>,
    );
    expect(markup).toContain('href="https://example.com"');
    expect(markup).toContain("noopener");
  });
});

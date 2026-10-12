import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownAnswer } from "#src/components/scoutql/markdown-answer.tsx";

test("renders only catalog backed frozen inline icons and accessible controls", () => {
  const markup = renderToStaticMarkup(
    <MarkdownAnswer
      inlineEntities={[
        {
          marker: "scout://item/1056",
          kind: "item",
          assetKey: "1056",
          name: "Doran's Ring",
          description: "Health and mana sustain",
          version: "16.19.1",
        },
      ]}
    >
      {
        "Build [Doran's Ring](scout://item/1056) → [unknown](scout://item/999999)."
      }
    </MarkdownAnswer>,
  );
  expect(markup).toContain("/img/item/1056.png");
  expect(markup).toContain("show description");
  expect(markup).not.toContain('href="scout://');
  expect(markup).not.toContain("999999.png");
  expect(markup).toContain("unknown");
});
test("drops arbitrary Markdown images and unsafe links while keeping real profile links", () => {
  const markup = renderToStaticMarkup(
    <MarkdownAnswer>
      {
        "![tracking](https://example.invalid/pixel) [player](/app/players/1) [unsafe](javascript:alert%281%29)"
      }
    </MarkdownAnswer>,
  );
  expect(markup).not.toContain("pixel");
  expect(markup).not.toContain("javascript:");
  expect(markup).toContain('href="/app/players/1"');
});

import { describe, expect, test } from "bun:test";
import {
  isScrolledToBottom,
  PINNED_BOTTOM_SLACK_PX,
} from "#src/lib/pinned-scroll.ts";

const VIEWPORT = 800;
const DOCUMENT = 5000;

describe("isScrolledToBottom", () => {
  test("a page mounted part-way up is not pinned", () => {
    // The regression this exists for: the hook assumed pinned until a scroll
    // event proved otherwise, so a restored scroll position or a link into the
    // middle of a conversation was yanked to the bottom on the first token.
    expect(
      isScrolledToBottom({
        innerHeight: VIEWPORT,
        scrollY: 0,
        scrollHeight: DOCUMENT,
      }),
    ).toBe(false);
  });

  test("a page scrolled to the bottom is pinned", () => {
    expect(
      isScrolledToBottom({
        innerHeight: VIEWPORT,
        scrollY: DOCUMENT - VIEWPORT,
        scrollHeight: DOCUMENT,
      }),
    ).toBe(true);
  });

  test("within the slack still counts as the bottom", () => {
    // Following a stream should survive the last line or two of new content
    // arriving between the scroll event and the measurement.
    expect(
      isScrolledToBottom({
        innerHeight: VIEWPORT,
        scrollY: DOCUMENT - VIEWPORT - (PINNED_BOTTOM_SLACK_PX - 1),
        scrollHeight: DOCUMENT,
      }),
    ).toBe(true);
  });

  test("just beyond the slack does not", () => {
    expect(
      isScrolledToBottom({
        innerHeight: VIEWPORT,
        scrollY: DOCUMENT - VIEWPORT - (PINNED_BOTTOM_SLACK_PX + 1),
        scrollHeight: DOCUMENT,
      }),
    ).toBe(false);
  });

  test("a document shorter than the viewport is pinned", () => {
    // A conversation with one short answer never scrolls; it must still follow.
    expect(
      isScrolledToBottom({
        innerHeight: VIEWPORT,
        scrollY: 0,
        scrollHeight: 200,
      }),
    ).toBe(true);
  });
});

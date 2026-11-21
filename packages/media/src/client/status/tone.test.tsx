import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PageTitle, Status, WireStatus } from "#client/components.tsx";
import { wireStatusTone } from "./tone.ts";

test("a contract status renders with its tone", () => {
  expect(renderToStaticMarkup(<Status value="available" />)).toBe(
    '<span class="status" data-tone="ok">Available</span>',
  );
  expect(renderToStaticMarkup(<Status value="requests_paused" />)).toBe(
    '<span class="status" data-tone="warn">Requests paused</span>',
  );
});

test("a wire status takes the tone of a word the server writes", () => {
  expect(renderToStaticMarkup(<WireStatus value="grace_period" />)).toBe(
    '<span class="status" data-tone="warn">Grace period</span>',
  );
});

test("a wire status outside the table is neutral", () => {
  // A mail provider's own status word.
  expect(wireStatusTone("deferred")).toBe("neutral");
  // A property every object inherits is not a status.
  expect(wireStatusTone("constructor")).toBe("neutral");
  expect(wireStatusTone("toString")).toBe("neutral");
});

test("the page title is one text node, which React requires of a title", () => {
  expect(
    renderToStaticMarkup(<PageTitle eyebrow="Household" title="Library" />),
  ).toContain("<title>Library · Media</title>");
});

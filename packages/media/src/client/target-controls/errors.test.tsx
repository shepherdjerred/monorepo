import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError } from "#client/api.ts";
import { CommandError, commandNeedsReview } from "./errors.tsx";

test("explains runtime protection without asking the user to review the title", () => {
  const message =
    "Your movie request wasn’t saved because Media automation is paused.";
  const error = new ApiError("runtime_protected", message, 409);
  expect(commandNeedsReview(error)).toBe(false);

  const html = renderToStaticMarkup(
    <CommandError error={error} review={vi.fn()} />,
  );
  expect(html).toContain('role="alert"');
  expect(html).toContain(message);
  expect(html).not.toContain("Review latest details");
});

test("asks the user to review a genuine version conflict", () => {
  const error = new ApiError("version_conflict", "Title version changed", 409);
  expect(commandNeedsReview(error)).toBe(true);
  expect(
    renderToStaticMarkup(<CommandError error={error} review={vi.fn()} />),
  ).toContain("Review latest details");
});

import { afterEach, expect, test, vi } from "vitest";
import { movieChoiceFreshness } from "./freshness.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

test("mapping deadline includes elapsed awaits from the original clock pair", async () => {
  const verified = 1_000_000;
  const observed = { wall: verified + 299_999, monotonic: 40 };
  const wall = vi.spyOn(Date, "now").mockReturnValue(observed.wall);
  const monotonic = vi
    .spyOn(performance, "now")
    .mockReturnValue(observed.monotonic);
  const freshness = movieChoiceFreshness(new Date(verified), observed);
  await Promise.resolve();
  wall.mockReturnValue(verified + 300_000);
  monotonic.mockReturnValue(41);
  expect(freshness.assertActive).toThrow(
    expect.objectContaining({ code: "movie_edition_choice_changed" }),
  );
});

test("wall-clock rollback cannot extend the captured mapping authorization", () => {
  const observed = { wall: 1_299_999, monotonic: 40 };
  const wall = vi.spyOn(Date, "now").mockReturnValue(observed.wall);
  const monotonic = vi.spyOn(performance, "now").mockReturnValue(40);
  const freshness = movieChoiceFreshness(new Date(1_000_000), observed);
  wall.mockReturnValue(1_299_000);
  monotonic.mockReturnValue(41);
  expect(freshness.assertActive).toThrow(
    expect.objectContaining({ code: "movie_edition_choice_changed" }),
  );
});

test("a later real mapping refresh supplies a new guard without renewing old evidence", () => {
  const observed = { wall: 1_299_999, monotonic: 40 };
  const wall = vi.spyOn(Date, "now").mockReturnValue(observed.wall);
  const monotonic = vi.spyOn(performance, "now").mockReturnValue(40);
  const prior = movieChoiceFreshness(new Date(1_000_000), observed);
  wall.mockReturnValue(1_300_000);
  monotonic.mockReturnValue(41);
  const fresh = movieChoiceFreshness(new Date(1_300_000), {
    wall: 1_300_000,
    monotonic: 41,
  });
  expect(prior.assertActive).toThrow(
    expect.objectContaining({ code: "movie_edition_choice_changed" }),
  );
  expect(fresh.assertActive).not.toThrow();
});

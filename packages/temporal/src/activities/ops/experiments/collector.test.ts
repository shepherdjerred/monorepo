import { expect, test } from "vitest";
import { collectExperiments } from "./collector.ts";

test("links one aggregate review signal to the native Hub queue", async () => {
  const result = await collectExperiments(
    "http://experiments:7408",
    (input) => {
      expect(String(input)).toBe(
        "http://experiments:7408/internal/v1/review-summary",
      );
      return Promise.resolve(Response.json({ dueCount: 3 }));
    },
  );
  expect(result.signals).toEqual([
    expect.objectContaining({
      needsMe: true,
      title: "3 experiments due for review",
      attributes: { dueCount: 3 },
      links: [
        expect.objectContaining({
          url: expect.stringMatching(/\/experiments\?view=due$/u),
        }),
      ],
    }),
  ]);
});

test("an empty queue produces no attention signal", async () => {
  const result = await collectExperiments("http://experiments:7408", () =>
    Promise.resolve(Response.json({ dueCount: 0 })),
  );
  expect(result.signals).toEqual([]);
});

test("an unavailable or invalid source fails collection", async () => {
  await expect(
    collectExperiments("http://experiments:7408", () =>
      Promise.resolve(new Response(null, { status: 503 })),
    ),
  ).rejects.toThrow("503");
  await expect(
    collectExperiments("http://experiments:7408", () =>
      Promise.resolve(Response.json({ dueCount: -1 })),
    ),
  ).rejects.toThrow();
});

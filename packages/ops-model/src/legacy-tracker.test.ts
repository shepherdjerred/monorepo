import { expect, test } from "vitest";
import { SourceIdSchema, LinkSchema, MetricSchema } from "./snapshot.ts";

test("legacy stored source, links and metrics normalize to Tracker", () => {
  expect(SourceIdSchema.parse("linear")).toBe("tracker");
  expect(
    LinkSchema.parse({
      kind: "linear",
      label: "AI-1",
      url: "https://linear.app/sjerred/issue/AI-1",
    }).kind,
  ).toBe("tracker");
  expect(
    MetricSchema.parse({
      id: "linear.issues.open",
      label: "Open",
      value: 1,
      unit: "count",
      severity: "ok",
      source: "linear",
    }),
  ).toMatchObject({ id: "tracker.issues.open", source: "tracker" });
  expect(() => SourceIdSchema.parse("unknown-source")).toThrow();
});

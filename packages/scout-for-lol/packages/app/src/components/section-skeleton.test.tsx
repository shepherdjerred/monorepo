import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DelayedLoadingState,
  SectionSkeleton,
} from "#src/components/section-skeleton.tsx";

describe("delayed loading fallbacks", () => {
  test("do not flash on the first paint", () => {
    expect(renderToStaticMarkup(<SectionSkeleton />)).toBe("");
    expect(
      renderToStaticMarkup(<DelayedLoadingState label="Loading dares…" />),
    ).toBe("");
  });
});

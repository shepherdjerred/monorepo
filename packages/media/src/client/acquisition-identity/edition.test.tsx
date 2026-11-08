import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EditionNotice } from "./review.tsx";
import type { DefaultEditionDecision } from "#shared/editions/evidence.ts";

const unmarked: DefaultEditionDecision = {
  policy: "standard_unmarked",
  accepted: true,
  reasons: [],
  candidate: { kind: "standard_unmarked" },
  current: [],
  members: [],
};
test("default cut review does not claim a proven theatrical cut", () => {
  const html = renderToStaticMarkup(<EditionNotice decision={unmarked} />);
  expect(html).toContain("No specific edition requested");
  expect(html).toContain("quality requirements still apply");
  expect(html).not.toContain("theatrical");
});
test("named, contradictory and protected current cuts explain identity's independent limit", () => {
  const html = renderToStaticMarkup(
    <EditionNotice
      decision={{
        ...unmarked,
        accepted: false,
        reasons: [
          "edition_candidate_incompatible",
          "edition_evidence_conflict",
          "edition_current_requires_classification",
        ],
      }}
    />,
  );
  expect(html).toContain("Cut evidence blocks this release");
  expect(html).toContain("conflicting cuts");
  expect(html).toContain("classification is not available yet");
  expect(html).toContain("does not override");
  expect(html).not.toContain("<button");
});

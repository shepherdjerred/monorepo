import { expect, it } from "vitest";
import { definitiveMeasuredRejection } from "./content-rejection.ts";
it("classifies actual measured content mismatches but keeps missing evidence and operational errors protected", () => {
  expect(
    definitiveMeasuredRejection(["codec_rejected", "quality_rejected"], ["ja"]),
  ).toBe(true);
  expect(definitiveMeasuredRejection(["audio_language_missing"], ["ja"])).toBe(
    true,
  );
  expect(definitiveMeasuredRejection(["audio_language_missing"], [])).toBe(
    false,
  );
  for (const reason of [
    "authentication",
    "storage_unavailable",
    "file_size_changed",
    "resolved_language_evidence_unknown",
    "resolved_custom_format_unknown",
    "measured_upgrade_rejected:no_improvement",
  ])
    expect(definitiveMeasuredRejection([reason], ["en"])).toBe(false);
  expect(
    definitiveMeasuredRejection(
      ["codec_rejected", "resolved_language_evidence_unknown"],
      ["en"],
    ),
  ).toBe(false);
});

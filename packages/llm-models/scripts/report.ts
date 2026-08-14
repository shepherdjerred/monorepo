/**
 * Human-facing rendering of a catalog cross-check run.
 *
 * Split from `sync-from-upstreams.ts` so the prose that an operator reads lives
 * apart from the comparison logic that decides what to say. The structural
 * input type is deliberately narrower than `SyncReport`: this module formats
 * the four flat sections and never reads the per-model verdict map, so it
 * cannot silently grow a dependency on identity data it has no business
 * rendering. `SyncReport` satisfies it structurally.
 */

export type ReportSections = {
  applied: string[];
  withheld: string[];
  overlayOnly: string[];
  notChecked: string[];
};

export function emit(line: string): void {
  process.stdout.write(`${line}\n`);
}

export function emitReport(report: ReportSections, check: boolean): void {
  emit("== LLM catalog cross-check ==");
  emit(
    report.applied.length > 0
      ? `\nDrift vs upstreams (${check ? "not applied" : "applied"}):\n${report.applied.join("\n")}`
      : "\nNo input/output/context drift vs upstreams.",
  );
  if (report.withheld.length > 0) {
    emit(
      `\nWITHHELD by plausibility guards — check each against the provider's own pricing page, then either apply the upstream value or confirm the catalog's is intended (a divergence can be deliberate, e.g. a standard rate held while upstream lists a promotional one):\n${report.withheld.join("\n")}`,
    );
  }
  if (report.overlayOnly.length > 0) {
    emit(
      `\nOverlay-only (absent from both upstreams under their own provider — verify manually):\n  ${report.overlayOnly.join("\n  ")}`,
    );
  }
  if (report.notChecked.length > 0) {
    emit(`\nNot cross-checked:\n  ${report.notChecked.join("\n  ")}`);
  }
}

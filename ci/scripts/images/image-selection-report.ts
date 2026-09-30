export type TextWriter = (path: string, contents: string) => Promise<unknown>;

const selectionReport = "image-selection-report.json";

export async function writeFallbackReport(
  targets: readonly string[],
  reason: string,
  writeText: TextWriter = Bun.write,
): Promise<void> {
  const targetReasons = Object.fromEntries(
    targets.map((target) => [target, [reason]]),
  );
  await writeText(
    selectionReport,
    `${JSON.stringify({
      base: null,
      changedPaths: [],
      mode: "all",
      globalReason: reason,
      targets: targetReasons,
    })}\n`,
  );
}

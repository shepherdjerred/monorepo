/**
 * How a model-eval script emits its report.
 *
 * Shared by the dare-paraphrase and Explore-capability evals because the three
 * steps have to agree across them: `--write` persists the report next to the
 * code it grades, the report always goes to stdout so a run is readable
 * without the file, and a failing report must set a non-zero exit code or the
 * eval silently becomes decorative.
 */
export async function emitEvalReport(
  report: { readonly passed: boolean },
  reportUrl: URL,
): Promise<void> {
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (Bun.argv.includes("--write")) {
    await Bun.write(reportUrl, serialized);
  }
  process.stdout.write(serialized);
  if (!report.passed) {
    process.exitCode = 1;
  }
}

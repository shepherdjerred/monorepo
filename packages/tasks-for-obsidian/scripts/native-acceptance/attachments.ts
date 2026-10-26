import path from "node:path";

/** Keep custom XCTest evidence after either success or failure, if a bundle exists. */
export async function exportIosJourneyAttachments(
  resultBundle: string,
  outputDirectory: string,
  command: (argv: string[]) => Promise<string>,
): Promise<void> {
  if (!(await Bun.file(path.join(resultBundle, "Info.plist")).exists())) return;
  await command([
    "xcrun",
    "xcresulttool",
    "export",
    "attachments",
    "--path",
    resultBundle,
    "--output-path",
    outputDirectory,
  ]);
}

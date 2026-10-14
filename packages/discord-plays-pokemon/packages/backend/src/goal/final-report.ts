export async function readFinalReport(outputPath: string): Promise<string> {
  const file = Bun.file(outputPath);
  if (await file.exists()) {
    const raw = await file.text();
    const text = raw.trim();
    if (text.length > 0) return text;
  }
  return "Codex exited without writing a final report.";
}

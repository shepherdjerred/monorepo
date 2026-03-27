import path from "node:path";
import type { Config } from "#config";
import { listSessions } from "#lib/session/manager.ts";

export async function showLeetcodeHistory(config: Config): Promise<void> {
  const sessions = await listSessions(config.dataDir);
  const leetcodeSessions = sessions.filter((s) => s.type === "leetcode");

  if (leetcodeSessions.length === 0) {
    console.log("No leetcode sessions found.");
    console.log(
      `Sessions are stored in: ${path.join(config.dataDir, "sessions")}`,
    );
    return;
  }

  console.log(
    `\n${"ID".padEnd(38)} ${"Question".padEnd(25)} ${"Status".padEnd(12)} ${"Duration".padEnd(10)} ${"Hints".padEnd(7)} ${"Tests".padEnd(7)} Date`,
  );
  console.log("-".repeat(115));

  for (const s of leetcodeSessions) {
    const elapsedMinutes = Math.floor(s.timer.elapsedMs / 60_000);
    const elapsedSeconds = Math.floor((s.timer.elapsedMs % 60_000) / 1000);
    const duration = `${String(elapsedMinutes)}:${String(elapsedSeconds).padStart(2, "0")}`;
    const date = s.startedAt.slice(0, 10);
    const title =
      s.questionTitle.length > 23
        ? s.questionTitle.slice(0, 22) + "..."
        : s.questionTitle;

    console.log(
      `${s.id.padEnd(38)} ${title.padEnd(25)} ${s.status.padEnd(12)} ${duration.padEnd(10)} ${String(s.hintsGiven).padEnd(7)} ${String(s.testsRun).padEnd(7)} ${date}`,
    );
  }

  console.log(`\nTotal: ${String(leetcodeSessions.length)} sessions`);
}

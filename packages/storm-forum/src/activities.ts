import { heartbeat } from "@temporalio/activity";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { createForumConfig, forumFlagOptions, type Stage } from "./config.ts";
import { resolveTheme } from "./themes.ts";
import { refreshMinecraftStatus, writeMinecraftStatus } from "./minecraft.ts";
import { runPhp } from "./process.ts";
export function createMaintainStormForum(stage: Stage) {
  const config = createForumConfig(
    createFlagConfigSource(forumFlagOptions(stage)),
  );
  return async function maintainStormForum(): Promise<void> {
    if (!(await Bun.file("/var/lib/storm-forum/.maintenance").exists())) {
      heartbeat("policy");
      const [registration, choice, calendarEnabled] = await Promise.all([
        config.value("registrationEnabled"),
        config.value("season"),
        config.value("calendarEnabled"),
      ]);
      await runPhp(
        [
          "cmd.php",
          "storm:policy",
          "--registration",
          registration ? "enabled" : "disabled",
          "--season",
          resolveTheme(choice, calendarEnabled, new Date()),
          "--selection",
          choice === "auto" ? "follow" : "fixed",
        ],
        "/app/forum",
        30_000,
      );
      heartbeat("jobs");
      await runPhp(["cmd.php", "xf:run-jobs", "--max-execution-time", "50"]);
    }
    heartbeat("minecraft");
    await writeMinecraftStatus(await refreshMinecraftStatus());
  };
}

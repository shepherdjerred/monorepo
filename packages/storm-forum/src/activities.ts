import { heartbeat } from "@temporalio/activity";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { createForumConfig, forumFlagOptions, type Stage } from "./config.ts";
import { resolveTheme } from "@shepherdjerred/storm-theme";
import { updateMinecraftStatus } from "./minecraft.ts";
import { runPhp } from "./process.ts";
export function createMaintainStormForum(stage: Stage) {
  const config = createForumConfig(
    createFlagConfigSource(forumFlagOptions(stage)),
  );
  return async function maintainStormForum(): Promise<void> {
    const outcomes = await Promise.allSettled([
      updateMinecraftStatus(),
      maintainForum(),
    ]);
    const failures = outcomes.filter(
      (outcome) => outcome.status === "rejected",
    );
    if (failures.length > 0)
      throw new AggregateError(
        failures.map((failure) =>
          failure.reason instanceof Error
            ? failure.reason
            : new Error("Unknown housekeeping failure"),
        ),
        "Forum housekeeping failed",
      );
  };
  async function maintainForum(): Promise<void> {
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
  }
}

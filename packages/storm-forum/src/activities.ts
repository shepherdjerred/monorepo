import { heartbeat } from "@temporalio/activity";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { createForumConfig } from "./config.ts";
import { refreshMinecraftStatus, writeMinecraftStatus } from "./minecraft.ts";
import { runPhp } from "./process.ts";
const config = createForumConfig(
  createFlagConfigSource({
    targetingKey: "storm-forum",
    kinds: { registrationEnabled: "boolean", season: "string" },
  }),
);
export async function maintainStormForum(): Promise<void> {
  if (await Bun.file("/var/lib/storm-forum/.maintenance").exists()) {
    return;
  }
  heartbeat("policy");
  await runPhp(
    [
      "cmd.php",
      "storm:policy",
      "--registration",
      (await config.value("registrationEnabled")) ? "enabled" : "disabled",
      "--season",
      await config.value("season"),
    ],
    "/app/forum",
    30_000,
  );
  heartbeat("jobs");
  await runPhp(["cmd.php", "xf:run-jobs", "--max-execution-time", "50"]);
  heartbeat("minecraft");
  await writeMinecraftStatus(await refreshMinecraftStatus());
}

import { isAdmin } from "@shepherdjerred/streambot/discord/permissions.ts";
import type {
  CommandHandlerDeps,
  CommandInteraction,
} from "@shepherdjerred/streambot/discord/command-types.ts";
import type { VoiceDebugCaptureStatus } from "@shepherdjerred/streambot/voice/capture-manager.ts";

type VoiceDebugCommandDeps = Pick<
  CommandHandlerDeps,
  | "config"
  | "startVoiceDebugCapture"
  | "stopVoiceDebugCapture"
  | "voiceDebugCaptureStatus"
>;

export async function runVoiceDebugCommand(
  deps: VoiceDebugCommandDeps,
  subcommand: string,
  interaction: CommandInteraction,
): Promise<void> {
  if (!isAdmin(interaction.userId, deps.config.discord.adminIds)) {
    await interaction.reply("Only an admin can capture voice diagnostics.");
    return;
  }
  if (subcommand === "start") {
    const durationSeconds = interaction.getInteger("duration") ?? 60;
    const result = deps.startVoiceDebugCapture(durationSeconds);
    if (result.outcome === "disabled") {
      await interaction.reply("Voice diagnostic capture is disabled.");
      return;
    }
    if (result.outcome === "already-active") {
      await interaction.reply(
        `A voice debug capture is already active (${formatDebugStatus(result.status)}).`,
      );
      return;
    }
    await interaction.reply(
      `Started private voice debug capture ${result.status.captureId} for ${String(durationSeconds)} seconds.`,
    );
    return;
  }
  if (subcommand === "stop") {
    const result = deps.stopVoiceDebugCapture();
    if (result.outcome === "none") {
      await interaction.reply("No voice debug capture is active.");
    } else if (result.outcome === "different-session") {
      await interaction.reply(
        "A voice debug capture is active in another playback session.",
      );
    } else {
      await interaction.reply(
        `Stopped voice debug capture ${result.status.captureId}; upload queued.`,
      );
    }
    return;
  }
  if (subcommand === "status") {
    const status = deps.voiceDebugCaptureStatus();
    await interaction.reply(
      status === null
        ? "No voice debug capture is active for this playback session."
        : `Voice debug capture active: ${formatDebugStatus(status)}.`,
    );
    return;
  }
  await interaction.reply("Unknown voice debug command.");
}

function formatDebugStatus(status: VoiceDebugCaptureStatus): string {
  const remainingSeconds = Math.max(
    0,
    Math.ceil((status.expiresAtMs - Date.now()) / 1000),
  );
  return `${status.captureId}, ${String(remainingSeconds)}s remaining, ${String(status.speakerCount)} speaker(s), ${String(status.bufferedBytes)} bytes${status.truncated ? ", truncated" : ""}`;
}

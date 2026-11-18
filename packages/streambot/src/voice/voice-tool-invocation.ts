import type { VoiceMutationGate } from "@shepherdjerred/voice-assistant/mutation-gate.ts";
import type { VoiceAttemptHandle } from "@shepherdjerred/voice-assistant/realtime/attempt.ts";
import {
  PlaybackCommandBlockedError,
  PlaybackCommandBoundaryError,
} from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import { voiceToolCallsTotal } from "@shepherdjerred/streambot/observability/metrics.ts";
import { voiceToolDurationSeconds } from "@shepherdjerred/streambot/observability/voice-diagnostic-metrics.ts";
import {
  voiceToolSchemas,
  type ToolName,
} from "@shepherdjerred/streambot/voice/voice-tool-types.ts";

const ADVANCED_TOOL_NAMES = new Set<ToolName>([
  "pause",
  "resume",
  "restart",
  "previous",
  "search_media",
  "subtitles",
]);

function isAdvancedPlay(name: ToolName, toolArguments: unknown): boolean {
  if (name !== "play") return false;
  const parsed = voiceToolSchemas.play.safeParse(toolArguments);
  return parsed.success && parsed.data.placement === "now";
}

export async function invokeStreambotVoiceTool(options: {
  readonly commands: {
    readonly isAssistantV2Enabled?: () => Promise<boolean>;
  };
  readonly mutationGate: VoiceMutationGate;
  readonly transactionSignal: AbortSignal;
  readonly attempt: VoiceAttemptHandle;
  readonly name: ToolName;
  readonly mutating: boolean;
  readonly toolArguments: unknown;
  readonly operation: () => string | Promise<string>;
}): Promise<string> {
  const { name, mutating, toolArguments } = options;
  const startedAt = performance.now();
  return await options.attempt.runStage(
    `streambot.voice.tool.${name}`,
    {
      "streambot.voice.tool.name": name,
      "streambot.voice.tool.argument_fields":
        typeof toolArguments === "object" && toolArguments !== null
          ? Object.keys(toolArguments).length
          : 0,
      "streambot.voice.tool.mutating": mutating,
    },
    async (span) => {
      let outcome = "error";
      let result: string | undefined;
      try {
        if (options.transactionSignal.aborted) {
          outcome = "expired";
          result =
            "That voice command expired. Say Hey Streambot and try again.";
          return result;
        }
        const advanced =
          ADVANCED_TOOL_NAMES.has(name) || isAdvancedPlay(name, toolArguments);
        if (
          advanced &&
          options.commands.isAssistantV2Enabled !== undefined &&
          !(await options.commands.isAssistantV2Enabled())
        ) {
          outcome = "disabled";
          result = "That advanced playback control is not enabled here.";
          return result;
        }
        if (mutating && !options.mutationGate.claim()) {
          outcome = "rejected-second-mutation";
          result =
            "Only one playback change is allowed per wake phrase. Ask again for another change.";
          return result;
        }
        try {
          result = await options.operation();
          outcome = "success";
          return result;
        } catch (error) {
          if (error instanceof PlaybackCommandBoundaryError) {
            if (mutating && !(error instanceof PlaybackCommandBlockedError)) {
              options.mutationGate.release();
            }
            outcome = "denied";
            result = error.message;
            return result;
          }
          throw error;
        }
      } finally {
        const durationMs = performance.now() - startedAt;
        voiceToolCallsTotal.inc({ tool: name, outcome });
        voiceToolDurationSeconds.observe(
          { tool: name, outcome },
          durationMs / 1000,
        );
        span.setAttributes({
          "streambot.voice.tool.outcome": outcome,
          "streambot.voice.tool.duration_ms": durationMs,
        });
        options.attempt.tool({
          name,
          arguments: toolArguments,
          ...(result === undefined ? {} : { result }),
          outcome,
          durationMs,
        });
      }
    },
  );
}

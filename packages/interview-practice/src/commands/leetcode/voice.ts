import { z } from "zod/v4";
import type { Config } from "#config";
import type { Session } from "#lib/session/manager.ts";
import type { LeetcodeQuestion } from "#lib/questions/schemas.ts";
import type { Timer } from "#lib/timer/countdown.ts";
import type { Logger } from "#logger";
import { saveSession } from "#lib/session/manager.ts";
import { insertEvent } from "#lib/db/events.ts";
import { insertTranscript } from "#lib/db/transcript.ts";
import { generateReport, formatReport } from "#lib/report/generate.ts";
import {
  createReadline,
  promptUser,
  parseCommand,
  printHelp,
} from "#lib/input/prompt.ts";
import {
  formatInterviewerMessage,
  formatTimerDisplay,
  formatSessionEnd,
} from "#lib/output/formatter.ts";
import { createRealtimeClient } from "#lib/voice/realtime.ts";
import { buildRealtimeSessionConfig } from "#lib/voice/session-config.ts";
import { createAudioManager, checkAudioDependencies } from "#lib/voice/audio.ts";
import { getLeetcodeTools } from "#lib/ai/tools.ts";
import { runTests } from "#lib/testing/runner.ts";
import { updateProblemForNewPart } from "#lib/session/workspace.ts";

export type VoiceSessionOptions = {
  config: Config;
  session: Session;
  question: LeetcodeQuestion;
  timer: Timer;
  solutionPath: string;
  logger: Logger;
};

export async function runVoiceSession(opts: VoiceSessionOptions): Promise<void> {
  const { config, session, question, timer, solutionPath, logger } = opts;

  // Check audio dependencies
  const audioDeps = checkAudioDependencies();
  if (!audioDeps.ok) {
    console.error(
      `\u001B[31mVoice mode requires: ${audioDeps.missing.join(", ")}\u001B[0m`,
    );
    console.error("Install via: brew install sox ffmpeg");
    process.exit(1);
  }

  // Check OpenAI API key
  const openaiKey = config.openaiApiKey;
  if (openaiKey === undefined || openaiKey === "") {
    console.error(
      "\u001B[31mVoice mode requires OPENAI_API_KEY environment variable\u001B[0m",
    );
    process.exit(1);
  }

  // Cost warning
  console.log(
    "\n\u001B[33mVoice mode enabled. Estimated cost: ~$5 for this session.\u001B[0m",
  );
  console.log("Proceed? [y/N] ");
  const rl = createReadline();
  const answer = await promptUser(rl);
  if (answer.trim().toLowerCase() !== "y" && answer.trim().toLowerCase() !== "yes") {
    console.log("Voice mode cancelled.");
    rl.close();
    process.exit(0);
  }

  const voiceLogger = logger.child("voice");
  const realtimeClient = createRealtimeClient(voiceLogger);
  const audioManager = createAudioManager(voiceLogger);

  // Track consecutive WebSocket failures for fallback
  let consecutiveWsFailures = 0;
  const MAX_WS_FAILURES = 3;
  let fallbackTriggered = false;

  // Get current part
  const currentPart = question.parts.find(
    (p) => p.partNumber === session.metadata.currentPart,
  );
  if (!currentPart) {
    console.error("No question parts found");
    rl.close();
    return;
  }

  // Build session config
  const tools = getLeetcodeTools();
  const sessionConfig = buildRealtimeSessionConfig({
    model: config.realtimeModel,
    voice: config.realtimeVoice,
    question,
    currentPart,
    totalParts: question.parts.length,
    timerDisplay: timer.getDisplayTime(),
    hintsGiven: session.metadata.hintsGiven,
    testsRun: session.metadata.testsRun,
    tools,
  });

  const audioChunks: Buffer[] = [];

  // Wire up callbacks
  realtimeClient.on({
    onTranscript(transcript, _itemId) {
      voiceLogger.info("user_transcript", { transcript });
      insertTranscript(session.db, "user", transcript, { source: "voice" });
      console.log(`\n\u001B[90mYou: ${transcript}\u001B[0m`);
    },

    onAudioDelta(base64Audio, _responseId) {
      const buf = Buffer.from(base64Audio, "base64");
      audioChunks.push(buf);
      audioManager.gateMicWhileSpeaking(true);
      audioManager.writeSpeakerAudio(base64Audio);
    },

    onAudioDone(_responseId) {
      const full = Buffer.concat(audioChunks);
      void Bun.write("/tmp/realtime_full_response.raw", full);
      console.log(`[debug] saved full response: ${String(full.length)} bytes to /tmp/realtime_full_response.raw`);
      audioChunks.length = 0;
      audioManager.gateMicWhileSpeaking(false);
      consecutiveWsFailures = 0;
    },

    onFunctionCall(callId, name, args, _itemId) {
      voiceLogger.info("voice_tool_call", { name, args });
      insertTranscript(session.db, "tool_call", name, { tool: name, args });

      void (async () => {
        const result = await dispatchVoiceTool(name, args, {
          session,
          question,
          solutionPath,
          logger: voiceLogger,
        });
        insertTranscript(session.db, "tool_result", result, { tool: name });
        realtimeClient.sendFunctionResult(callId, result);
      })();
    },

    onResponseDone(response) {
      for (const output of response.output) {
        if (output.content !== undefined) {
          for (const content of output.content) {
            if (content.transcript !== undefined) {
              insertTranscript(session.db, "interviewer", content.transcript, {
                source: "voice",
              });
              console.log(formatInterviewerMessage(content.transcript));
            }
          }
        }
      }

      insertEvent(session.db, "voice_turn", {
        responseId: response.id,
        tokensIn: response.usage?.input_tokens,
        tokensOut: response.usage?.output_tokens,
      });

      session.metadata.timer = timer.getState();
      void saveSession(session);
    },

    onError(error) {
      voiceLogger.error("realtime_error", error);
      consecutiveWsFailures++;

      if (consecutiveWsFailures >= MAX_WS_FAILURES && !fallbackTriggered) {
        fallbackTriggered = true;
        console.log(
          "\n\u001B[31mVoice connection failed 3 times. Falling back to text mode.\u001B[0m",
        );
        console.log("\u001B[33mSession transcript preserved. Restart without --voice.\u001B[0m\n");

        audioManager.stopAll();
        realtimeClient.disconnect();
      }
    },
  });

  // Connect to Realtime API
  try {
    await realtimeClient.connect(openaiKey, sessionConfig);
    console.log("\n\u001B[32mVoice connected. Speak to begin.\u001B[0m");
    console.log("\u001B[90mType /quit to end, /time for timer\u001B[0m\n");
  } catch (error) {
    console.error(
      `\u001B[31mFailed to connect to OpenAI Realtime: ${error instanceof Error ? error.message : String(error)}\u001B[0m`,
    );
    console.log("Falling back to text mode.\n");
    rl.close();
    process.exit(1);
  }

  // Start audio capture and playback
  audioManager.startMic();
  audioManager.startSpeaker();

  // Pipe mic data to realtime
  audioManager.onMicData((pcmBase64) => {
    realtimeClient.sendAudio(pcmBase64);
  });

  // Slash command loop (runs alongside voice)
  // Wait for /quit or fallback trigger
  await handleVoiceCommands(rl, {
    fallbackTriggered: () => fallbackTriggered,
    onQuit: async () => {
      audioManager.stopAll();
      realtimeClient.disconnect();

      session.metadata.status = "completed";
      session.metadata.endedAt = new Date().toISOString();
      session.metadata.timer = timer.getState();
      await saveSession(session);
      insertEvent(session.db, "session_end", {
        duration_s: Math.floor(timer.getElapsedMs() / 1000),
        hintsGiven: session.metadata.hintsGiven,
        testsRun: session.metadata.testsRun,
      });

      const report = generateReport(session.db, session.metadata);
      console.log(formatReport(report));

      console.log(formatSessionEnd());
    },
    timer,
  });

  rl.close();
  session.db.close();
  voiceLogger.info("voice_session_complete", {
    duration_s: Math.floor(timer.getElapsedMs() / 1000),
  });
}

async function handleVoiceCommands(
  rl: ReturnType<typeof createReadline>,
  opts: {
    fallbackTriggered: () => boolean;
    onQuit: () => Promise<void>;
    timer: Timer;
  },
): Promise<void> {
  while (!opts.fallbackTriggered()) {
    const rawInput = await promptUser(rl);
    const command = parseCommand(rawInput);

    if (command.type === "quit") {
      await opts.onQuit();
      return;
    }

    switch (command.type) {
      case "time":
        console.log(formatTimerDisplay(opts.timer.getDisplayTime()));
        break;

      case "run":
      case "hint":
      case "score":
        console.log(
          "\u001B[90mIn voice mode, ask the interviewer verbally. Or use /quit to end.\u001B[0m",
        );
        break;

      case "text": {
        if (command.content === "/help" || command.content === "help") {
          printHelp();
          break;
        }
        console.log(
          "\u001B[90mVoice mode active. Speak to the interviewer or type /quit to end.\u001B[0m",
        );
        break;
      }
    }
  }
}

async function dispatchVoiceTool(
  toolName: string,
  argsJson: string,
  opts: {
    session: Session;
    question: LeetcodeQuestion;
    solutionPath: string;
    logger: Logger;
  },
): Promise<string> {
  const { session, question, solutionPath, logger: toolLogger } = opts;
  let input: Record<string, unknown> = {};
  try {
    const parsed = z.record(z.string(), z.unknown()).safeParse(JSON.parse(argsJson));
    if (parsed.success) {
      input = parsed.data;
    }
  } catch {
    // empty args
  }

  const currentPart = question.parts.find(
    (p) => p.partNumber === session.metadata.currentPart,
  );

  switch (toolName) {
    case "run_tests": {
      if (!currentPart) return "No current part found.";
      session.metadata.testsRun++;
      const result = await runTests(solutionPath, currentPart.testCases);

      insertEvent(session.db, "test_run", {
        passed: result.passed,
        failed: result.failed,
        total: result.total,
        compileError: result.compileError,
      });

      if (result.compileError !== null) {
        return `Compilation failed:\n${result.compileError}`;
      }

      const details = result.results
        .map((r, i) => {
          if (r.timedOut) return `Test ${String(i + 1)}: TIMEOUT`;
          if (r.passed) return `Test ${String(i + 1)}: PASSED`;
          return `Test ${String(i + 1)}: FAILED (expected "${r.expected}", got "${r.actual}")`;
        })
        .join("\n");

      return `Test results: ${String(result.passed)}/${String(result.total)} passed\n\n${details}`;
    }

    case "reveal_next_part": {
      const nextPartNum = session.metadata.currentPart + 1;
      const nextPart = question.parts.find((p) => p.partNumber === nextPartNum);

      if (!nextPart) {
        return "No more parts -- this is the final part of the problem.";
      }

      session.metadata.currentPart = nextPartNum;
      await updateProblemForNewPart(session.workspacePath, question, nextPartNum);

      insertEvent(session.db, "part_revealed", {
        partNumber: nextPartNum,
        totalParts: question.parts.length,
        reason: input["reason"],
      });

      toolLogger.info("part_revealed", { partNumber: nextPartNum });

      return `Advanced to part ${String(nextPartNum)}/${String(question.parts.length)}. Present the new part: "${nextPart.prompt}"`;
    }

    case "give_hint": {
      if (!currentPart) return "No current part found.";
      const level = typeof input["level"] === "string" ? input["level"] : "subtle";
      const availableHints = currentPart.hints.filter((h) => h.level === level);
      const hintIndex = Math.min(session.metadata.hintsGiven, availableHints.length - 1);
      const hint = availableHints[Math.max(hintIndex, 0)];

      session.metadata.hintsGiven++;

      insertEvent(session.db, "hint_given", {
        level,
        hintIndex: session.metadata.hintsGiven,
        partNumber: session.metadata.currentPart,
      });

      if (!hint) {
        return `No ${level} hint available. Use your judgment to guide the candidate.`;
      }

      return `Hint (${level}): ${hint.content}\n\nFrame this naturally in conversation.`;
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}

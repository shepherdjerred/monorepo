import type { Config } from "#config";
import type { Session } from "#lib/session/manager.ts";
import type { LeetcodeQuestion } from "#lib/questions/schemas.ts";
import type { Timer } from "#lib/timer/countdown.ts";
import type { Logger } from "#logger";
import { saveSession } from "#lib/session/manager.ts";
import { insertEvent } from "#lib/db/events.ts";
import { insertTranscript } from "#lib/db/transcript.ts";
import { formatReport } from "#lib/report/generate.ts";
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
import { createInterviewSession } from "#lib/ai/session-loop.ts";

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

  // Create session controller (shares tool dispatch and code watching with text mode)
  const interviewSession = createInterviewSession({
    session,
    question,
    timer,
    solutionPath,
    logger: voiceLogger,
    // Voice mode uses Realtime API directly for conversation, no text AI client needed
  });

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

  // Wire up callbacks
  realtimeClient.on({
    onTranscript(transcript, _itemId) {
      voiceLogger.info("user_transcript", { transcript });
      insertTranscript(session.db, "user", transcript, { source: "voice" });
      console.log(`\n\u001B[90mYou: ${transcript}\u001B[0m`);
    },

    onAudioDelta(base64Audio, _responseId) {
      audioManager.gateMicWhileSpeaking(true);
      audioManager.writeSpeakerAudio(base64Audio);
    },

    onAudioDone(_responseId) {
      audioManager.flushSpeaker();
      audioManager.gateMicWhileSpeaking(false);
      consecutiveWsFailures = 0;
    },

    onFunctionCall(callId, name, args, _itemId) {
      voiceLogger.info("voice_tool_call", { name, args });

      void (async () => {
        const result = await interviewSession.handleToolCall(name, args);
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

  // Watch solution file for changes and push code context to Realtime via session.update
  let lastSentCodeSnapshot: string | undefined;
  const codeWatchInterval = setInterval(() => {
    void (async () => {
      try {
        const codeSnapshot = await readSolutionSafe(solutionPath);
        if (codeSnapshot === lastSentCodeSnapshot) return; // No change, skip update
        lastSentCodeSnapshot = codeSnapshot;

        const updatedConfig = buildRealtimeSessionConfig({
          model: config.realtimeModel,
          voice: config.realtimeVoice,
          question,
          currentPart: question.parts.find(
            (p) => p.partNumber === session.metadata.currentPart,
          ) ?? currentPart,
          totalParts: question.parts.length,
          timerDisplay: timer.getDisplayTime(),
          hintsGiven: session.metadata.hintsGiven,
          testsRun: session.metadata.testsRun,
          tools,
          codeSnapshot,
        });
        realtimeClient.sendSessionUpdate(updatedConfig);
      } catch {
        // File may not exist yet
      }
    })();
  }, 5000);

  // Slash command loop (runs alongside voice)
  await handleVoiceCommands(rl, {
    fallbackTriggered: () => fallbackTriggered,
    onQuit: async () => {
      clearInterval(codeWatchInterval);
      audioManager.stopAll();
      realtimeClient.disconnect();

      const report = await interviewSession.close();
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

async function readSolutionSafe(solutionPath: string): Promise<string | undefined> {
  try {
    const code = await Bun.file(solutionPath).text();
    return code.trim() === "" ? undefined : code;
  } catch {
    return undefined;
  }
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

import {
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
} from "@discordjs/voice";
import { loggers } from "../utils/index.js";
import {
  getAudioBuffer,
  clearAudioBuffer,
  appendAudioChunk,
  cleanupInactiveBuffers,
} from "./audio-buffer.js";
import {
  updateVoiceActivity,
  shouldProcessSpeech,
  resetVoiceActivity,
  cleanupInactiveStates,
} from "./voice-activity.js";
import { transcribeAudio } from "./speech-to-text.js";
import { generateShortSpeech } from "./text-to-speech.js";
import { createVoiceCommand, expandCommandShortcut } from "./command-handler.js";
import { Readable } from "node:stream";
import { withSpan, captureException } from "../observability/index.js";

const logger = loggers.voice.child("receiver");

type VoiceCommandHandler = (
  command: string,
  userId: string,
  guildId: string,
  channelId: string,
) => Promise<string>;

let commandHandler: VoiceCommandHandler | null = null;

export function setVoiceCommandHandler(handler: VoiceCommandHandler): void {
  commandHandler = handler;
}

const activeReceivers = new Map<string, boolean>();

export async function startVoiceReceiver(guildId: string): Promise<boolean> {
  const connection = getVoiceConnection(guildId);
  if (!connection) {
    logger.warn("No voice connection for guild", { guildId });
    return false;
  }

  if (activeReceivers.get(guildId)) {
    logger.debug("Voice receiver already active", { guildId });
    return true;
  }

  try {
    // Wait for the connection to be ready
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

    const receiver = connection.receiver;
    activeReceivers.set(guildId, true);

    // Listen for speaking events and subscribe to audio
    receiver.speaking.on("start", (userId) => {
      updateVoiceActivity(userId, true);

      // Subscribe to audio stream from this user
      const audioStream = receiver.subscribe(userId, {
        end: {
          behavior: 1, // EndBehaviorType.AfterSilence
          duration: 1500,
        },
      });

      audioStream.on("data", (chunk: Buffer) => {
        appendAudioChunk(userId, chunk);
      });

      audioStream.on("end", () => {
        logger.debug("Audio stream ended for user", { userId });
      });

      audioStream.on("error", (error: Error) => {
        logger.error("Audio stream error", error, { userId });
      });
    });

    receiver.speaking.on("end", (userId) => {
      updateVoiceActivity(userId, false);

      // Check if we should process this speech
      if (shouldProcessSpeech(userId)) {
        void processUserSpeech(userId, guildId);
      }
    });

    // Connection status handling
    connection.on(VoiceConnectionStatus.Ready, () => {
      logger.info("Voice receiver ready", { guildId });
    });

    connection.on(VoiceConnectionStatus.Disconnected, () => {
      activeReceivers.delete(guildId);
      logger.info("Voice receiver disconnected", { guildId });
    });

    logger.info("Started voice receiver", { guildId });
    return true;
  } catch (error) {
    logger.error("Failed to start voice receiver", error as Error, { guildId });
    return false;
  }
}

export function stopVoiceReceiver(guildId: string): void {
  activeReceivers.delete(guildId);
  logger.info("Stopped voice receiver", { guildId });
}

async function processUserSpeech(userId: string, guildId: string): Promise<void> {
  const audioBuffer = getAudioBuffer(userId);
  if (!audioBuffer || audioBuffer.length === 0) {
    resetVoiceActivity(userId);
    return;
  }

  const context = { guildId, userId, operation: "voice.processUserSpeech" };

  await withSpan("voice.processUserSpeech", context, async (span) => {
    span.setAttribute("audio.buffer_size", audioBuffer.length);

    try {
      // Transcribe the audio
      const transcription = await withSpan("voice.transcribe", context, async (transcribeSpan) => {
        const result = await transcribeAudio(audioBuffer);
        transcribeSpan.setAttribute("transcription.length", result.length);
        return result;
      });
      logger.debug("Transcribed speech", { userId, text: transcription });

      if (!transcription || transcription.trim().length === 0) {
        span.setAttribute("transcription.empty", true);
        return;
      }

      // Check for voice command
      const connection = getVoiceConnection(guildId);
      const channelId = connection?.joinConfig.channelId ?? "";

      const voiceCommand = createVoiceCommand(
        userId,
        guildId,
        channelId,
        transcription,
      );

      if (voiceCommand && commandHandler) {
        const expandedCommand = expandCommandShortcut(voiceCommand.command);
        span.setAttribute("command.detected", true);
        span.setAttribute("command.text", expandedCommand);
        logger.info("Processing voice command", {
          userId,
          command: expandedCommand,
        });

        try {
          const response = await commandHandler(
            expandedCommand,
            userId,
            guildId,
            channelId,
          );

          // Send response via TTS
          await withSpan("voice.tts", context, async () => {
            await playTTSResponse(guildId, response);
          });
          logger.info("Voice command response played", { response: response.slice(0, 100) });
        } catch (error) {
          logger.error("Voice command handler error", error as Error);
          captureException(error as Error, {
            operation: "voice.commandHandler",
            discord: { guildId, userId },
          });
        }
      }
    } catch (error) {
      logger.error("Failed to process speech", error as Error, { userId });
      captureException(error as Error, {
        operation: "voice.processUserSpeech",
        discord: { guildId, userId },
      });
    } finally {
      // Clear buffers
      clearAudioBuffer(userId);
      resetVoiceActivity(userId);
    }
  });
}

// Map to store audio players per guild
const guildAudioPlayers = new Map<string, ReturnType<typeof createAudioPlayer>>();

async function playTTSResponse(guildId: string, text: string): Promise<void> {
  const connection = getVoiceConnection(guildId);
  if (!connection) {
    logger.warn("No voice connection to play TTS", { guildId });
    return;
  }

  try {
    // Generate TTS audio
    const audioBuffer = await generateShortSpeech(text);

    // Get or create audio player for this guild
    let player = guildAudioPlayers.get(guildId);
    if (!player) {
      player = createAudioPlayer();
      guildAudioPlayers.set(guildId, player);
      connection.subscribe(player);
    }

    // Create a readable stream from the buffer
    const audioStream = Readable.from(audioBuffer);

    // Create audio resource from the stream (opus format from OpenAI)
    const resource = createAudioResource(audioStream, {
      inputType: StreamType.OggOpus,
    });

    // Play the audio
    player.play(resource);

    // Wait for the audio to finish
    await new Promise<void>((resolve, reject) => {
      player.once(AudioPlayerStatus.Idle, () => {
        resolve();
      });
      player.once("error", (error: Error) => {
        reject(error);
      });
    });

    logger.debug("TTS playback completed", { guildId });
  } catch (error) {
    logger.error("Failed to play TTS response", error as Error, { guildId });
  }
}

// Cleanup task
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startCleanupTask(): void {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(
    () => {
      cleanupInactiveBuffers(60000); // 1 minute
      cleanupInactiveStates(60000);
    },
    30000, // Run every 30 seconds
  );
}

export function stopCleanupTask(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

export function isReceiverActive(guildId: string): boolean {
  return activeReceivers.get(guildId) ?? false;
}

import type { RealtimeClient, RealtimeCallbacks } from "#lib/voice/realtime.ts";
import type { AudioManager } from "#lib/voice/audio.ts";
import type { Logger } from "#logger";
import {
  createReadline,
  promptUser,
  parseCommand,
  type Command,
} from "./prompt.ts";

export type InputMode = "text" | "voice";

export type InputRouter = {
  mode: InputMode;
  getTextInput: () => Promise<Command>;
  close: () => void;
};

export function createTextRouter(): InputRouter {
  const rl = createReadline();

  return {
    mode: "text",

    async getTextInput() {
      const raw = await promptUser(rl);
      return parseCommand(raw);
    },

    close() {
      rl.close();
    },
  };
}

export type VoiceRouterOptions = {
  realtimeClient: RealtimeClient;
  audioManager: AudioManager;
  logger: Logger;
  onTranscript: (transcript: string) => void;
  onAudioDelta: (base64Audio: string) => void;
  onAudioDone: () => void;
  onFunctionCall: (callId: string, name: string, args: string, itemId: string) => void;
  onResponseDone: (response: unknown) => void;
  onError: (error: { type: string; code: string; message: string }) => void;
};

export function createVoiceRouter(options: VoiceRouterOptions): InputRouter {
  const {
    realtimeClient,
    audioManager,
    logger,
    onTranscript,
    onAudioDelta,
    onAudioDone,
    onFunctionCall,
    onResponseDone,
    onError,
  } = options;

  // Wire up realtime callbacks
  const callbacks: RealtimeCallbacks = {
    onTranscript: (transcript, _itemId) => {
      onTranscript(transcript);
    },

    onAudioDelta: (base64Audio, _responseId) => {
      // Gate mic while speaking to prevent echo
      audioManager.gateMicWhileSpeaking(true);
      audioManager.writeSpeakerAudio(base64Audio);
      onAudioDelta(base64Audio);
    },

    onAudioDone: (_responseId) => {
      // Ungate mic after audio playback completes
      audioManager.gateMicWhileSpeaking(false);
      onAudioDone();
    },

    onFunctionCall: (callId, name, args, itemId) => {
      onFunctionCall(callId, name, args, itemId);
    },

    onResponseDone: (response) => {
      onResponseDone(response);
    },

    onError: (error) => {
      onError(error);
    },

    onSpeechStarted: () => {
      logger.debug("user_speech_started");
    },

    onSpeechStopped: () => {
      logger.debug("user_speech_stopped");
    },
  };

  realtimeClient.on(callbacks);

  // Pipe mic data to realtime
  audioManager.onMicData((pcmBase64) => {
    realtimeClient.sendAudio(pcmBase64);
  });

  // Start audio
  audioManager.startMic();
  audioManager.startSpeaker();

  // Also create a readline for slash commands in voice mode
  const rl = createReadline();

  return {
    mode: "voice",

    async getTextInput() {
      // In voice mode, readline is only used for slash commands
      const raw = await promptUser(rl);
      return parseCommand(raw);
    },

    close() {
      audioManager.stopAll();
      realtimeClient.disconnect();
      rl.close();
    },
  };
}

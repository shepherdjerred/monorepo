export { transcribeAudio } from "./speech-to-text.js";
export { generateSpeech, generateShortSpeech } from "./text-to-speech.js";
export {
  appendAudioChunk,
  getAudioBuffer,
  clearAudioBuffer,
  getLastActivityTime,
  getBufferDurationMs,
  hasAudioData,
  cleanupInactiveBuffers,
  clearAllBuffers,
} from "./audio-buffer.js";
export {
  updateVoiceActivity,
  shouldProcessSpeech,
  resetVoiceActivity,
  getVoiceActivityState,
  isSpeaking,
  getSpeechDurationMs,
  cleanupInactiveStates,
  clearAllStates,
} from "./voice-activity.js";
export {
  containsWakeWord,
  extractCommand,
  createVoiceCommand,
  expandCommandShortcut,
  type VoiceCommand,
} from "./command-handler.js";
export {
  setVoiceCommandHandler,
  startVoiceReceiver,
  stopVoiceReceiver,
  startCleanupTask,
  stopCleanupTask,
  isReceiverActive,
} from "./receiver.js";

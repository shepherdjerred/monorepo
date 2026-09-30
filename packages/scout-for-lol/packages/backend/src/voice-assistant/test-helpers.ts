import type { LocalVoiceModels } from "@shepherdjerred/voice-assistant";

export function fakeLocalVoiceModels(): LocalVoiceModels {
  return {
    runtime: "native",
    createKeywordDetector: () => ({
      accept: () => null,
      reset: () => {
        /* test fake */
      },
      close: () => {
        /* test fake */
      },
    }),
    createVad: () => ({
      accept: () => {
        /* test fake */
      },
      isSpeechActive: () => false,
      hasCompletedSpeech: () => false,
      flush: () => {
        /* test fake */
      },
      reset: () => {
        /* test fake */
      },
      close: () => {
        /* test fake */
      },
    }),
    verifyWakePhrase: () => Promise.resolve({ accepted: false, score: 0 }),
    close: () => Promise.resolve(),
  };
}

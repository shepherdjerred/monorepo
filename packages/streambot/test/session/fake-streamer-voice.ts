/**
 * The voice-shaped half of a fake {@link StreamerLike}, shared by the session and pool suites.
 *
 * Neither suite exercises the voice assistant or the audio mixer — they test session lifecycle and
 * pool acquisition — but `StreamerLike` is a wide interface, so both fakes have to satisfy every
 * voice member to compile. Duplicating that block in two files means every change to the interface
 * is a two-file edit, and the copies drift apart the moment one is updated and the other is not.
 */

const FAKE_USER_ID = "200000000000000000";

export function voiceDisabledStreamerParts() {
  return {
    setVolume: () => Promise.resolve(true),
    openAssistantAudio: () => ({
      send: () => Promise.resolve(),
      setSpeaking: () => {
        /* voice is disabled in this fake */
      },
      close: () => {
        /* voice is disabled in this fake */
      },
    }),
    setAssistantSpeaking: () => Promise.resolve(),
    sendAssistantOpus: () => {
      /* voice is disabled in this fake */
    },
    assistantUserId: () => FAKE_USER_ID,
    assistantDaveReady: () => false,
    setVoiceAudioListener: () => {
      /* voice is disabled in this fake */
    },
    setVoiceReceiveObserver: () => {
      /* voice is disabled in this fake */
    },
    seek: () => Promise.resolve(true),
    userId: () => FAKE_USER_ID,
  };
}

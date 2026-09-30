import type { AssistantAudioSink } from "@shepherdjerred/voice-assistant";

/** Serializes every speech sink onto one guild's Discord voice connection. */
export class SerializedAssistantOutput {
  private tail: Promise<unknown> = Promise.resolve();

  async send(
    createSink: () => AssistantAudioSink,
    pcm24k: Uint8Array,
    firstAudio: () => void,
  ): Promise<void> {
    const previous = this.tail;
    const release = Promise.withResolvers<boolean>();
    this.tail = this.waitForRelease(previous, release.promise);
    await previous;
    try {
      const sink = createSink();
      firstAudio();
      sink.enqueue(pcm24k);
      await sink.finish();
    } finally {
      release.resolve(true);
    }
  }

  async trySend(
    createSink: () => AssistantAudioSink,
    pcm24k: Uint8Array,
    firstAudio: () => void,
  ): Promise<void> {
    try {
      await this.send(createSink, pcm24k, firstAudio);
    } catch {
      // Feedback is best effort after the primary operation has already failed and been logged.
    }
  }

  private async waitForRelease(
    previous: Promise<unknown>,
    release: Promise<boolean>,
  ): Promise<void> {
    await previous;
    await release;
  }
}

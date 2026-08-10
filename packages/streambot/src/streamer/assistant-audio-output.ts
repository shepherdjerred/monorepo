type VolumePlayer = { setVolume: (volume: number) => Promise<boolean> };
type AssistantVoiceConnection = {
  setSpeaking: (speaking: boolean) => void;
  webRtcConn: { sendAudioFrame: (frame: Buffer, frametime: number) => void };
};

/** Normal-voice assistant output plus independent Go Live ducking. */
export class AssistantAudioOutput {
  private desiredVolumePercent = 100;
  private speaking = false;

  constructor(
    private readonly player: () => VolumePlayer | null,
    private readonly voice: () => AssistantVoiceConnection | null | undefined,
  ) {}

  async setVolume(percent: number): Promise<boolean> {
    this.desiredVolumePercent = Math.max(0, percent);
    return this.apply();
  }

  setDesiredVolume(percent: number): void {
    this.desiredVolumePercent = Math.max(0, percent);
  }

  async apply(): Promise<boolean> {
    const player = this.player();
    if (player === null) return false;
    const duck = this.speaking ? 0.2 : 1;
    return player.setVolume((this.desiredVolumePercent / 100) * duck);
  }

  async setSpeaking(speaking: boolean): Promise<void> {
    if (this.speaking === speaking) return;
    this.speaking = speaking;
    voiceDuckTransitionsTotal.inc({ state: speaking ? "ducked" : "restored" });
    this.voice()?.setSpeaking(speaking);
    if (this.player() !== null) await this.apply();
  }

  sendOpus(opus: Uint8Array): void {
    const voice = this.voice();
    if (voice === undefined || voice === null) {
      throw new Error("Cannot send assistant audio without a voice connection");
    }
    voice.webRtcConn.sendAudioFrame(Buffer.from(opus), 20);
  }

  reset(): void {
    this.speaking = false;
  }
}
import { voiceDuckTransitionsTotal } from "@shepherdjerred/streambot/observability/metrics.ts";

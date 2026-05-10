export class AudioMixer {
  private context?: AudioContext;
  private music?: HTMLAudioElement;
  private effect?: HTMLAudioElement;

  async unlock(): Promise<void> {
    this.context ??= new AudioContext();
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
  }

  playMusic(url: string): void {
    this.music?.pause();
    this.music = new Audio(url);
    this.music.loop = true;
    this.music.volume = 0.25;
    void this.music.play().catch(() => {
      // Browser autoplay policies require the next user gesture to unlock audio.
    });
  }

  playEffect(url: string): void {
    this.effect?.pause();
    this.effect = new Audio(url);
    this.effect.volume = 0.35;
    void this.effect.play().catch(() => {
      // Browser autoplay policies require the next user gesture to unlock audio.
    });
  }

  stop(): void {
    this.music?.pause();
    this.effect?.pause();
  }
}

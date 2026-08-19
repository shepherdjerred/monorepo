import type { VoiceReceiveObserver } from "@shepherdjerred/discord-video-stream";
import {
  clearVoiceSessionMetrics,
  initializeVoiceSessionMetrics,
  voiceDaveReady,
  voiceDaveRequired,
  voiceDecodedSecondsTotal,
  voiceDuckDurationSeconds,
  voiceDuckState,
  voiceLastDecodedTimestampSeconds,
  voiceLastPacketTimestampSeconds,
  voiceReceiveBytesTotal,
  voiceReceivePacketsTotal,
  voiceReceiveReady,
  voiceSpeakingSpeakers,
  voiceTurnAgeSeconds,
} from "@shepherdjerred/streambot/observability/voice-diagnostic-metrics.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("voice-session");
const QUIET_AFTER_MS = 5 * 60 * 1000;
const SAMPLE_RATE = 16_000;

export type VoiceSessionTelemetryIdentity = {
  readonly guildId: string;
  readonly channelId: string;
};

/** Per-session live gauges and bounded receive observer. IDs never reach counters/histograms. */
export class VoiceSessionTelemetry {
  readonly receiveObserver: VoiceReceiveObserver;
  private readonly labels: { guild_id: string; channel_id: string };
  private readonly speaking = new Set<string>();
  private readonly startedAtMs = Date.now();
  private lastPacketAtMs: number | null = null;
  private quietLogged = false;
  private turnStartedAtMs: number | null = null;
  private duckStartedAtMs: number | null = null;
  private closed = false;
  private readonly ticker: ReturnType<typeof setInterval>;

  constructor(private readonly identity: VoiceSessionTelemetryIdentity) {
    this.labels = {
      guild_id: identity.guildId,
      channel_id: identity.channelId,
    };
    initializeVoiceSessionMetrics(identity);
    this.receiveObserver = {
      onPacket: (observation) => {
        voiceReceivePacketsTotal.inc({ outcome: observation.outcome });
        voiceReceiveBytesTotal.inc(
          { outcome: observation.outcome },
          observation.packetBytes,
        );
        const now = Date.now();
        this.lastPacketAtMs = now;
        voiceLastPacketTimestampSeconds.set(this.labels, now / 1000);
        if (this.quietLogged) {
          this.quietLogged = false;
          log.info(
            "Discord voice ingress recovered after inactivity",
            identity,
          );
        }
      },
      onSpeaking: (observation) => {
        if (observation.state === "mapped" && observation.speaking) {
          this.speaking.add(observation.userId);
        } else {
          this.speaking.delete(observation.userId);
        }
        voiceSpeakingSpeakers.set(this.labels, this.speaking.size);
      },
      onDaveState: (observation) => {
        voiceDaveRequired.set(this.labels, observation.required ? 1 : 0);
        voiceDaveReady.set(this.labels, observation.ready ? 1 : 0);
      },
      onReceiveState: (observation) => {
        voiceReceiveReady.set(this.labels, observation.ready ? 1 : 0);
      },
    };
    this.ticker = setInterval(() => {
      this.tick();
    }, 1000);
  }

  decoded(sampleCount: number): void {
    const now = Date.now();
    voiceDecodedSecondsTotal.inc(sampleCount / SAMPLE_RATE);
    voiceLastDecodedTimestampSeconds.set(this.labels, now / 1000);
  }

  turnStarted(): void {
    this.turnStartedAtMs = Date.now();
    voiceTurnAgeSeconds.set(this.labels, 0);
  }

  turnFinished(): void {
    this.turnStartedAtMs = null;
    voiceTurnAgeSeconds.set(this.labels, 0);
  }

  duckChanged(ducked: boolean, outcome = "completed"): void {
    if (ducked) {
      this.duckStartedAtMs ??= Date.now();
      voiceDuckState.set(this.labels, 1);
      return;
    }
    if (this.duckStartedAtMs !== null) {
      voiceDuckDurationSeconds.observe(
        { outcome },
        Math.max(0, Date.now() - this.duckStartedAtMs) / 1000,
      );
      this.duckStartedAtMs = null;
    }
    voiceDuckState.set(this.labels, 0);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.ticker);
    this.speaking.clear();
    clearVoiceSessionMetrics(this.identity);
  }

  private tick(): void {
    const now = Date.now();
    if (this.turnStartedAtMs !== null) {
      voiceTurnAgeSeconds.set(
        this.labels,
        Math.max(0, now - this.turnStartedAtMs) / 1000,
      );
    }
    const ingressReference = this.lastPacketAtMs ?? this.startedAtMs;
    if (!this.quietLogged && now - ingressReference >= QUIET_AFTER_MS) {
      this.quietLogged = true;
      log.info("Discord voice ingress has been quiet for five minutes", {
        ...this.identity,
        lastPacketAtMs: this.lastPacketAtMs,
        diagnosticOnly: true,
      });
    }
  }
}

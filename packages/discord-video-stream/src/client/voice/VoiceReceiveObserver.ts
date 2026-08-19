export type VoiceReceivePacketOutcome =
  | "accepted"
  | "unmapped-ssrc"
  | "self"
  | "dave-not-ready"
  | "decrypt-error"
  | "malformed";

export type VoiceReceivePacketObservation = {
  outcome: VoiceReceivePacketOutcome;
  packetBytes: number;
  ssrc?: number;
  userId?: string;
};

export type VoiceSpeakingObservation = {
  state: "mapped" | "disconnected";
  userId: string;
  ssrc: number;
  speaking: boolean;
};

export type VoiceDaveObservation = {
  protocolVersion: number;
  required: boolean;
  ready: boolean;
};

export type VoiceReceiveStateObservation = {
  ready: boolean;
};

/**
 * Read-only hooks for receive-path telemetry. Implementations must keep callbacks bounded; the
 * transport isolates observer errors so diagnostics can never change packet delivery.
 */
export type VoiceReceiveObserver = {
  onPacket?(observation: VoiceReceivePacketObservation): void;
  onSpeaking?(observation: VoiceSpeakingObservation): void;
  onDaveState?(observation: VoiceDaveObservation): void;
  onReceiveState?(observation: VoiceReceiveStateObservation): void;
};

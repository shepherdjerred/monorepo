import type { ReplayObservations } from "@scout-for-lol/replay/observations";
import type {
  ReplayPacketReader,
  ReplayRawPacket,
} from "@scout-for-lol/replay/packets";

export type ReplayTurretState = {
  keyframeTimeSeconds: number;
  turrets: {
    context: number;
    defendingPartition: 0 | 1 | null;
    keyframeState: "alive" | "dead" | "unknown-missing" | "unknown-same-time";
    seekState: "alive" | "dead";
  }[];
};

export type ReadReplayTurretState = (
  timeSeconds: number,
  options?: { signal?: AbortSignal },
) => ReplayTurretState | null;

export function createTurretSnapshotCollector(): {
  observeRawPacket: (packet: Omit<ReplayRawPacket, "timeSeconds">) => void;
  finish: (
    packetReader: ReplayPacketReader,
    observations: Pick<ReplayObservations, "turrets">,
  ) => ReadReplayTurretState;
};

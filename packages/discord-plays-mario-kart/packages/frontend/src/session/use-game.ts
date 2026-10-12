// The live game connection: socket state, the session status, who holds which
// seat, this browser's own seat, and controller round-trip time.
import { useCallback, useEffect, useState } from "react";
import type {
  DiscordUser,
  LatencyReportRequest,
  Response,
  SeatClaimRequest,
  SeatDeniedResponse,
  SeatReleaseRequest,
  Status,
} from "@discord-plays-mario-kart/common";
import { socket } from "#src/socket.ts";
import { feedTelemetry } from "#src/feed-telemetry.ts";

const PING_INTERVAL_MS = 2000;
/** The server pushes status changes too; polling covers voice moves it misses. */
const STATUS_INTERVAL_MS = 3000;

export type SeatDenial = {
  readonly reason: SeatDeniedResponse["value"]["reason"];
  /** Distinguishes two identical denials in a row, so each one shows. */
  readonly at: number;
};

export type GameConnection = {
  readonly connected: boolean;
  readonly status: Status | undefined;
  readonly seats: readonly (DiscordUser | null)[];
  readonly seat: number | null;
  readonly rttMs: number | undefined;
  readonly denial: SeatDenial | undefined;
  readonly claim: (seat: number) => void;
  readonly release: () => void;
  readonly dismissDenial: () => void;
};

const EMPTY_SEATS: readonly (DiscordUser | null)[] = [null, null, null, null];

function sendPing(onRtt: (rttMs: number) => void): void {
  const start = Date.now();
  socket.emit("ping", (serverNowMs: unknown) => {
    const receivedAt = Date.now();
    const rtt = receivedAt - start;
    onRtt(rtt);
    if (typeof serverNowMs === "number") {
      feedTelemetry.recordPing(start, receivedAt, serverNowMs);
    }
    // Report the measurements so the server can export them as metrics. The
    // RTT is timed client-side, so it has no clock-skew question; glass
    // samples are offset-corrected by feedTelemetry.
    const feed = feedTelemetry.drain();
    const report: LatencyReportRequest = {
      kind: "latency-report",
      rttMs: rtt,
      ...(feed.glassMs.length > 0 ? { glassMs: feed.glassMs } : {}),
      ...(feed.decoderResets > 0 ? { decoderResets: feed.decoderResets } : {}),
    };
    socket.emit("request", report);
  });
}

function requestStatus(): void {
  socket.emit("request", { kind: "status" });
}

export function useGame(): GameConnection {
  const [connected, setConnected] = useState(socket.connected);
  const [status, setStatus] = useState<Status>();
  const [seats, setSeats] =
    useState<readonly (DiscordUser | null)[]>(EMPTY_SEATS);
  const [seat, setSeat] = useState<number | null>(null);
  const [rttMs, setRttMs] = useState<number>();
  const [denial, setDenial] = useState<SeatDenial>();

  useEffect(() => {
    const onResponse = (response: Response) => {
      switch (response.kind) {
        case "seat": {
          setSeat(response.value.seat);
          break;
        }
        case "seats": {
          setSeats(response.value.seats);
          break;
        }
        case "status": {
          setStatus(response.value);
          break;
        }
        case "seat-denied": {
          setDenial({ reason: response.value.reason, at: Date.now() });
          break;
        }
        case "leaderboard":
        case "player-stats":
        case "recent-races":
        case "screenshot": {
          break;
        }
      }
    };
    const onConnect = () => {
      setConnected(true);
      requestStatus();
    };
    // The server frees a seat when its socket drops, so a reconnect starts
    // unseated; showing the old seat would send input nobody accepts.
    const onDisconnect = () => {
      setConnected(false);
      setSeat(null);
      setRttMs(undefined);
    };
    socket.on("response", onResponse);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    if (socket.connected) {
      requestStatus();
    }
    const ping = setInterval(() => {
      if (socket.connected) {
        sendPing(setRttMs);
      }
    }, PING_INTERVAL_MS);
    const statusPoll = setInterval(() => {
      if (socket.connected) {
        requestStatus();
      }
    }, STATUS_INTERVAL_MS);
    return () => {
      socket.off("response", onResponse);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      clearInterval(ping);
      clearInterval(statusPoll);
    };
  }, []);

  const claim = useCallback((requested: number) => {
    const request: SeatClaimRequest = { kind: "seat-claim", seat: requested };
    socket.emit("request", request);
  }, []);
  const release = useCallback(() => {
    const request: SeatReleaseRequest = { kind: "seat-release" };
    socket.emit("request", request);
    setSeat(null);
  }, []);
  const dismissDenial = useCallback(() => {
    setDenial(undefined);
  }, []);

  return {
    connected,
    status,
    seats,
    seat,
    rttMs,
    denial,
    claim,
    release,
    dismissDenial,
  };
}

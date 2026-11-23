import {
  MAX_PUBLIC_REPLAY_BYTES,
  type PublicReplayDescriptor,
} from "@scout-for-lol/domain/artifacts/public-replay.ts";
import type {
  CreateReplaySessionOptions,
  ReplaySession,
} from "@scout-for-lol/replay";
import { replayContentPath } from "./api.ts";

export type ReplaySessionFactory = (
  options: CreateReplaySessionOptions,
) => Promise<ReplaySession>;

export const createBrowserReplaySession: ReplaySessionFactory = async (
  options,
) => {
  const { createReplaySession } = await import("@scout-for-lol/replay");
  return createReplaySession(options);
};

type ReplayFetcher = (input: string, init: RequestInit) => Promise<Response>;
export type ReplayByteSource = { url: string; bytes: number; sha256: string };

/** Buffer only the descriptor's validated size and cancel oversized or abandoned reads. */
export async function loadVerifiedReplaySource(
  replay: ReplayByteSource,
  signal: AbortSignal,
  fetcher: ReplayFetcher = fetch,
): Promise<ArrayBuffer> {
  if (
    !Number.isSafeInteger(replay.bytes) ||
    replay.bytes <= 0 ||
    replay.bytes > MAX_PUBLIC_REPLAY_BYTES
  )
    throw new Error("This replay exceeds the supported download size.");
  signal.throwIfAborted();
  const response = await fetcher(replay.url, {
    credentials: "omit",
    signal,
  });
  if (!response.ok)
    throw new Error("Scout could not download this replay. Please try again.");
  if (response.body === null)
    throw new Error("The replay download was incomplete. Please try again.");
  const reader = response.body.getReader();
  const cancel = async (reason?: unknown) => {
    try {
      await reader.cancel(reason);
    } catch {
      // A failed read reports its original error; cleanup must not replace it.
    }
  };
  const abortRead = () => {
    void cancel(signal.reason);
  };
  signal.addEventListener("abort", abortRead, { once: true });
  const bytes = new Uint8Array(replay.bytes);
  let offset = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const result = await reader.read();
      signal.throwIfAborted();
      if (result.done) break;
      if (offset + result.value.byteLength > bytes.byteLength) {
        throw new Error("The replay download exceeded its expected size.");
      }
      bytes.set(result.value, offset);
      offset += result.value.byteLength;
    }
  } catch (error_) {
    await cancel(error_);
    throw error_;
  } finally {
    signal.removeEventListener("abort", abortRead);
    reader.releaseLock();
  }
  if (offset !== replay.bytes)
    throw new Error("The replay download was incomplete. Please try again.");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const sha256 = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (sha256 !== replay.sha256)
    throw new Error(
      "The replay download could not be verified. Please try again.",
    );
  signal.throwIfAborted();
  return bytes.buffer;
}

export function loadReplayBytes(
  replay: PublicReplayDescriptor,
  signal: AbortSignal,
  fetcher?: ReplayFetcher,
): Promise<ArrayBuffer> {
  return loadVerifiedReplaySource(
    {
      url: replayContentPath(replay.replayId),
      bytes: replay.bytes,
      sha256: replay.sha256,
    },
    signal,
    fetcher,
  );
}

export async function claimReplaySession(
  pending: Promise<ReplaySession>,
  signal: AbortSignal,
): Promise<ReplaySession> {
  const session = await pending;
  if (signal.aborted) {
    session.dispose();
    signal.throwIfAborted();
  }
  return session;
}

/** Ownership remains with the caller even if a slow engine resolves after abort. */
export async function loadPublicReplaySession(options: {
  replay: PublicReplayDescriptor;
  canvas: HTMLCanvasElement;
  signal: AbortSignal;
  factory: ReplaySessionFactory;
  fetcher?: ReplayFetcher;
}): Promise<ReplaySession> {
  const { replay, signal } = options;
  if (replay.playback.status !== "available")
    throw new Error("This replay is not ready for playback.");
  if (
    replay.durationSeconds === null ||
    !Number.isFinite(replay.durationSeconds) ||
    replay.durationSeconds <= 0
  )
    throw new Error("This replay has no validated full-match duration.");
  const bytes = await loadReplayBytes(replay, signal, options.fetcher);
  const session = await claimReplaySession(
    options.factory({
      canvas: options.canvas,
      replay: bytes,
      manifestUrl: replay.playback.package.url,
      manifestSha256: replay.playback.package.sha256,
      signal,
    }),
    signal,
  );
  try {
    const duration = session.getState().durationSeconds;
    // The container's gameLength is an integer number of milliseconds. Allow
    // one source unit plus floating-point rounding, never a truncated preview.
    const tolerance =
      0.001 +
      Number.EPSILON * Math.max(Math.abs(duration), replay.durationSeconds);
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      Math.abs(duration - replay.durationSeconds) > tolerance
    )
      throw new Error(
        "The rendering package did not present this replay's validated full duration.",
      );
    signal.throwIfAborted();
    return session;
  } catch (error_) {
    session.dispose();
    throw error_;
  }
}

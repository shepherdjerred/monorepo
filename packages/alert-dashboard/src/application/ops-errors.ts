import type { DigestRunKey } from "#application/ports";

/** The collector has never delivered a snapshot, so there is nothing to show. */
export class SnapshotUnavailableError extends Error {
  constructor() {
    super("No ops snapshot has been ingested yet");
    this.name = "SnapshotUnavailableError";
  }
}

export class ServiceNotFoundError extends Error {
  constructor(id: string) {
    super(`Unknown service: ${id}`);
    this.name = "ServiceNotFoundError";
  }
}

/** Prometheus (or another read upstream) failed; the request cannot be answered. */
export class UpstreamUnavailableError extends Error {
  constructor(
    readonly upstream: string,
    message: string,
  ) {
    super(`${upstream}: ${message}`);
    this.name = "UpstreamUnavailableError";
  }
}

export class DigestInProgressError extends Error {
  constructor(key: DigestRunKey) {
    super(`Digest ${key.kind} ${key.periodKey} is already being sent`);
    this.name = "DigestInProgressError";
  }
}

export class DigestMailerUnconfiguredError extends Error {
  constructor() {
    super("Digest email is enabled but Postal is not configured");
    this.name = "DigestMailerUnconfiguredError";
  }
}

export class DigestSendError extends Error {
  constructor(key: DigestRunKey, reason: string) {
    super(`Digest ${key.kind} ${key.periodKey} failed: ${reason}`);
    this.name = "DigestSendError";
  }
}

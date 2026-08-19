import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import {
  voiceCaptureDropsTotal,
  voiceCaptureQueueBytes,
  voiceCaptureQueueDepth,
  voiceCaptureUploadDurationSeconds,
  voiceCaptureUploadsTotal,
} from "@shepherdjerred/streambot/observability/voice-diagnostic-metrics.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import type { VoiceCaptureManifest } from "@shepherdjerred/streambot/voice/capture-manifest.ts";

const log = logger.child("voice-capture-store");
const MAX_RETAINED_BYTES = 128 * 1024 * 1024;
const WORKER_COUNT = 2;

export type CaptureObject = {
  readonly key: string;
  readonly body: Uint8Array;
  readonly contentType: string;
};

export type CaptureUploadJob = {
  readonly captureId: string;
  readonly audio: readonly CaptureObject[];
  readonly manifestKey: string;
  readonly manifest: VoiceCaptureManifest;
};

export type CaptureObjectStore = {
  readonly put: (object: CaptureObject) => Promise<void>;
  readonly delete: (key: string) => Promise<void>;
  readonly close?: () => void;
};

export function createS3CaptureObjectStore(
  capture: Config["voice"]["capture"],
): CaptureObjectStore | null {
  if (!capture.enabled) return null;
  if (capture.bucket === undefined || capture.endpoint === undefined) {
    throw new Error("Validated voice capture configuration is incomplete");
  }
  const client = new S3Client({
    endpoint: capture.endpoint,
    region: capture.region,
    forcePathStyle: capture.forcePathStyle,
    maxAttempts: 3,
  });
  return {
    put: async (object) => {
      await client.send(
        new PutObjectCommand({
          Bucket: capture.bucket,
          Key: object.key,
          Body: object.body,
          ContentType: object.contentType,
        }),
      );
    },
    delete: async (key) => {
      await client.send(
        new DeleteObjectCommand({
          Bucket: capture.bucket,
          Key: key,
        }),
      );
    },
    close: () => {
      client.destroy();
    },
  };
}

type QueuedJob = {
  readonly job: CaptureUploadJob;
  readonly bytes: number;
};

/** Bounded, non-blocking voice capture uploads. The manifest is always the final object. */
export class VoiceCaptureUploadQueue {
  private readonly queued: QueuedJob[] = [];
  private readonly idleWaiters: (() => void)[] = [];
  private activeWorkers = 0;
  private retainedBytes = 0;
  private accepting = true;
  private readonly maxRetainedBytes: number;
  private readonly workerCount: number;

  constructor(
    private readonly store: CaptureObjectStore | null,
    limits: {
      readonly maxRetainedBytes?: number;
      readonly workerCount?: number;
    } = {},
  ) {
    this.maxRetainedBytes = limits.maxRetainedBytes ?? MAX_RETAINED_BYTES;
    this.workerCount = limits.workerCount ?? WORKER_COUNT;
  }

  get enabled(): boolean {
    return this.store !== null;
  }

  enqueue(job: CaptureUploadJob): boolean {
    if (this.store === null) return false;
    const manifestBytes = new TextEncoder().encode(
      JSON.stringify(job.manifest),
    );
    const bytes =
      manifestBytes.byteLength +
      job.audio.reduce((total, object) => total + object.body.byteLength, 0);
    if (!this.accepting) {
      voiceCaptureDropsTotal.inc({ reason: "shutdown" });
      return false;
    }
    if (bytes > this.maxRetainedBytes) {
      voiceCaptureDropsTotal.inc({ reason: "capture-too-large" });
      log.warn("voice capture exceeds queue capacity", {
        captureId: job.captureId,
        bytes,
      });
      return false;
    }
    if (this.retainedBytes + bytes > this.maxRetainedBytes) {
      voiceCaptureDropsTotal.inc({ reason: "queue-full" });
      log.warn("voice capture queue full", {
        captureId: job.captureId,
        bytes,
        retainedBytes: this.retainedBytes,
      });
      return false;
    }
    this.queued.push({ job, bytes });
    this.retainedBytes += bytes;
    this.updateGauges();
    this.pump();
    return true;
  }

  async shutdown(): Promise<void> {
    this.accepting = false;
    await this.flush();
    this.store?.close?.();
  }

  async flush(): Promise<void> {
    if (this.queued.length === 0 && this.activeWorkers === 0) return;
    await new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  private pump(): void {
    while (this.activeWorkers < this.workerCount) {
      const queued = this.queued.shift();
      if (queued === undefined) break;
      this.activeWorkers += 1;
      void this.runUpload(queued);
    }
    this.updateGauges();
  }

  private async runUpload(queued: QueuedJob): Promise<void> {
    try {
      await this.upload(queued);
    } finally {
      this.activeWorkers -= 1;
      this.retainedBytes -= queued.bytes;
      this.updateGauges();
      this.pump();
      this.settleIdle();
    }
  }

  private async upload(queued: QueuedJob): Promise<void> {
    const startedAt = performance.now();
    let outcome = "success";
    const store = this.store;
    try {
      if (store === null) throw new Error("Capture store is disabled");
      const audioResults = await Promise.allSettled(
        queued.job.audio.map(async (object) => {
          await store.put(object);
        }),
      );
      const failedAudio = audioResults.find(
        (result) => result.status === "rejected",
      );
      if (failedAudio !== undefined) throw failedAudio.reason;
      const manifestBody = new TextEncoder().encode(
        JSON.stringify(queued.job.manifest, null, 2),
      );
      await store.put({
        key: queued.job.manifestKey,
        body: manifestBody,
        contentType: "application/json",
      });
      voiceCaptureUploadsTotal.inc({ outcome: "success" });
      log.info("voice capture committed", {
        captureId: queued.job.captureId,
        manifestKey: queued.job.manifestKey,
      });
    } catch (error) {
      outcome = "failure";
      if (store !== null) {
        // Delete every key owned by this unique capture, not only puts whose responses succeeded:
        // an exhausted request can still have reached S3 before its response was lost.
        const cleanupKeys = [
          ...queued.job.audio.map((object) => object.key),
          queued.job.manifestKey,
        ];
        const cleanupResults = await Promise.allSettled(
          cleanupKeys.map((key) => store.delete(key)),
        );
        const cleanupFailures = cleanupResults.filter(
          (result) => result.status === "rejected",
        );
        if (cleanupFailures.length > 0) {
          log.error("voice capture orphan cleanup failed", {
            captureId: queued.job.captureId,
            failedObjects: cleanupFailures.length,
          });
        }
      }
      voiceCaptureUploadsTotal.inc({ outcome: "failure" });
      log.error("voice capture upload failed", {
        captureId: queued.job.captureId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      voiceCaptureUploadDurationSeconds.observe(
        { outcome },
        (performance.now() - startedAt) / 1000,
      );
      for (const object of queued.job.audio) object.body.fill(0);
    }
  }

  private updateGauges(): void {
    voiceCaptureQueueDepth.set(this.queued.length + this.activeWorkers);
    voiceCaptureQueueBytes.set(this.retainedBytes);
  }

  private settleIdle(): void {
    if (this.queued.length > 0 || this.activeWorkers > 0) return;
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }
}

import {
  SnapshotSchema,
  type Snapshot,
} from "@shepherdjerred/ops-model/snapshot.ts";

/**
 * The dashboard answers with the snapshot plus its own read-time fields
 * (`stale`, `receivedAt`, cursor ids). TRMNL keeps no cursor, so it asks
 * without a consumer, validates the snapshot contract, and drops the extras;
 * the caller applies the freshness policy itself.
 */
const SnapshotBodySchema = SnapshotSchema.strip();

/** Reads the latest ops snapshot the ops dashboard stored from Temporal. */
export class OpsSnapshotClient {
  constructor(private readonly baseUrl: string) {}

  async getSnapshot(): Promise<Snapshot> {
    const response = await fetch(
      new URL("/api/v1/ops/snapshot", this.baseUrl),
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) {
      throw new Error(
        `Ops snapshot request failed: ${response.status.toString()}`,
      );
    }
    return SnapshotBodySchema.parse(await response.json());
  }
}

import type { z } from "zod";
import {
  type BlockPos,
  type Box,
  CommandResponseSchema,
  RegionReadResponseSchema,
  SnapshotSchema,
  SnapshotRestoreResponseSchema,
  WePasteResponseSchema,
  WeRunResponseSchema,
  type WeOp,
} from "#protocol/bridge.ts";
import {
  ErrorResponseSchema,
  SandboxDownResponseSchema,
  SandboxListResponseSchema,
  SandboxSummarySchema,
  SnapshotBytesResponseSchema,
  type SandboxCreateRequest,
} from "#protocol/ipc.ts";
import { type LiveWriteFlags, liveWriteHeaders } from "#protocol/live.ts";
import { SOCKET_PATH } from "#protocol/paths.ts";

/**
 * The build CLI's view of the daemon: the same unix-socket routes toolkit
 * uses, so the daemon stays the single owner of sandboxes and their tokens.
 */
export class DaemonClient {
  private readonly writeHeaders: Record<string, string>;

  /** `flags` ride every request as headers; the daemon reads them for live writes. */
  constructor(
    private readonly socket = SOCKET_PATH,
    flags: LiveWriteFlags = {},
  ) {
    this.writeHeaders = liveWriteHeaders(flags);
  }

  private async request<Schema extends z.ZodType>(
    schema: Schema,
    method: "GET" | "POST" | "DELETE",
    route: string,
    body?: unknown,
  ): Promise<z.infer<Schema>> {
    let response: Response;
    try {
      response = await fetch(`http://daemon${route}`, {
        unix: this.socket,
        method,
        headers: {
          ...this.writeHeaders,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new Error(
        `Could not reach the mc daemon (${error instanceof Error ? error.message : String(error)}). Start it with: toolkit mc daemon start`,
        { cause: error },
      );
    }
    const json: unknown = await response.json();
    if (!response.ok) {
      const parsed = ErrorResponseSchema.safeParse(json);
      throw new Error(parsed.success ? `mc daemon: ${parsed.data.error}` : `mc daemon HTTP ${response.status.toString()}`);
    }
    return schema.parse(json);
  }

  private target(id: string, action: string): string {
    return `/targets/${encodeURIComponent(id)}/${action}`;
  }

  sandboxes() {
    return this.request(SandboxListResponseSchema, "GET", "/sandboxes");
  }

  createSandbox(request: SandboxCreateRequest) {
    return this.request(SandboxSummarySchema, "POST", "/sandboxes", request);
  }

  destroySandbox(id: string) {
    return this.request(SandboxDownResponseSchema, "DELETE", `/sandboxes/${encodeURIComponent(id)}`);
  }

  command(id: string, command: string) {
    return this.request(CommandResponseSchema, "POST", this.target(id, "command"), { command });
  }

  we(id: string, request: { session: string; world: string; ops: WeOp[] }) {
    return this.request(WeRunResponseSchema, "POST", this.target(id, "we"), request);
  }

  paste(
    id: string,
    request: { session: string; world: string; schematic: string; at: BlockPos; rotate: 0 | 90 | 180 | 270; ignoreAir: boolean },
  ) {
    return this.request(WePasteResponseSchema, "POST", this.target(id, "paste"), request);
  }

  regionRead(id: string, box: Box) {
    return this.request(RegionReadResponseSchema, "POST", this.target(id, "region-read"), box);
  }

  snapshot(id: string, box: Box, label?: string) {
    return this.request(SnapshotSchema, "POST", this.target(id, "snapshot"), {
      box,
      ...(label === undefined ? {} : { label }),
    });
  }

  async snapshotBytes(id: string, snapshotId: string): Promise<Uint8Array> {
    const { base64 } = await this.request(
      SnapshotBytesResponseSchema,
      "GET",
      this.target(id, `snapshots/${encodeURIComponent(snapshotId)}`),
    );
    return new Uint8Array(Buffer.from(base64, "base64"));
  }

  restore(id: string, snapshotId: string) {
    return this.request(SnapshotRestoreResponseSchema, "POST", this.target(id, "snapshot-restore"), { id: snapshotId });
  }
}

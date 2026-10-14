import { z } from "zod";
import { GameIdSchema } from "@arcade/common/catalog.ts";
import {
  MediaFormatSchema,
  type RuntimeMediaFormat,
} from "@arcade/common/runtime/config.ts";
import { decodePacket, type RuntimePacket } from "@arcade/common/wire.ts";

const HelloSchema = z.strictObject({
  version: z.literal(1),
  gameId: GameIdSchema,
  sourceRevision: z.string(),
  format: MediaFormatSchema,
});
export type RuntimeCallbacks = {
  frame: (bytes: Buffer, timeMs: number) => void;
  audio: (bytes: Buffer, timeMs: number) => void;
  telemetry: (data: unknown) => void;
  fatal: (error: Error) => void;
};

export class MediaPeer {
  private hello = false;
  private seenVideo = false;
  private readonly sequence = new Map<RuntimePacket["kind"], number>();
  private readonly readiness = Promise.withResolvers<undefined>();
  readonly ready = this.readiness.promise;

  constructor(
    private readonly expected: {
      gameId: "mkwii" | "melee" | "brawl";
      sourceRevision: string;
      format: RuntimeMediaFormat;
      callbacks: RuntimeCallbacks;
      saved: (sequence: number) => void;
    },
  ) {}

  receive(bytes: Uint8Array): void {
    const packet = decodePacket(bytes);
    if (packet.kind === "hello") {
      this.greet(packet);
      return;
    }
    if (!this.hello) throw new Error("Runtime media arrived before its format");
    if (packet.kind !== "saved") {
      const previous = this.sequence.get(packet.kind);
      if (previous !== undefined && packet.sequence <= previous)
        throw new Error("Runtime packet sequence moved backward");
      this.sequence.set(packet.kind, packet.sequence);
    }
    const data = Buffer.from(
      packet.payload.buffer,
      packet.payload.byteOffset,
      packet.payload.byteLength,
    );
    switch (packet.kind) {
      case "video": {
        if (
          data.length !==
          this.expected.format.width * this.expected.format.height * 4
        )
          throw new Error("Runtime framebuffer size changed");
        this.expected.callbacks.frame(data, packet.timeMs);
        this.seenVideo = true;
        return;
      }
      case "audio": {
        if (data.length % 4 !== 0)
          throw new Error("Runtime emitted partial stereo samples");
        this.expected.callbacks.audio(data, packet.timeMs);
        if (this.seenVideo) this.readiness.resolve(undefined);
        return;
      }
      case "telemetry": {
        const value: unknown = JSON.parse(data.toString("utf8"));
        this.expected.callbacks.telemetry(value);
        return;
      }
      case "saved":
        this.expected.saved(packet.sequence);
        return;
      case "error":
        throw new Error(`Game runtime: ${data.toString("utf8")}`);
      case "input":
      case "flush":
      case "stop":
        throw new Error("Runtime sent a controller command to its host");
    }
  }

  private greet(packet: RuntimePacket): void {
    if (this.hello) throw new Error("Runtime announced its format twice");
    const hello = HelloSchema.parse(
      JSON.parse(new TextDecoder().decode(packet.payload)),
    );
    if (
      hello.gameId !== this.expected.gameId ||
      hello.sourceRevision !== this.expected.sourceRevision
    )
      throw new Error("Runtime asset revision does not match its adapter");
    for (const key of Object.keys(this.expected.format))
      if (
        Reflect.get(hello.format, key) !==
        Reflect.get(this.expected.format, key)
      )
        throw new Error("Runtime media format does not match its adapter");
    this.hello = true;
  }
}

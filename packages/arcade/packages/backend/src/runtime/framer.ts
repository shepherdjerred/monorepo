import { decodeHeader, type RuntimeHeader } from "@arcade/common/wire.ts";
import { wire } from "@arcade/common/wire.generated.ts";

/** Allocate once per validated packet, rather than concatenating every TCP chunk. */
export class PacketFramer {
  private readonly header = Buffer.alloc(wire.headerBytes);
  private headerBytes = 0;
  private packet: Buffer | undefined;
  private written = 0;
  private metadata: RuntimeHeader | undefined;

  constructor(private readonly receive: (packet: Buffer) => void) {}

  push(chunk: Buffer): void {
    let offset = 0;
    while (offset < chunk.length) {
      if (this.packet === undefined) {
        const length = Math.min(
          wire.headerBytes - this.headerBytes,
          chunk.length - offset,
        );
        chunk.copy(this.header, this.headerBytes, offset, offset + length);
        this.headerBytes += length;
        offset += length;
        if (this.headerBytes < wire.headerBytes) continue;
        this.metadata = decodeHeader(this.header);
        this.packet = Buffer.allocUnsafe(
          wire.headerBytes + this.metadata.length,
        );
        this.header.copy(this.packet);
        this.written = wire.headerBytes;
      }
      const packet = this.packet;
      const length = Math.min(
        packet.length - this.written,
        chunk.length - offset,
      );
      chunk.copy(packet, this.written, offset, offset + length);
      this.written += length;
      offset += length;
      if (this.written === packet.length) {
        this.receive(packet);
        this.packet = undefined;
        this.metadata = undefined;
        this.headerBytes = 0;
        this.written = 0;
      }
    }
  }

  end(): void {
    if (this.headerBytes !== 0 || this.packet !== undefined)
      throw new Error("Runtime ended in the middle of a media packet");
  }
}

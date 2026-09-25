import net from "node:net";

// Source RCON as implemented by the vanilla/Paper server:
// https://minecraft.wiki/w/RCON. Little-endian int32 length, id, type, then
// an ASCII body terminated by two NUL bytes.
const packetType = { command: 2, auth: 3 } as const;
// The server splits responses into 4096-byte bodies; a shorter body ends one.
const maxResponseBody = 4096;

type Pending = {
  id: number;
  chunks: string[];
  resolve: (body: string) => void;
  reject: (error: Error) => void;
};

export type RconConnectOptions = {
  host: string;
  port: number;
  password: string;
  timeoutMs?: number;
};

export class RconClient {
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending: Pending | undefined;
  private queue: Promise<void> = Promise.resolve();

  private constructor(private readonly socket: net.Socket) {
    socket.on("data", (data) => {
      this.onData(Buffer.isBuffer(data) ? data : Buffer.from(data));
    });
    socket.on("error", (error) => {
      this.fail(error);
    });
    socket.on("close", () => {
      this.fail(new Error("RCON socket closed"));
    });
  }

  static async connect(options: RconConnectOptions): Promise<RconClient> {
    const socket = await new Promise<net.Socket>((resolve, reject) => {
      const connection = net.createConnection(
        { host: options.host, port: options.port },
        () => {
          connection.off("error", reject);
          resolve(connection);
        },
      );
      connection.once("error", reject);
      connection.setTimeout(options.timeoutMs ?? 5000, () => {
        connection.destroy(new Error("RCON connect timed out"));
      });
    });
    socket.setTimeout(0);
    const client = new RconClient(socket);
    await client.authenticate(options.password);
    return client;
  }

  /** Runs one console command. Commands are serialized over the socket. */
  async command(command: string): Promise<string> {
    const previous = this.queue;
    const run = (async () => {
      await previous;
      return this.send(packetType.command, command);
    })();
    this.queue = (async () => {
      try {
        await run;
      } catch {
        // The caller sees this failure; the next command still runs.
      }
    })();
    return run;
  }

  close(): void {
    this.socket.end();
  }

  private async authenticate(password: string): Promise<void> {
    // A rejected password answers with request id -1, handled in onPacket.
    await this.send(packetType.auth, password);
  }

  private async send(type: number, body: string): Promise<string> {
    const id = this.nextId++;
    const payload = Buffer.from(body, "utf8");
    const packet = Buffer.alloc(14 + payload.length);
    packet.writeInt32LE(10 + payload.length, 0);
    packet.writeInt32LE(id, 4);
    packet.writeInt32LE(type, 8);
    payload.copy(packet, 12);
    return new Promise<string>((resolve, reject) => {
      this.pending = { id, chunks: [], resolve, reject };
      this.socket.write(packet);
    });
  }

  private onData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
    while (this.buffer.length >= 4) {
      const length = this.buffer.readInt32LE(0);
      if (this.buffer.length < 4 + length) {
        return;
      }
      const id = this.buffer.readInt32LE(4);
      const type = this.buffer.readInt32LE(8);
      const body = this.buffer.toString("utf8", 12, 4 + length - 2);
      this.buffer = this.buffer.subarray(4 + length);
      this.onPacket(id, type, body);
    }
  }

  private onPacket(id: number, type: number, body: string): void {
    const pending = this.pending;
    if (pending === undefined) {
      this.fail(new Error(`Unexpected RCON packet id=${id.toString()}`));
      return;
    }
    if (id === -1) {
      this.pending = undefined;
      pending.reject(new Error("RCON authentication rejected"));
      return;
    }
    if (id !== pending.id) {
      this.fail(
        new Error(
          `RCON id mismatch: expected ${pending.id.toString()}, got ${id.toString()} (type ${type.toString()})`,
        ),
      );
      return;
    }
    pending.chunks.push(body);
    if (Buffer.byteLength(body, "utf8") < maxResponseBody) {
      this.pending = undefined;
      pending.resolve(pending.chunks.join(""));
    }
  }

  private fail(error: Error): void {
    const pending = this.pending;
    this.pending = undefined;
    pending?.reject(error);
  }
}

import type { EncryptionProvider } from "./crypto.ts";
import {
  PushNotificationSchema,
  PullResponseSchema,
  parseJsonMessage,
  createDeferred,
  getExtension,
} from "./ws-types.ts";
import type {
  PushNotification,
  Msg,
  DeferredPromise,
  ConnectParams,
  PushParams,
  JustPushedEntry,
} from "./ws-types.ts";

const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 120_000;
const CHUNK_SIZE = 2_097_152; // 2 MiB

export class SyncWebSocket {
  private socket: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageTs = 0;
  private responsePromise: DeferredPromise<Msg> | null = null;
  private dataPromise: DeferredPromise<ArrayBuffer> | null = null;
  private readonly encryptionProvider: EncryptionProvider;
  private onReady: ((version: number) => void) | null = null;
  private onPush: ((notification: PushNotification) => void) | null = null;
  private queueTail: Promise<unknown> = Promise.resolve();
  private readonly justPushed = new Map<string, JustPushedEntry>();
  perFileMax = 208_666_624;
  userId = -1;

  constructor(encryptionProvider: EncryptionProvider) {
    this.encryptionProvider = encryptionProvider;
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async connect(params: ConnectParams): Promise<void> {
    if (this.socket) {
      return;
    }

    this.onReady = params.onReady;
    this.onPush = params.onPush;
    const keyhash = this.encryptionProvider.keyHash;

    return new Promise<void>((resolve, reject) => {
      const url = params.host.startsWith("127.0.0.1") || params.host.startsWith("localhost")
        ? `ws://${params.host}`
        : `wss://${params.host}`;

      let resolved = false;
      const fail = (error: Error): void => {
        if (!resolved) {
          resolved = true;
          this.disconnect();
          reject(error);
        }
      };

      const ws = (this.socket = new WebSocket(url));
      ws.binaryType = "arraybuffer";

      ws.addEventListener("close", (event) => {
        if (event.code === 1006) {
          fail(new Error("Unable to connect to server."));
        } else {
          fail(new Error(`Disconnected. Code: ${String(event.code)}`));
        }
      });

      ws.addEventListener("open", () => {
        this.lastMessageTs = Date.now();

        this.heartbeatTimer = setInterval(() => {
          const elapsed = Date.now() - this.lastMessageTs;
          if (elapsed > HEARTBEAT_TIMEOUT_MS) {
            this.disconnect();
          } else if (elapsed > 10_000) {
            this.send({ op: "ping" });
          }
        }, HEARTBEAT_INTERVAL_MS);

        this.send({
          op: "init",
          token: params.token,
          id: params.vaultId,
          keyhash,
          version: params.version,
          initial: params.initial,
          device: params.device,
          encryption_version: this.encryptionProvider.encryptionVersion,
        });
      });

      ws.addEventListener("message", (event: MessageEvent) => {
        const data: unknown = event.data;
        if (typeof data !== "string") {
          fail(new Error("Server returned binary"));
          return;
        }

        const msg = parseJsonMessage(data);
        if (msg === null) {
          fail(new Error(`Server JSON failed to parse: ${data}`));
          return;
        }

        if (msg["op"] === "pong") {
          return;
        }

        if (msg["status"] === "err" || msg["res"] === "err") {
          const errorMsg = typeof msg["msg"] === "string" ? msg["msg"] : "";
          fail(new Error(`Failed to authenticate: ${errorMsg}`));
          return;
        }

        if (msg["res"] !== "ok") {
          fail(new Error(`Did not respond to login request: ${data}`));
          return;
        }

        if (Object.hasOwn(msg, "perFileMax")) {
          const perFileMax = msg["perFileMax"];
          if (
            typeof perFileMax === "number" &&
            Number.isInteger(perFileMax) &&
            perFileMax >= 0
          ) {
            this.perFileMax = perFileMax;
          }
        }

        if (typeof msg["userId"] === "number") {
          this.userId = msg["userId"];
        }

        resolve();
        resolved = true;

        ws.addEventListener("message", this.handleMessage.bind(this));
        ws.addEventListener("close", () => { this.disconnect(); });
        ws.addEventListener("error", () => { this.disconnect(); });
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    const error = new Error("Disconnected");
    if (this.responsePromise) {
      this.responsePromise.reject(error);
      this.responsePromise = null;
    }
    if (this.dataPromise) {
      this.dataPromise.reject(error);
      this.dataPromise = null;
    }
  }

  async pull(uid: number): Promise<ArrayBuffer | null> {
    return this.enqueue(() => this.doPull(uid));
  }

  async push(params: PushParams): Promise<void> {
    return this.enqueue(() => this.doPush(params));
  }

  isJustPushed(notification: PushNotification): boolean {
    const entry = this.justPushed.get(notification.path);
    if (
      entry?.folder === notification.folder &&
      entry.deleted === notification.deleted &&
      entry.mtime === notification.mtime &&
      entry.hash === notification.hash
    ) {
      this.justPushed.delete(notification.path);
      return true;
    }
    return false;
  }

  private async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.queueTail;
    const gate = createDeferred<null>();
    this.queueTail = gate.promise;
    try {
      await previous;
    } catch {
      // Previous operation failed; proceed with next
    }
    try {
      return await fn();
    } finally {
      gate.resolve(null);
    }
  }

  private async doPull(uid: number): Promise<ArrayBuffer | null> {
    const result = await this.request({ op: "pull", uid });
    const pullResult = PullResponseSchema.parse(result);

    if (pullResult.deleted === true) {
      return null;
    }

    const { size, pieces } = pullResult;
    const buffer = new ArrayBuffer(size);
    let offset = 0;

    for (let i = 0; i < pieces; i++) {
      const chunk = await this.dataResponse();
      new Uint8Array(buffer, offset, chunk.byteLength).set(
        new Uint8Array(chunk),
      );
      offset += chunk.byteLength;
    }

    if (buffer.byteLength > 0) {
      return this.encryptionProvider.decrypt(buffer);
    }

    return buffer;
  }

  private async doPush(params: PushParams): Promise<void> {
    // Skip files that exceed the server's size limit
    const dataSize = params.data?.byteLength ?? 0;
    if (dataSize > this.perFileMax) {
      throw new Error(
        `File "${params.path}" (${String(dataSize)} bytes) exceeds server limit (${String(this.perFileMax)} bytes)`,
      );
    }

    const encryptedPath =
      await this.encryptionProvider.deterministicEncodeStr(params.path);
    const encryptedRelatedPath = params.relatedPath === null
      ? null
      : await this.encryptionProvider.deterministicEncodeStr(params.relatedPath);

    const extension = params.folder || params.deleted ? "" : getExtension(params.path);

    if (params.folder || params.deleted) {
      await this.request({
        op: "push",
        path: encryptedPath,
        relatedpath: encryptedRelatedPath,
        extension,
        hash: "",
        ctime: 0,
        mtime: 0,
        folder: params.folder,
        deleted: params.deleted,
      });
      this.justPushed.set(params.path, {
        path: params.path,
        folder: params.folder,
        deleted: params.deleted,
        mtime: 0,
        hash: "",
      });
      return;
    }

    let content = params.data ?? new ArrayBuffer(0);

    if (content.byteLength > 0) {
      content = await this.encryptionProvider.encrypt(content);
    }

    let encryptedHash = "";
    if (params.hash !== "") {
      encryptedHash =
        await this.encryptionProvider.deterministicEncodeStr(params.hash);
    }

    const size = content.byteLength;
    const pieces = Math.ceil(size / CHUNK_SIZE);

    const response = await this.request({
      op: "push",
      path: encryptedPath,
      relatedpath: encryptedRelatedPath,
      extension,
      hash: encryptedHash,
      ctime: params.ctime,
      mtime: params.mtime,
      folder: params.folder,
      deleted: params.deleted,
      size,
      pieces,
    });

    this.justPushed.set(params.path, {
      path: params.path,
      folder: params.folder,
      deleted: params.deleted,
      mtime: params.mtime,
      hash: params.hash,
    });

    if (response["res"] === "ok") {
      return;
    }

    for (let i = 0; i < pieces; i++) {
      const start = i * CHUNK_SIZE;
      const length = Math.min(CHUNK_SIZE, size - start);
      this.sendBinary(new Uint8Array(content, start, length));
      await this.response();
    }
  }

  private handleMessage(event: MessageEvent): void {
    this.lastMessageTs = Date.now();

    if (typeof event.data === "string") {
      const msg = parseJsonMessage(event.data);
      if (msg === null) {
        this.disconnect();
        return;
      }

      const op = msg["op"];
      if (op === "pong") {
        return;
      }
      if (op === "ready") {
        const version = msg["version"];
        if (typeof version === "number") {
          this.onReady?.(version);
        }
        return;
      }
      if (op === "push") {
        const notification = PushNotificationSchema.safeParse(msg);
        if (notification.success) {
          void this.handleServerPush(notification.data);
        }
        return;
      }

      // Regular response
      const pending = this.responsePromise;
      if (pending) {
        this.responsePromise = null;
        pending.resolve(msg);
      }
    } else {
      // Binary data (file chunk) — binaryType="arraybuffer" guarantees ArrayBuffer
      this.handleBinaryData(event.data);
    }
  }

  private handleBinaryData(data: unknown): void {
    if (!(data instanceof ArrayBuffer)) {
      return;
    }
    const pending = this.dataPromise;
    if (pending) {
      this.dataPromise = null;
      pending.resolve(data);
    }
  }

  private async handleServerPush(
    notification: PushNotification,
  ): Promise<void> {
    notification.path =
      await this.encryptionProvider.deterministicDecodeStr(notification.path);

    if (notification.hash !== "") {
      notification.hash =
        await this.encryptionProvider.deterministicDecodeStr(
          notification.hash,
        );
    }

    if (notification.relatedpath !== undefined && notification.relatedpath !== "") {
      notification.relatedpath =
        await this.encryptionProvider.deterministicDecodeStr(
          notification.relatedpath,
        );
    }

    this.onPush?.(notification);
  }

  private response(): Promise<Msg> {
    this.responsePromise = createDeferred();
    return this.responsePromise.promise;
  }

  private dataResponse(): Promise<ArrayBuffer> {
    this.dataPromise = createDeferred();
    return this.dataPromise.promise;
  }

  private async request(msg: Msg, timeout = 60_000): Promise<Msg> {
    const deferred = (this.responsePromise = createDeferred());
    this.send(msg);

    const timeoutError = new Error("Timeout");
    const timer = setTimeout(() => {
      deferred.reject(timeoutError);
    }, timeout);

    try {
      const result = await deferred.promise;
      clearTimeout(timer);
      const errorValue = result["err"];
      if (errorValue !== undefined && errorValue !== null) {
        const errorMessage = typeof errorValue === "string" ? errorValue : JSON.stringify(errorValue);
        throw new Error(errorMessage);
      }
      return result;
    } catch (error) {
      if (error === timeoutError) {
        this.disconnect();
      }
      throw error;
    }
  }

  private send(msg: Msg): void {
    this.socket?.send(JSON.stringify(msg));
  }

  private sendBinary(data: Uint8Array): void {
    this.socket?.send(data);
  }
}

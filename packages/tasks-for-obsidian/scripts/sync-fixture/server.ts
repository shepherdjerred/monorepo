import assert from "node:assert/strict";
import { z } from "zod";
import type { ServerWebSocket } from "bun";
import {
  InitSchema,
  PingSchema,
  PullSchema,
  PushSchema,
  fileBytes,
  fixtureProfile,
  pieceBytes,
  syntheticVault,
  type FixtureProfile,
  type Push,
} from "./contract";
import { createFixtureHTTP } from "./http";
import { openFixtureStore } from "./store";

type Fault = "before-commit" | "after-commit" | null;
type Connection = {
  device: string | null;
  token: string | null;
  pending: { push: Push; pieces: Uint8Array[]; size: number } | null;
};
type Socket = ServerWebSocket<Connection>;

/** Loopback-only protocol fixture. It stores opaque encrypted bytes and never reads an account. */
export async function startSyncFixture(options: {
  directory: string;
  runID: string;
  profile?: FixtureProfile;
}) {
  const profile = options.profile ?? "native";
  const settings = fixtureProfile(options.runID, profile);
  const store = await openFixtureStore(
    options.directory,
    options.runID,
    profile,
  );
  const connections = new Set<Socket>();
  let fault: Fault = null;
  let closed = false;
  const send = (socket: Socket, frame: unknown) => {
    assert.notEqual(
      socket.send(JSON.stringify(frame)),
      0,
      "Fixture socket send failed",
    );
  };
  const disconnect = (socket: Socket) => {
    socket.data.pending = null;
    socket.terminate();
  };
  const disconnectAll = () => {
    for (const socket of connections) disconnect(socket);
  };
  const commit = (socket: Socket, push: Push, content: Uint8Array) => {
    if (fault === "before-commit") {
      fault = null;
      store.increment("beforeCommitDisconnects");
      disconnect(socket);
      return;
    }
    const event = store.commit(push, socket.data.device ?? "", content);
    for (const peer of connections)
      if (peer.data.device !== null && store.validToken(peer.data.token ?? ""))
        send(peer, event.wire);
    if (fault === "after-commit") {
      fault = null;
      store.increment("afterCommitDisconnects");
      disconnect(socket);
      return;
    }
    send(socket, { res: "ok" });
  };
  const receiveBinary = (socket: Socket, message: Buffer) => {
    const pending = socket.data.pending;
    assert.ok(
      pending !== null && message.length > 0 && message.length <= pieceBytes,
    );
    pending.size += message.length;
    assert.ok(pending.size <= (pending.push.size ?? 0));
    pending.pieces.push(new Uint8Array(message));
    assert.ok(pending.pieces.length <= (pending.push.pieces ?? 0));
    if (pending.pieces.length === pending.push.pieces) {
      assert.equal(pending.size, pending.push.size);
      socket.data.pending = null;
      commit(socket, pending.push, Buffer.concat(pending.pieces));
    } else send(socket, { res: "continue" });
  };
  const initialize = (socket: Socket, value: unknown) => {
    const init = InitSchema.parse(value);
    assert.ok(store.validToken(init.token));
    assert.equal(init.id, settings.vaultID);
    assert.equal(init.keyhash, settings.keyProof);
    assert.ok(init.version <= store.current());
    socket.data.device = init.device;
    socket.data.token = init.token;
    send(socket, {
      res: "ok",
      perFileMax: fileBytes,
      userId: "synthetic-user",
    });
    for (const event of store.history(init.initial ? 0 : init.version))
      send(socket, event.wire);
    send(socket, { op: "ready", version: store.current() });
  };
  const pull = (socket: Socket, value: unknown) => {
    const request = PullSchema.parse(value);
    const event = store.get(request.uid);
    assert.ok(event !== null);
    if (event.wire.deleted) {
      send(socket, { deleted: true });
      return;
    }
    send(socket, {
      size: event.content.byteLength,
      pieces: Math.ceil(event.content.byteLength / pieceBytes),
    });
    for (let offset = 0; offset < event.content.length; offset += pieceBytes)
      assert.notEqual(
        socket.send(event.content.slice(offset, offset + pieceBytes)),
        0,
      );
  };
  const push = (socket: Socket, value: unknown) => {
    const metadata = PushSchema.parse(value);
    store.increment("pushAttempts");
    if (store.previous(metadata) !== null) {
      send(socket, { res: "ok" });
      return;
    }
    if ((metadata.size ?? 0) === 0) {
      commit(socket, metadata, new Uint8Array());
      return;
    }
    socket.data.pending = { push: metadata, pieces: [], size: 0 };
    send(socket, { res: "ready" });
  };
  const receive = (socket: Socket, message: string | Buffer) => {
    if (typeof message !== "string") {
      receiveBinary(socket, message);
      return;
    }
    assert.ok(Buffer.byteLength(message) <= 64 * 1024);
    const value: unknown = JSON.parse(message);
    if (socket.data.device === null) {
      initialize(socket, value);
      return;
    }
    assert.ok(store.validToken(socket.data.token ?? ""));
    assert.equal(socket.data.pending, null);
    const op = z.object({ op: z.string() }).parse(value).op;
    if (op === "ping") {
      PingSchema.parse(value);
      send(socket, { op: "pong" });
    } else if (op === "pull") pull(socket, value);
    else push(socket, value);
  };
  const inventory = () => ({
    schemaVersion: 1,
    runID: options.runID,
    scope: "protocol-fixture-only",
    latestUID: store.current(),
    files: store.history(0).map(({ wire, content }) => ({
      uid: wire.uid,
      path: wire.path,
      relatedpath: wire.relatedpath,
      hash: wire.hash,
      ctime: wire.ctime,
      mtime: wire.mtime,
      folder: wire.folder,
      deleted: wire.deleted,
      size: wire.size ?? 0,
      pieces: wire.pieces ?? 0,
      contentSHA256: new Bun.CryptoHasher("sha256")
        .update(content)
        .digest("hex"),
    })),
    connections: connections.size,
    counters: store.counters(),
  });
  const http = createFixtureHTTP({
    store,
    settings,
    runID: options.runID,
    inventory,
    control: (action) => {
      if (action === "disconnect-all") disconnectAll();
      else {
        assert.equal(fault, null, "A fixture fault is already armed");
        fault =
          action === "fail-next-push-before-commit"
            ? "before-commit"
            : "after-commit";
      }
    },
  });
  const server = Bun.serve<Connection>({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: 64 * 1024,
    fetch(request, instance) {
      return http(request, () =>
        instance.upgrade(request, {
          data: { device: null, token: null, pending: null },
        }),
      );
    },
    websocket: {
      maxPayloadLength: pieceBytes,
      open(socket) {
        connections.add(socket);
      },
      message(socket, message) {
        try {
          receive(socket, message);
        } catch {
          store.increment("protocolErrors");
          socket.close(1008, "Fixture protocol rejected");
        }
      },
      close(socket) {
        socket.data.pending = null;
        connections.delete(socket);
      },
    },
  });
  return {
    identity: {
      schemaVersion: 1,
      kind: "facet-sync-fixture",
      runID: options.runID,
      httpOrigin: server.url.origin,
      webSocketURL: `ws://127.0.0.1:${String(server.port)}/sync`,
      vaultID: settings.vaultID,
      host: syntheticVault.host,
    },
    snapshot: inventory,
    disconnectAll,
    failNextPush: (when: Exclude<Fault, null>) => {
      assert.equal(fault, null);
      fault = when;
    },
    close: async () => {
      if (closed) return;
      closed = true;
      disconnectAll();
      await server.stop(true);
      store.close();
    },
  };
}
export type SyncFixture = Awaited<ReturnType<typeof startSyncFixture>>;

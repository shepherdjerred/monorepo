package com.shepherdjerred.thestorm.client;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.StandardProtocolFamily;
import java.net.UnixDomainSocketAddress;
import java.nio.ByteBuffer;
import java.nio.channels.Channels;
import java.nio.channels.ServerSocketChannel;
import java.nio.channels.SocketChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import net.minecraft.client.Minecraft;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Local IPC on virtual threads; no socket or file I/O runs in a client tick. */
final class LocalBridge implements AutoCloseable {
  private static final Logger LOG = LoggerFactory.getLogger(LocalBridge.class);
  private final Session session;
  private final ClientActions actions;
  private final ExecutorService io = Executors.newVirtualThreadPerTaskExecutor();
  private final ConcurrentHashMap<UUID, SocketChannel> peers = new ConcurrentHashMap<>();
  private final Semaphore pending = new Semaphore(32);
  private final AtomicBoolean stopped = new AtomicBoolean();
  private @Nullable ServerSocketChannel server;

  LocalBridge(Session session, ClientActions actions) {
    this.session = session;
    this.actions = actions;
  }

  void start(Minecraft client) {
    io.execute(() -> listen(client));
  }

  private void listen(Minecraft client) {
    try (var listener = ServerSocketChannel.open(StandardProtocolFamily.UNIX)) {
      server = listener;
      var parent = session.socket().getParent();
      if (parent == null
          || !Files.getPosixFilePermissions(parent)
              .equals(PosixFilePermissions.fromString("rwx------"))) {
        throw new IOException("Socket directory must be private (0700)");
      }
      listener.bind(UnixDomainSocketAddress.of(session.socket()));
      Files.setPosixFilePermissions(session.socket(), PosixFilePermissions.fromString("rw-------"));
      while (!stopped.get()) {
        var channel = listener.accept();
        io.execute(() -> serve(client, channel));
      }
    } catch (IOException e) {
      if (!stopped.get()) LOG.error("Preview bridge failed", e);
    }
  }

  private void serve(Minecraft client, SocketChannel channel) {
    var peer = UUID.randomUUID();
    peers.put(peer, channel);
    try (channel;
        var reader =
            new BufferedReader(
                new InputStreamReader(Channels.newInputStream(channel), StandardCharsets.UTF_8))) {
      var line = readFrame(reader);
      while (line != null) {
        receive(client, peer, channel, line);
        line = readFrame(reader);
      }
    } catch (IOException e) {
      if (!stopped.get()) LOG.debug("Preview controller disconnected", e);
    } finally {
      peers.remove(peer);
      client.execute(() -> actions.disconnect(client, peer));
    }
  }

  private void receive(Minecraft client, UUID peer, SocketChannel channel, String line) {
    Protocol.Request request;
    try {
      request = Protocol.read(line);
    } catch (RuntimeException e) {
      reply(channel, new Protocol.Failure(Protocol.VERSION, "invalid", false, e.toString()));
      return;
    }
    if (!pending.tryAcquire()) {
      reply(
          channel,
          new Protocol.Failure(Protocol.VERSION, request.id(), false, "Command queue is full"));
      return;
    }
    client.execute(() -> dispatch(client, peer, channel, request));
  }

  private void dispatch(
      Minecraft client, UUID peer, SocketChannel channel, Protocol.Request request) {
    if (!peers.containsKey(peer)) {
      pending.release();
      return;
    }
    try {
      var result = actions.submit(client, peer, request);
      io.execute(() -> complete(channel, request, result));
    } catch (RuntimeException e) {
      pending.release();
      io.execute(
          () ->
              reply(
                  channel,
                  new Protocol.Failure(Protocol.VERSION, request.id(), false, e.toString())));
    }
  }

  private void complete(
      SocketChannel channel, Protocol.Request request, CompletableFuture<Object> result) {
    try {
      var value = result.get(10, TimeUnit.SECONDS);
      reply(channel, new Protocol.Success(Protocol.VERSION, request.id(), true, value));
    } catch (ExecutionException | TimeoutException e) {
      reply(channel, new Protocol.Failure(Protocol.VERSION, request.id(), false, e.toString()));
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      reply(
          channel, new Protocol.Failure(Protocol.VERSION, request.id(), false, "Client stopping"));
    } finally {
      pending.release();
    }
  }

  private static @Nullable String readFrame(BufferedReader reader) throws IOException {
    var frame = new StringBuilder();
    for (int ch = reader.read(); ch != -1; ch = reader.read()) {
      if (ch == '\n') return frame.toString();
      if (frame.length() == Protocol.MAX_FRAME) throw new IOException("Frame is too large");
      frame.append((char) ch);
    }
    if (!frame.isEmpty()) throw new IOException("Incomplete frame");
    return null;
  }

  private static void reply(SocketChannel channel, Object response) {
    var bytes =
        ByteBuffer.wrap(
            (Protocol.JSON.writeValueAsString(response) + "\n").getBytes(StandardCharsets.UTF_8));
    try {
      synchronized (channel) {
        while (bytes.hasRemaining()) channel.write(bytes);
      }
    } catch (IOException e) {
      LOG.debug("Preview response connection closed", e);
    }
  }

  @Override
  public void close() {
    stopped.set(true);
    closeChannel(server);
    peers.values().forEach(LocalBridge::closeChannel);
    io.shutdownNow();
  }

  private static void closeChannel(java.nio.channels.@Nullable Channel channel) {
    if (channel == null) return;
    try {
      channel.close();
    } catch (IOException e) {
      LOG.warn("Cannot close preview channel", e);
    }
  }
}

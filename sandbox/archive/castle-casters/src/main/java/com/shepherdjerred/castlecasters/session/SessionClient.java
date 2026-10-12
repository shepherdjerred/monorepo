package com.shepherdjerred.castlecasters.session;

import static com.shepherdjerred.castlecasters.session.SessionWire.*;

import com.google.gson.JsonObject;
import com.shepherdjerred.castlecasters.session.SessionState.*;
import io.netty.bootstrap.Bootstrap;
import io.netty.channel.*;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioSocketChannel;
import java.net.InetSocketAddress;
import java.util.concurrent.ConcurrentLinkedQueue;

public final class SessionClient implements AutoCloseable {
  private final EventLoopGroup group = new NioEventLoopGroup(1);
  private final ConcurrentLinkedQueue<Runnable> updates = new ConcurrentLinkedQueue<>();
  private final InetSocketAddress address;
  private final String name;
  private Channel channel;
  private Snapshot snapshot;
  private String credential = "";
  private String message = "Connecting...";
  private int seat;
  private long sequence, retryAt, pingAt;
  private boolean connecting, closed, pending, handshaken;
  private boolean disposed;

  public boolean pending() {
    return pending;
  }

  public SessionClient(InetSocketAddress address, String name) {
    this.address = address;
    this.name = name;
    connect();
  }

  public Snapshot snapshot() {
    return snapshot;
  }

  public int seat() {
    return seat;
  }

  public String status() {
    return message;
  }

  public boolean connected() {
    return !closed && handshaken && channel != null && channel.isActive();
  }

  public void update() {
    Runnable update;
    while ((update = updates.poll()) != null) update.run();
    long now = System.nanoTime();
    if (!closed && !connecting && (channel == null || !channel.isActive()) && now >= retryAt)
      connect();
    if (connected() && now >= pingAt) {
      send(message("ping"));
      pingAt = now + 5_000_000_000L;
    }
  }

  private void connect() {
    connecting = true;
    handshaken = false;
    new Bootstrap()
        .group(group)
        .channel(NioSocketChannel.class)
        .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 5000)
        .option(ChannelOption.TCP_NODELAY, true)
        .handler(
            new ChannelInitializer<SocketChannel>() {
              @Override
              protected void initChannel(SocketChannel socket) {
                pipeline(socket.pipeline());
                socket
                    .pipeline()
                    .addLast(
                        new SimpleChannelInboundHandler<String>() {
                          @Override
                          protected void channelRead0(ChannelHandlerContext ctx, String text) {
                            updates.add(() -> receive(text));
                          }

                          @Override
                          public void channelInactive(ChannelHandlerContext ctx) {
                            updates.add(
                                () -> {
                                  handshaken = false;
                                  pending = false;
                                  if (!closed) message = "Disconnected. Reconnecting...";
                                  retryAt = System.nanoTime() + 1_000_000_000L;
                                });
                          }

                          @Override
                          public void exceptionCaught(ChannelHandlerContext ctx, Throwable error) {
                            ctx.close();
                          }
                        });
              }
            })
        .connect(address)
        .addListener(
            (ChannelFutureListener)
                future ->
                    updates.add(
                        () -> {
                          connecting = false;
                          if (closed) {
                            if (future.isSuccess()) future.channel().close();
                            return;
                          }
                          if (!future.isSuccess()) {
                            message = "Cannot connect to host. Retrying...";
                            retryAt = System.nanoTime() + 2_000_000_000L;
                            return;
                          }
                          channel = future.channel();
                          var hello = message("hello");
                          hello.addProperty("name", name);
                          if (!credential.isEmpty()) hello.addProperty("credential", credential);
                          send(hello);
                        }));
  }

  private void receive(String text) {
    var response = parse(text);
    switch (response.get("type").getAsString()) {
      case "welcome" -> {
        credential = response.get("credential").getAsString();
        seat = response.get("seat").getAsInt();
        snapshot = JSON.fromJson(response.get("snapshot"), Snapshot.class);
        message = "Connected";
        pending = false;
        handshaken = true;
      }
      case "state" -> {
        var next = JSON.fromJson(response.get("snapshot"), Snapshot.class);
        if (snapshot == null || next.revision() > snapshot.revision()) pending = false;
        if (snapshot == null || next.revision() >= snapshot.revision()) snapshot = next;
      }
      case "error" -> {
        message = response.get("message").getAsString();
        pending = false;
        if (!handshaken) ended(message);
      }
      case "closed" -> ended(response.get("message").getAsString());
      case "pong" -> {}
      default -> throw new IllegalStateException("Unknown server message");
    }
  }

  private void ended(String reason) {
    message = reason;
    closed = true;
    pending = false;
    handshaken = false;
    if (snapshot != null)
      snapshot =
          new Snapshot(
              snapshot.revision() + 1,
              Phase.CLOSED,
              snapshot.theme(),
              snapshot.startingPlayer(),
              snapshot.seats(),
              snapshot.match(),
              snapshot.lastTurn(),
              false,
              message);
    if (channel != null) channel.close();
  }

  public void turn(TurnData turn) {
    if (snapshot == null || !connected())
      throw new IllegalArgumentException("Wait for the host connection");
    var command = message("turn");
    command.addProperty("id", ++sequence);
    command.addProperty("revision", snapshot.revision());
    command.add("turn", JSON.toJsonTree(turn));
    send(command);
    pending = true;
  }

  public void configure(Seat seat) {
    var command = message("seat");
    command.add("seat", JSON.toJsonTree(seat));
    send(command);
  }

  private void send(JsonObject command) {
    if (channel != null && channel.isActive()) channel.writeAndFlush(JSON.toJson(command));
  }

  /** Simulate a network interruption while retaining the in-memory session credential. */
  public void interruptConnection() {
    if (channel != null) channel.close();
  }

  @Override
  public void close() {
    if (disposed) return;
    disposed = true;
    closed = true;
    if (channel != null) channel.close().syncUninterruptibly();
    group.shutdownGracefully(0, 1, java.util.concurrent.TimeUnit.SECONDS).syncUninterruptibly();
  }
}

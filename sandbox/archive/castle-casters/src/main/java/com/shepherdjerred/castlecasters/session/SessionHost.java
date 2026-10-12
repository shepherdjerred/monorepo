package com.shepherdjerred.castlecasters.session;

import static com.shepherdjerred.castlecasters.session.SessionWire.*;

import com.google.gson.*;
import com.shepherdjerred.castlecasters.session.SessionState.*;
import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.*;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import java.util.*;
import java.util.concurrent.ConcurrentLinkedQueue;

/** Network handlers only enqueue work; authority remains on the session thread. */
public final class SessionHost implements AutoCloseable {
  private record Remote(int seat, String credential) {}

  private final GameSession session;
  private final EventLoopGroup boss = new NioEventLoopGroup(1);
  private final EventLoopGroup workers = new NioEventLoopGroup(2);
  private final ConcurrentLinkedQueue<Runnable> requests = new ConcurrentLinkedQueue<>();
  private final Map<Channel, Remote> peers = new HashMap<>();
  private final Map<String, Integer> reservations = new HashMap<>();
  private final Map<Channel, Long> seen = new HashMap<>();
  private final Channel listener;
  private Snapshot sent;
  private boolean closed;

  public SessionHost(GameSession session, int port) throws InterruptedException {
    this.session = session;
    try {
      listener =
          new ServerBootstrap()
              .group(boss, workers)
              .channel(NioServerSocketChannel.class)
              .childOption(ChannelOption.TCP_NODELAY, true)
              .childHandler(
                  new ChannelInitializer<SocketChannel>() {
                    @Override
                    protected void initChannel(SocketChannel channel) {
                      pipeline(channel.pipeline());
                      channel
                          .pipeline()
                          .addLast(
                              new SimpleChannelInboundHandler<String>() {
                                @Override
                                public void channelActive(ChannelHandlerContext ctx) {
                                  requests.add(() -> seen.put(ctx.channel(), System.nanoTime()));
                                }

                                @Override
                                protected void channelRead0(
                                    ChannelHandlerContext ctx, String text) {
                                  requests.add(() -> receive(ctx.channel(), text));
                                }

                                @Override
                                public void channelInactive(ChannelHandlerContext ctx) {
                                  requests.add(() -> departed(ctx.channel()));
                                }

                                @Override
                                public void exceptionCaught(
                                    ChannelHandlerContext ctx, Throwable cause) {
                                  ctx.close();
                                }
                              });
                    }
                  })
              .bind(port)
              .sync()
              .channel();
    } catch (Throwable error) {
      boss.shutdownGracefully().syncUninterruptibly();
      workers.shutdownGracefully().syncUninterruptibly();
      throw error;
    }
  }

  public int port() {
    return ((java.net.InetSocketAddress) listener.localAddress()).getPort();
  }

  public void update() {
    Runnable request;
    while ((request = requests.poll()) != null) request.run();
    long now = System.nanoTime();
    for (var entry : List.copyOf(seen.entrySet())) {
      if (now - entry.getValue() > 15_000_000_000L) {
        departed(entry.getKey());
        entry.getKey().close();
      }
    }
    // Replaced seats lose their old reconnect reservation.
    var seats = session.snapshot().seats();
    reservations
        .entrySet()
        .removeIf(
            e ->
                e.getValue() > seats.size()
                    || seats.get(e.getValue() - 1).controller() != Controller.REMOTE);
    var snapshot = session.snapshot();
    if (!snapshot.equals(sent)) {
      var message = message("state");
      message.add("snapshot", JSON.toJsonTree(snapshot));
      for (var channel : List.copyOf(peers.keySet())) send(channel, message);
      sent = snapshot;
    }
  }

  private void receive(Channel channel, String text) {
    if (closed) return;
    seen.put(channel, System.nanoTime());
    try {
      var command = parse(text);
      String type = command.get("type").getAsString();
      if (type.equals("hello")) {
        hello(channel, command);
        return;
      }
      var remote = peers.get(channel);
      if (remote == null) throw new IllegalArgumentException("Join the lobby first");
      switch (type) {
        case "ping" -> send(channel, message("pong"));
        case "turn" ->
            session.turn(
                "remote:" + remote.seat() + ":" + command.get("id").getAsLong(),
                command.get("revision").getAsLong(),
                JSON.fromJson(command.get("turn"), TurnData.class),
                Set.of(remote.seat()));
        case "seat" -> {
          var seat = JSON.fromJson(command.get("seat"), Seat.class);
          if (seat.number() != remote.seat()
              || seat.controller() != Controller.REMOTE
              || !seat.connected())
            throw new IllegalArgumentException("You may only edit your own seat");
          session.seat(seat);
        }
        default ->
            throw new IllegalArgumentException(
                "Only the host may change the lobby or start a match");
      }
    } catch (IllegalArgumentException
        | com.shepherdjerred.castlecasters.logic.turn.exception.InvalidTurnException e) {
      var error = message("error");
      error.addProperty("message", e.getMessage());
      send(channel, error);
    } catch (IllegalStateException
        | NullPointerException
        | JsonParseException
        | IndexOutOfBoundsException e) {
      var error = message("error");
      error.addProperty("message", "Malformed command");
      send(channel, error);
      channel.close();
    }
  }

  private void hello(Channel channel, JsonObject hello) {
    if (peers.containsKey(channel)) throw new IllegalArgumentException("Already joined");
    String credential = hello.has("credential") ? hello.get("credential").getAsString() : "";
    Integer seatNumber = reservations.get(credential);
    var state = session.snapshot();
    if (!credential.isEmpty()
        && (seatNumber == null
            || seatNumber > state.seats().size()
            || state.seats().get(seatNumber - 1).controller() != Controller.REMOTE)) {
      var notice = message("closed");
      notice.addProperty(
          "message",
          "Your remote seat is no longer available. Return to the main menu to join a new lobby.");
      send(channel, notice);
      channel.close();
      return;
    }
    if (seatNumber != null) {
      var seat = state.seats().get(seatNumber - 1);
      if (seat.connected()) throw new IllegalArgumentException("This seat is already connected");
      session.reconnect(seatNumber);
    } else {
      if (state.phase() != Phase.LOBBY)
        throw new IllegalArgumentException("The match has already started");
      var slot =
          state.seats().stream()
              .filter(s -> s.controller() == Controller.REMOTE && !s.connected())
              .findFirst()
              .orElseThrow(() -> new IllegalArgumentException("The lobby is full"));
      seatNumber = slot.number();
      String name = hello.get("name").getAsString();
      session.seat(
          new Seat(
              slot.number(), name, slot.element(), Controller.REMOTE, slot.difficulty(), true));
      credential = UUID.randomUUID().toString();
      reservations.put(credential, seatNumber);
    }
    peers.put(channel, new Remote(seatNumber, credential));
    var response = message("welcome");
    response.addProperty("credential", credential);
    response.addProperty("seat", seatNumber);
    response.add("snapshot", JSON.toJsonTree(session.snapshot()));
    send(channel, response);
  }

  private void departed(Channel channel) {
    seen.remove(channel);
    var remote = peers.remove(channel);
    if (remote != null && !closed) session.disconnect(remote.seat());
  }

  private static void send(Channel channel, JsonObject message) {
    if (channel.isActive()) channel.writeAndFlush(JSON.toJson(message));
  }

  @Override
  public void close() {
    if (closed) return;
    closed = true;
    var notice = message("closed");
    notice.addProperty("message", "The host ended the session");
    for (var channel : peers.keySet()) {
      send(channel, notice);
      channel.close();
    }
    listener.close().syncUninterruptibly();
    boss.shutdownGracefully(0, 1, java.util.concurrent.TimeUnit.SECONDS).syncUninterruptibly();
    workers.shutdownGracefully(0, 1, java.util.concurrent.TimeUnit.SECONDS).syncUninterruptibly();
    peers.clear();
    reservations.clear();
    seen.clear();
  }
}

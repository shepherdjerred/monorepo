package com.shepherdjerred.castlecasters.server.network.server;

import com.google.common.collect.BiMap;
import com.google.common.collect.HashBiMap;
import com.shepherdjerred.castlecasters.common.player.Player;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.events.handlers.EventHandlerFrame;
import com.shepherdjerred.castlecasters.network.packet.packets.DoTurnPacket;
import com.shepherdjerred.castlecasters.network.packet.packets.Packet;
import com.shepherdjerred.castlecasters.network.packet.packets.PlayerJoinPacket;
import com.shepherdjerred.castlecasters.network.packet.packets.StartMatchPacket;
import com.shepherdjerred.castlecasters.server.event.DoTurnEvent;
import com.shepherdjerred.castlecasters.server.event.PlayerJoinEvent;
import com.shepherdjerred.castlecasters.server.event.StartGameEvent;
import com.shepherdjerred.castlecasters.server.network.server.netty.NettyServerBootstrap;
import lombok.extern.log4j.Log4j2;

import java.net.SocketAddress;

@Log4j2
public class NetworkServer implements Runnable {

  private final EventBus<Event> eventBus;
  private final NettyServerBootstrap bootstrap;
  private final BiMap<Player, Connection> playerMap;

  public NetworkServer(EventBus<Event> eventBus, SocketAddress address) {
    this.eventBus = eventBus;
    bootstrap = new NettyServerBootstrap(address);
    playerMap = HashBiMap.create();
    registerHandlers();
  }

  private void registerHandlers() {
    var frame = new EventHandlerFrame<>();

    frame.registerHandler(PlayerJoinEvent.class, (event) -> {
      if (event.connection() != null) {
        setPlayerConnection(event.player(), event.connection());
      }
      send(new PlayerJoinPacket(event.player()));
    });

    frame.registerHandler(StartGameEvent.class, (event) -> send(new StartMatchPacket()));

    frame.registerHandler(DoTurnEvent.class, (event) -> send(new DoTurnPacket(event.turn())));

    eventBus.registerHandlerFrame(frame);
  }

  private void setPlayerConnection(Player player, Connection connection) {
    playerMap.put(player, connection);
  }

  private Connection getConnection(Player player) {
    return playerMap.get(player);
  }

  private void send(Packet packet) {
    playerMap.values().forEach(connection -> connection.sendPacket(packet));
  }

  public void update() {
    var event = bootstrap.getNextEvent();
    event.ifPresent(eventBus::dispatch);
  }

  public void shutdown() {
    bootstrap.shutdown();
  }

  @Override
  public void run() {
    bootstrap.run();
  }
}

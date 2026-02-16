package com.shepherdjerred.castlecasters.server.network.manager;

import com.shepherdjerred.castlecasters.common.lobby.Lobby;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.server.network.broadcast.ServerBroadcast;
import com.shepherdjerred.castlecasters.server.network.broadcast.netty.NettyBroadcast;
import com.shepherdjerred.castlecasters.server.network.event.events.PacketReceivedEvent;
import com.shepherdjerred.castlecasters.server.network.event.handlers.PacketReceivedEventHandler;
import com.shepherdjerred.castlecasters.server.network.manager.events.StartBroadcastEvent;
import com.shepherdjerred.castlecasters.server.network.manager.events.StartNetworkEvent;
import com.shepherdjerred.castlecasters.server.network.manager.events.StopBroadcastEvent;
import com.shepherdjerred.castlecasters.server.network.manager.events.StopNetworkEvent;
import com.shepherdjerred.castlecasters.server.network.server.NetworkServer;
import lombok.extern.log4j.Log4j2;

import java.net.SocketAddress;

@Log4j2
public class NetworkManager {
  private final SocketAddress broadcastAddress;
  private final SocketAddress gameAddress;
  private final EventBus<Event> eventBus;
  private NetworkServer networkServer;
  private ServerBroadcast serverBroadcast;
  private Thread networkThread;
  private Thread broadcastThread;

  public NetworkManager(SocketAddress gameAddress,
                        SocketAddress broadcastAddress,
                        EventBus<Event> eventBus) {
    this.broadcastAddress = broadcastAddress;
    this.gameAddress = gameAddress;
    this.eventBus = eventBus;
    createEventHandlers();
  }

  private void createEventHandlers() {
    eventBus.registerHandler(PacketReceivedEvent.class, new PacketReceivedEventHandler(eventBus));

    eventBus.registerHandler(StartBroadcastEvent.class, (event) -> startBroadcast(event.lobby()));
    eventBus.registerHandler(StopBroadcastEvent.class, (event) -> stopBroadcast());
    eventBus.registerHandler(StartNetworkEvent.class, (event) -> startNetwork());
    eventBus.registerHandler(StopNetworkEvent.class, (event) -> stopNetwork());
  }

  private void startBroadcast(Lobby lobby) {
    serverBroadcast = new NettyBroadcast(broadcastAddress, eventBus, lobby);
    broadcastThread = new Thread(serverBroadcast, "BROADCAST");
    broadcastThread.start();
  }

  private void stopBroadcast() {
    if (serverBroadcast != null) {
      serverBroadcast.stop();
      serverBroadcast = null;
    }
  }

  private void startNetwork() {
    networkServer = new NetworkServer(eventBus, gameAddress);
    networkThread = new Thread(networkServer, "SERVER_NETWORK");
    networkThread.start();
  }

  private void stopNetwork() {
    if (networkServer != null) {
      networkServer.shutdown();
      networkServer = null;
    }
  }

  public void update() {
    if (networkServer != null){
      networkServer.update();
    } else {
      log.error("Network server is null. This is expected if the server is shutting down.");
    }
  }
}

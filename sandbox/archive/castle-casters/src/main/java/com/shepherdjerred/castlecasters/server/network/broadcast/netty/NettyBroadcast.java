package com.shepherdjerred.castlecasters.server.network.broadcast.netty;

import com.shepherdjerred.castlecasters.common.lobby.Lobby;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.server.network.broadcast.ServerBroadcast;
import lombok.extern.log4j.Log4j2;

import java.net.SocketAddress;

@Log4j2
public class NettyBroadcast implements ServerBroadcast {

  private final NettyBroadcastBootstrap bootstrap;

  public NettyBroadcast(SocketAddress address,
                        EventBus<Event> eventBus, Lobby lobby) {
    bootstrap = new NettyBroadcastBootstrap(address, lobby, eventBus);
  }

  @Override
  public void run() {
    bootstrap.run();
  }

  @Override
  public void stop() {
    bootstrap.shutdown();
  }
}

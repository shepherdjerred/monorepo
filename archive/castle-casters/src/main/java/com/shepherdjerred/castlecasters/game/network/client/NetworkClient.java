package com.shepherdjerred.castlecasters.game.network.client;

import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.game.network.client.handler.PacketReceivedEventHandler;
import com.shepherdjerred.castlecasters.game.network.client.netty.NettyClientBootstrap;
import com.shepherdjerred.castlecasters.game.network.client.state.NetworkClientState;
import com.shepherdjerred.castlecasters.game.network.client.state.PreLobbyState;
import com.shepherdjerred.castlecasters.game.network.event.PacketReceivedEvent;
import com.shepherdjerred.castlecasters.network.packet.packets.Packet;
import lombok.extern.log4j.Log4j2;

import java.net.SocketAddress;

/**
 * Hooks into an EventBus and sends/receives events over a network.
 */
@Log4j2
public class NetworkClient {

  private final EventBus<Event> eventBus;
  private final NettyClientBootstrap bootstrap;
  private NetworkClientState clientState;

  public NetworkClient(EventBus<Event> eventBus) {
    this.eventBus = eventBus;
    this.bootstrap = new NettyClientBootstrap();
    clientState = new PreLobbyState(eventBus, this);
    clientState.enable();
    eventBus.register(PacketReceivedEvent.class, new PacketReceivedEventHandler(eventBus));
  }

  public void sendPacket(Packet packet) {
    bootstrap.send(packet);
  }

  public void connect(SocketAddress socketAddress) {
    bootstrap.connect(socketAddress);
  }

  public void shutdown() {
    bootstrap.cleanup();
  }

  public void update() {
    var event = bootstrap.getLatestEvent();
    event.ifPresent(eventBus::dispatch);
  }

  public void transition(NetworkClientState newState) {
    log.info("Transitioning to new client state {}", newState);
    clientState.disable();
    newState.enable();
    clientState = newState;
  }
}

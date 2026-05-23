package com.shepherdjerred.castlecasters.game.network.client.handler;

import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.events.handlers.EventHandler;
import com.shepherdjerred.castlecasters.game.event.events.DoTurnEvent;
import com.shepherdjerred.castlecasters.game.event.events.PlayerJoinEvent;
import com.shepherdjerred.castlecasters.game.event.events.StartGameEvent;
import com.shepherdjerred.castlecasters.game.network.event.PacketReceivedEvent;
import com.shepherdjerred.castlecasters.network.packet.packets.DoTurnPacket;
import com.shepherdjerred.castlecasters.network.packet.packets.PlayerJoinPacket;
import com.shepherdjerred.castlecasters.network.packet.packets.StartMatchPacket;
import lombok.AllArgsConstructor;

@AllArgsConstructor
public class PacketReceivedEventHandler implements EventHandler<PacketReceivedEvent> {

  private final EventBus<Event> eventBus;

  @Override
  public void handle(PacketReceivedEvent packetReceivedEvent) {
    var packet = packetReceivedEvent.packet();

    if (packet instanceof PlayerJoinPacket) {
      eventBus.dispatch(new PlayerJoinEvent(((PlayerJoinPacket) packet).player()));
    } else if (packet instanceof StartMatchPacket) {
      eventBus.dispatch(new StartGameEvent());
    } else if (packet instanceof DoTurnPacket) {
      eventBus.dispatch(new DoTurnEvent(((DoTurnPacket) packet).turn()));
    }
  }
}

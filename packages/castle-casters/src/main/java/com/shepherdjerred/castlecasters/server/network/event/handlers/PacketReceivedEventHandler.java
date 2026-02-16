package com.shepherdjerred.castlecasters.server.network.event.handlers;

import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.events.handlers.EventHandler;
import com.shepherdjerred.castlecasters.network.packet.packets.DoTurnPacket;
import com.shepherdjerred.castlecasters.network.packet.packets.FillSlotsWithAiPacket;
import com.shepherdjerred.castlecasters.network.packet.packets.PlayerDescriptionPacket;
import com.shepherdjerred.castlecasters.network.packet.packets.StartMatchPacket;
import com.shepherdjerred.castlecasters.server.event.FillSlotsWithAiEvent;
import com.shepherdjerred.castlecasters.server.event.PlayerInformationReceivedEvent;
import com.shepherdjerred.castlecasters.server.event.StartGameEvent;
import com.shepherdjerred.castlecasters.server.event.TryDoTurnEvent;
import com.shepherdjerred.castlecasters.server.network.event.events.PacketReceivedEvent;
import com.shepherdjerred.castlecasters.server.network.server.Connection;
import lombok.AllArgsConstructor;
import lombok.extern.log4j.Log4j2;

@Log4j2
@AllArgsConstructor
public class PacketReceivedEventHandler implements EventHandler<PacketReceivedEvent> {

  private final EventBus<Event> eventBus;

  @Override
  public void handle(PacketReceivedEvent event) {
    var packet = event.packet();

    if (packet instanceof PlayerDescriptionPacket) {
      handlePlayerDescriptionPacket((PlayerDescriptionPacket) packet, event.connection());
    } else if (packet instanceof StartMatchPacket) {
      eventBus.dispatch(new StartGameEvent());
    } else if (packet instanceof FillSlotsWithAiPacket) {
      eventBus.dispatch(new FillSlotsWithAiEvent());
    } else if (packet instanceof DoTurnPacket) {
      eventBus.dispatch(new TryDoTurnEvent(((DoTurnPacket) packet).turn()));
    }
  }

  private void handlePlayerDescriptionPacket(PlayerDescriptionPacket packet,
                                             Connection connection) {
    eventBus.dispatch(new PlayerInformationReceivedEvent(packet.playerInformation(),
        connection));
  }
}

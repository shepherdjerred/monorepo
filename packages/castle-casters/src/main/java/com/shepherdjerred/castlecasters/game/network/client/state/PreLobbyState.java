package com.shepherdjerred.castlecasters.game.network.client.state;

import com.shepherdjerred.castlecasters.common.player.PlayerInformation;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.events.handlers.EventHandlerFrame;
import com.shepherdjerred.castlecasters.game.event.events.FillSlotsWithAiEvent;
import com.shepherdjerred.castlecasters.game.event.events.IdentifyPlayerEvent;
import com.shepherdjerred.castlecasters.game.event.events.PlayerJoinEvent;
import com.shepherdjerred.castlecasters.game.network.client.NetworkClient;
import com.shepherdjerred.castlecasters.game.network.event.ServerConnectedEvent;
import com.shepherdjerred.castlecasters.network.packet.packets.FillSlotsWithAiPacket;
import com.shepherdjerred.castlecasters.network.packet.packets.PlayerDescriptionPacket;
import lombok.extern.log4j.Log4j2;

import java.util.UUID;

/**
 * Before the client connects to a server.
 */
@Log4j2
public class PreLobbyState extends AbstractNetworkClientState {

  public PreLobbyState(EventBus<Event> eventBus,
                       NetworkClient networkClient) {
    super(eventBus, networkClient);
  }

  protected EventHandlerFrame<Event> createEventHandlerFrame() {
    EventHandlerFrame<Event> frame = new EventHandlerFrame<>();

    frame.registerHandler(IdentifyPlayerEvent.class,
        (event) -> networkClient.sendPacket(new PlayerDescriptionPacket(event.playerInformation())));

    frame.registerHandler(ServerConnectedEvent.class,
        (event) -> eventBus.dispatch(new IdentifyPlayerEvent(new PlayerInformation(UUID.randomUUID(),
            UUID.randomUUID().toString()))));

    frame.registerHandler(PlayerJoinEvent.class,
        (event) -> networkClient.transition(new LobbyClientState(eventBus, networkClient)));

    frame.registerHandler(FillSlotsWithAiEvent.class, (event) -> networkClient.sendPacket(new FillSlotsWithAiPacket()));

    return frame;
  }
}

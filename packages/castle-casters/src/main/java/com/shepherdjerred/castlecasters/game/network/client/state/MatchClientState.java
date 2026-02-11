package com.shepherdjerred.castlecasters.game.network.client.state;

import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.events.handlers.EventHandlerFrame;
import com.shepherdjerred.castlecasters.game.event.events.TryDoTurnEvent;
import com.shepherdjerred.castlecasters.game.network.client.NetworkClient;
import com.shepherdjerred.castlecasters.network.packet.packets.DoTurnPacket;

public class MatchClientState extends AbstractNetworkClientState {

  public MatchClientState(EventBus<Event> eventBus,
                          NetworkClient networkClient) {
    super(eventBus, networkClient);
  }

  @Override
  protected EventHandlerFrame<Event> createEventHandlerFrame() {
    EventHandlerFrame<Event> frame = new EventHandlerFrame<>();

    frame.registerHandler(TryDoTurnEvent.class, (event) -> networkClient.sendPacket(new DoTurnPacket(event.turn())));

    return frame;
  }
}

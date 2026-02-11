package com.shepherdjerred.castlecasters.server.network.event.handlers;

import com.shepherdjerred.castlecasters.events.handlers.EventHandler;
import com.shepherdjerred.castlecasters.server.network.event.events.ClientDisconnectedEvent;
import lombok.AllArgsConstructor;

@AllArgsConstructor
public class ClientDisconnectedEventHandler implements EventHandler<ClientDisconnectedEvent> {

  @Override
  public void handle(ClientDisconnectedEvent clientDisconnectedEvent) {
  }
}

package com.shepherdjerred.castlecasters.server.network.event.handlers;

import com.shepherdjerred.castlecasters.events.handlers.EventHandler;
import com.shepherdjerred.castlecasters.server.network.event.events.ClientConnectedEvent;
import lombok.AllArgsConstructor;

@AllArgsConstructor
public class ClientConnectedEventHandler implements EventHandler<ClientConnectedEvent> {

  @Override
  public void handle(ClientConnectedEvent event) {
  }
}

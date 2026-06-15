package com.shepherdjerred.castlecasters.game.network.client.state;

import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.events.handlers.EventHandlerFrame;
import com.shepherdjerred.castlecasters.game.network.client.NetworkClient;
import lombok.extern.log4j.Log4j2;

@Log4j2
public abstract class AbstractNetworkClientState implements NetworkClientState {

  protected final NetworkClient networkClient;
  protected final EventBus<Event> eventBus;
  private final EventHandlerFrame<Event> eventHandlerFrame;

  public AbstractNetworkClientState(EventBus<Event> eventBus, NetworkClient networkClient) {
    this.eventBus = eventBus;
    this.eventHandlerFrame = createEventHandlerFrame();
    this.networkClient = networkClient;
  }

  protected abstract EventHandlerFrame<Event> createEventHandlerFrame();

  @Override
  public void enable() {
    log.info("Enabling {}", this);
    eventBus.registerHandlerFrame(eventHandlerFrame);
  }

  @Override
  public void disable() {
    log.info("Disabling {}", this);
    eventBus.removeHandlerFrame(eventHandlerFrame);
  }
}

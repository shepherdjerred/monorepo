package com.shepherdjerred.castlecasters.server.game.state;

import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.events.handlers.EventHandlerFrame;
import com.shepherdjerred.castlecasters.server.game.GameLogic;

public abstract class AbstractGameServerState implements GameServerState {

  protected final GameLogic gameLogic;
  protected final EventBus<Event> eventBus;
  private final EventHandlerFrame<Event> eventHandlerFrame;

  public AbstractGameServerState(GameLogic gameLogic, EventBus<Event> eventBus) {
    this.gameLogic = gameLogic;
    this.eventBus = eventBus;
    this.eventHandlerFrame = createEventHandlerFrame();
  }

  protected abstract EventHandlerFrame<Event> createEventHandlerFrame();

  @Override
  public void enable() {
    eventBus.registerHandlerFrame(eventHandlerFrame);
  }

  @Override
  public void disable() {
    eventBus.removeHandlerFrame(eventHandlerFrame);
  }
}

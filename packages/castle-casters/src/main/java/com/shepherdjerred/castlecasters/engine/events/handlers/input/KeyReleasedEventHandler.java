package com.shepherdjerred.castlecasters.engine.events.handlers.input;

import com.shepherdjerred.castlecasters.engine.events.ToggleBlendingEvent;
import com.shepherdjerred.castlecasters.engine.events.ToggleDepthEvent;
import com.shepherdjerred.castlecasters.engine.events.ToggleWireframeEvent;
import com.shepherdjerred.castlecasters.engine.events.input.KeyReleasedEvent;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.events.handlers.EventHandler;
import lombok.AllArgsConstructor;

import static com.shepherdjerred.castlecasters.engine.input.keyboard.Key.*;

@AllArgsConstructor
public class KeyReleasedEventHandler implements EventHandler<KeyReleasedEvent> {

  private final EventBus<Event> eventBus;

  @Override
  public void handle(KeyReleasedEvent keyReleasedEvent) {
    var key = keyReleasedEvent.key();
    if (key == ZERO) {
      eventBus.dispatch(new ToggleWireframeEvent());
    }
    if (key == NINE) {
      eventBus.dispatch(new ToggleBlendingEvent());
    }
    if (key == EIGHT) {
      eventBus.dispatch(new ToggleDepthEvent());
    }
  }
}

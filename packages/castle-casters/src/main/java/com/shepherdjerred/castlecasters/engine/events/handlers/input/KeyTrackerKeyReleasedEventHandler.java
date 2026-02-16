package com.shepherdjerred.castlecasters.engine.events.handlers.input;

import com.shepherdjerred.castlecasters.engine.events.input.KeyReleasedEvent;
import com.shepherdjerred.castlecasters.engine.input.keyboard.KeyTracker;
import com.shepherdjerred.castlecasters.events.handlers.EventHandler;
import lombok.AllArgsConstructor;

@AllArgsConstructor
public class KeyTrackerKeyReleasedEventHandler implements EventHandler<KeyReleasedEvent> {

  private final KeyTracker keyTracker;

  @Override
  public void handle(KeyReleasedEvent keyReleasedEvent) {
    keyTracker.setKeyAsUnpressed(keyReleasedEvent.key());
  }
}

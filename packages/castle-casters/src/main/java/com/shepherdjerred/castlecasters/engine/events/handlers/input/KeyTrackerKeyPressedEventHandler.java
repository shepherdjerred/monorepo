package com.shepherdjerred.castlecasters.engine.events.handlers.input;

import com.shepherdjerred.castlecasters.engine.events.input.KeyPressedEvent;
import com.shepherdjerred.castlecasters.engine.input.keyboard.KeyTracker;
import com.shepherdjerred.castlecasters.events.handlers.EventHandler;
import lombok.AllArgsConstructor;

@AllArgsConstructor
public class KeyTrackerKeyPressedEventHandler implements EventHandler<KeyPressedEvent> {

  private final KeyTracker keyTracker;

  @Override
  public void handle(KeyPressedEvent keyPressedEvent) {
    keyTracker.setKeyAsPressed(keyPressedEvent.key());
  }
}

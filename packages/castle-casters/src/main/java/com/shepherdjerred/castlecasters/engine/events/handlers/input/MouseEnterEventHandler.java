package com.shepherdjerred.castlecasters.engine.events.handlers.input;

import com.shepherdjerred.castlecasters.engine.events.input.MouseEnterEvent;
import com.shepherdjerred.castlecasters.engine.input.mouse.MouseTracker;
import com.shepherdjerred.castlecasters.events.handlers.EventHandler;
import lombok.AllArgsConstructor;

@AllArgsConstructor
public class MouseEnterEventHandler implements EventHandler<MouseEnterEvent> {

  private final MouseTracker mouseTracker;

  @Override
  public void handle(MouseEnterEvent mouseEnterEvent) {
    mouseTracker.setInWindow(true);
  }
}

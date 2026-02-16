package com.shepherdjerred.castlecasters.engine.events.handlers.input;

import com.shepherdjerred.castlecasters.engine.events.input.MouseMoveEvent;
import com.shepherdjerred.castlecasters.engine.input.mouse.MouseTracker;
import com.shepherdjerred.castlecasters.events.handlers.EventHandler;
import lombok.AllArgsConstructor;

@AllArgsConstructor
public class MouseMoveEventHandler implements EventHandler<MouseMoveEvent> {

  private final MouseTracker mouseTracker;

  @Override
  public void handle(MouseMoveEvent mouseMoveEvent) {
    mouseTracker.setMousePosition(mouseMoveEvent.newMousePosition());
  }
}

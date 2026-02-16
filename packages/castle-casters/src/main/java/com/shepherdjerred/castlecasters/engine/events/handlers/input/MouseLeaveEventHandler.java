package com.shepherdjerred.castlecasters.engine.events.handlers.input;

import com.shepherdjerred.castlecasters.engine.events.input.MouseLeaveEvent;
import com.shepherdjerred.castlecasters.engine.input.mouse.MouseTracker;
import com.shepherdjerred.castlecasters.events.handlers.EventHandler;
import lombok.AllArgsConstructor;

@AllArgsConstructor
public class MouseLeaveEventHandler implements EventHandler<MouseLeaveEvent> {

  private final MouseTracker mouseTracker;

  @Override
  public void handle(MouseLeaveEvent mouseLeaveEvent) {
    mouseTracker.setInWindow(false);
  }
}

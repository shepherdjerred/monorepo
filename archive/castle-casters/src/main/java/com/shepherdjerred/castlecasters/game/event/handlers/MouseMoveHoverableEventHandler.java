package com.shepherdjerred.castlecasters.game.event.handlers;

import com.shepherdjerred.castlecasters.engine.events.input.MouseMoveEvent;
import com.shepherdjerred.castlecasters.engine.scene.Scene;
import com.shepherdjerred.castlecasters.engine.scene.SceneCoordinate;
import com.shepherdjerred.castlecasters.engine.scene.attributes.Hoverable;
import com.shepherdjerred.castlecasters.events.handlers.EventHandler;
import lombok.AllArgsConstructor;

@AllArgsConstructor
public class MouseMoveHoverableEventHandler implements EventHandler<MouseMoveEvent> {

  private final Scene scene;

  @Override
  public void handle(MouseMoveEvent mouseMoveEvent) {
    scene.getGameObjects().forEach(element -> {
      var orig = mouseMoveEvent.newMousePosition();
      var coord = new SceneCoordinate(orig.x(), orig.y(), 0);
      if (element instanceof Hoverable) {
        if (((Hoverable) element).isHovered()) {
          if (!((Hoverable) element).contains(coord)) {
            ((Hoverable) element).onUnhover();
          }
        } else {
          if (((Hoverable) element).contains(coord)) {
            ((Hoverable) element).onHover();
          }
        }
      }
    });
  }
}

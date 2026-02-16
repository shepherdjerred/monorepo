package com.shepherdjerred.castlecasters.game.event.handlers;

import com.shepherdjerred.castlecasters.engine.events.input.MouseButtonDownEvent;
import com.shepherdjerred.castlecasters.engine.scene.Scene;
import com.shepherdjerred.castlecasters.engine.scene.SceneCoordinate;
import com.shepherdjerred.castlecasters.engine.scene.attributes.Clickable;
import com.shepherdjerred.castlecasters.events.handlers.EventHandler;
import lombok.AllArgsConstructor;

@AllArgsConstructor
public class MouseDownClickableHandler implements EventHandler<MouseButtonDownEvent> {

  private final Scene scene;

  @Override
  public void handle(MouseButtonDownEvent mouseButtonDownEvent) {
    scene.getGameObjects().forEach(element -> {
      if (element instanceof Clickable) {
        var orig = mouseButtonDownEvent.mouseCoordinate();
        var coord = new SceneCoordinate(orig.x(), orig.y(), 0);
        if (((Clickable) element).contains(coord)) {
          ((Clickable) element).onClickBegin();
        }
      }
    });
  }
}

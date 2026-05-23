package com.shepherdjerred.castlecasters.game.event.handlers;

import com.shepherdjerred.castlecasters.engine.events.input.MouseButtonUpEvent;
import com.shepherdjerred.castlecasters.engine.scene.Scene;
import com.shepherdjerred.castlecasters.engine.scene.attributes.Clickable;
import com.shepherdjerred.castlecasters.events.handlers.EventHandler;
import lombok.AllArgsConstructor;

@AllArgsConstructor
public class MouseUpClickableHandler implements EventHandler<MouseButtonUpEvent> {

  private final Scene scene;

  @Override
  public void handle(MouseButtonUpEvent mouseButtonUpEvent) {
    scene.getGameObjects().forEach(element -> {
      if (element instanceof Clickable) {
        if (((Clickable) element).isClicked()) {
          ((Clickable) element).onClickEnd();
        }
      }
    });
  }
}

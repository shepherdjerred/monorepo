package com.shepherdjerred.castlecasters.engine.events.handlers.scene;

import com.shepherdjerred.castlecasters.engine.events.scene.SceneTransitionEvent;
import com.shepherdjerred.castlecasters.engine.scene.SceneTransitioner;
import com.shepherdjerred.castlecasters.events.handlers.EventHandler;
import lombok.AllArgsConstructor;

@AllArgsConstructor
public class SceneTransitionEventHandler implements EventHandler<SceneTransitionEvent> {

  private final SceneTransitioner sceneTransitioner;

  @Override
  public void handle(SceneTransitionEvent sceneTransitionEvent) {
    try {
      sceneTransitioner.transition(sceneTransitionEvent.newScene());
    } catch (Exception e) {
      throw new RuntimeException("Error transitioning scenes", e);
    }
  }
}

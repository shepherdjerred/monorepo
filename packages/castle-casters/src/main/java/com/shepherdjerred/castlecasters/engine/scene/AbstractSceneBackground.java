package com.shepherdjerred.castlecasters.engine.scene;

import com.shepherdjerred.castlecasters.engine.object.AbstractGameObject;
import com.shepherdjerred.castlecasters.engine.object.GameObjectRenderer;
import com.shepherdjerred.castlecasters.engine.object.SceneObjectDimensions;
import com.shepherdjerred.castlecasters.engine.scene.position.BackgroundScenePositioner;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import lombok.Setter;

@Setter
public class AbstractSceneBackground extends AbstractGameObject {

  private boolean isCleanupDisabled;

  public AbstractSceneBackground(GameObjectRenderer<?> renderer, WindowSize windowSize) {
    super(renderer,
        new SceneObjectDimensions(windowSize.width(), windowSize.height()),
        new BackgroundScenePositioner());
  }

  @Override
  public void cleanup() {
    if (!isCleanupDisabled) {
      super.cleanup();
    }
  }
}

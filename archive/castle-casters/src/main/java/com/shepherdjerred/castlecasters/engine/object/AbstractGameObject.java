package com.shepherdjerred.castlecasters.engine.object;

import com.shepherdjerred.castlecasters.engine.scene.position.ScenePositioner;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import lombok.Getter;
import lombok.Setter;

public abstract class AbstractGameObject implements GameObject {

  private final GameObjectRenderer renderer;
  @Getter
  private final SceneObjectDimensions sceneObjectDimensions;
  @Getter
  private boolean isInitialized;
  @Setter
  @Getter
  private ScenePositioner position;

  public AbstractGameObject(GameObjectRenderer renderer,
                            SceneObjectDimensions sceneObjectDimensions,
                            ScenePositioner position) {
    this.renderer = renderer;
    this.sceneObjectDimensions = sceneObjectDimensions;
    this.position = position;
  }

  @Override
  public void initialize() throws Exception {
    isInitialized = true;
    renderer.initialize(this);
  }

  @Override
  public void cleanup() {
    renderer.cleanup();
    isInitialized = false;
  }

  @Override
  public void render(WindowSize windowSize) {
    if (!isInitialized) {
      throw new IllegalStateException("Object not initialized");
    }
    renderer.render(windowSize, this);
  }

  @Override
  public void update(float interval) {

  }
}

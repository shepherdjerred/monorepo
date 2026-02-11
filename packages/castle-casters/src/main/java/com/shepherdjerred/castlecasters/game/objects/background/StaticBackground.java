package com.shepherdjerred.castlecasters.game.objects.background;

import com.shepherdjerred.castlecasters.engine.object.GameObject;
import com.shepherdjerred.castlecasters.engine.object.GameObjectRenderer;
import com.shepherdjerred.castlecasters.engine.object.SceneObjectDimensions;
import com.shepherdjerred.castlecasters.engine.scene.position.ScenePositioner;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.Setter;
import lombok.ToString;

/**
 * A background spanning the entire window.
 */
@Getter
@ToString
@AllArgsConstructor
public class StaticBackground implements GameObject {

  private final GameObjectRenderer<StaticBackground> renderer;
  private final Type type;
  private boolean isInitialized;
  @Setter
  private ScenePositioner position;

  public StaticBackground(GameObjectRenderer<StaticBackground> renderer,
                          ScenePositioner position,
                          Type type) {
    this.renderer = renderer;
    this.position = position;
    this.type = type;
  }

  @Override
  public void initialize() throws Exception {
    renderer.initialize(this);
    isInitialized = true;
  }

  @Override
  public void cleanup() {
    isInitialized = false;
    renderer.cleanup();
  }

  @Override
  public SceneObjectDimensions getSceneObjectDimensions() {
    // TODO?
    return new SceneObjectDimensions(0, 0);
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

  public enum Type {
    PURPLE_MOUNTAINS,
    RED_PLAINS
  }
}

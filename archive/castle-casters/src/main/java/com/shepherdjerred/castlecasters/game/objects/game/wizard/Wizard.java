package com.shepherdjerred.castlecasters.game.objects.game.wizard;

import com.shepherdjerred.castlecasters.common.player.Element;
import com.shepherdjerred.castlecasters.engine.object.GameObject;
import com.shepherdjerred.castlecasters.engine.object.GameObjectRenderer;
import com.shepherdjerred.castlecasters.engine.object.SceneObjectDimensions;
import com.shepherdjerred.castlecasters.engine.resource.ResourceManager;
import com.shepherdjerred.castlecasters.engine.scene.position.ScenePositioner;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import lombok.Getter;
import lombok.Setter;

public class Wizard implements GameObject {

  private final GameObjectRenderer<Wizard> renderer;
  @Getter
  private final Element element;
  @Getter
  private final SceneObjectDimensions sceneObjectDimensions;
  @Getter
  private boolean isInitialized;
  @Getter
  @Setter
  private ScenePositioner position;
  @Setter
  @Getter
  private State state;
  @Getter
  private int frame;
  private float frameAccumulator;

  public Wizard(ResourceManager resourceManager,
                ScenePositioner position,
                Element element,
                SceneObjectDimensions sceneObjectDimensions) {
    this.position = position;
    this.renderer = new WizardRenderer(resourceManager);
    this.element = element;
    this.state = State.STILL;
    this.frame = 0;
    this.sceneObjectDimensions = sceneObjectDimensions;
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
  public void render(WindowSize windowSize) {
    if (!isInitialized) {
      throw new IllegalStateException("Object not initialized");
    }
    renderer.render(windowSize, this);
  }

  @Override
  public void update(float interval) {
    frameAccumulator += interval * 3;
    int maxFrames;
    if (state == State.STILL) {
      maxFrames = 3;
    } else if (state == State.CASTING) {
      maxFrames = 7;
    } else {
      maxFrames = 3;
    }
    frame = (int) frameAccumulator;
    if (frame > maxFrames - 1) {
      frame = 0;
      frameAccumulator = 0;
    }
  }

  public SpriteState getSpriteState() {
    return new SpriteState(state, frame);
  }

  public enum State {
    STILL, CASTING, WALKING_UP, WALKING_DOWN, WALKING_LEFT, WALKING_RIGHT
  }

  public record SpriteState(State state, int frame) {

  }
}

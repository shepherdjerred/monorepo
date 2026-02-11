package com.shepherdjerred.castlecasters.game.objects.button;

import com.shepherdjerred.castlecasters.engine.collision.GameObjectCollisionDetector;
import com.shepherdjerred.castlecasters.engine.object.ClickableAbstractGameObject;
import com.shepherdjerred.castlecasters.engine.object.SceneObjectDimensions;
import com.shepherdjerred.castlecasters.engine.resource.ResourceManager;
import com.shepherdjerred.castlecasters.engine.scene.position.ScenePositioner;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import lombok.Getter;
import lombok.ToString;

@Getter
@ToString
public class Button extends ClickableAbstractGameObject {

  private final Type type;

  public Button(ResourceManager resourceManager,
                WindowSize windowSize,
                ScenePositioner position,
                SceneObjectDimensions sceneObjectDimensions,
                Type type,
                Runnable onClick) {
    super(new ButtonRenderer(resourceManager), sceneObjectDimensions, position, null, onClick);
    this.type = type;
    setCollisionDetector(new GameObjectCollisionDetector(this, windowSize));
  }

  public enum Type {
    HOME,
    GENERIC
  }
}

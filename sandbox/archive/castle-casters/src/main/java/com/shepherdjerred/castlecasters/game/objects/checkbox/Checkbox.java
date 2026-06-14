package com.shepherdjerred.castlecasters.game.objects.checkbox;

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
public class Checkbox extends ClickableAbstractGameObject {

  private boolean isChecked;

  public Checkbox(ResourceManager resourceManager,
                  WindowSize windowSize,
                  ScenePositioner position,
                  SceneObjectDimensions sceneObjectDimensions,
                  Runnable onClick) {
    super(new CheckboxRenderer(resourceManager), sceneObjectDimensions, position, null, onClick);
    setCollisionDetector(new GameObjectCollisionDetector(this, windowSize));
  }

  @Override
  public void onClickBegin() {
    super.onClickBegin();
    this.isChecked = !this.isChecked;
  }
}

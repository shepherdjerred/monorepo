package com.shepherdjerred.castlecasters.game.objects.game.wall;

import com.shepherdjerred.castlecasters.engine.object.AbstractGameObject;
import com.shepherdjerred.castlecasters.engine.object.SceneObjectDimensions;
import com.shepherdjerred.castlecasters.engine.resource.ResourceManager;
import com.shepherdjerred.castlecasters.engine.scene.position.ScenePositioner;

public class Wall extends AbstractGameObject {

  public Wall(ResourceManager resourceManager,
              SceneObjectDimensions sceneObjectDimensions,
              ScenePositioner position) {
    super(new WallRenderer(resourceManager), sceneObjectDimensions, position);
  }
}

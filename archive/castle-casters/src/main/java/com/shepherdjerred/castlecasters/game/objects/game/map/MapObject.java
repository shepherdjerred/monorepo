package com.shepherdjerred.castlecasters.game.objects.game.map;

import com.shepherdjerred.castlecasters.engine.map.GameMapName;
import com.shepherdjerred.castlecasters.engine.map.MapLayers;
import com.shepherdjerred.castlecasters.engine.object.GameObject;
import com.shepherdjerred.castlecasters.engine.object.SceneObjectDimensions;
import com.shepherdjerred.castlecasters.engine.resource.ResourceManager;
import com.shepherdjerred.castlecasters.engine.scene.SceneCoordinate;
import com.shepherdjerred.castlecasters.engine.scene.position.AbsoluteScenePositioner;
import com.shepherdjerred.castlecasters.engine.scene.position.SceneCoordinateOffset;
import com.shepherdjerred.castlecasters.engine.scene.position.ScenePositioner;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import lombok.Getter;
import lombok.Setter;

public class MapObject implements GameObject {

  private final ResourceManager resourceManager;
  private final MapRenderer mapRenderer;
  private final GameMapName gameMapName;
  @Getter
  private boolean isInitialized;
  @Getter
  private MapLayers mapLayers;
  @Getter
  @Setter
  private int xOffset;
  @Getter
  @Setter
  private int yOffset;

  public MapObject(ResourceManager resourceManager,
                   GameMapName gameMapName) {
    this.resourceManager = resourceManager;
    this.gameMapName = gameMapName;
    this.mapRenderer = new MapRenderer(resourceManager);
  }

  @Override
  public void initialize() throws Exception {
    mapLayers = resourceManager.get(gameMapName);
    mapRenderer.initialize(this);
    isInitialized = true;
  }

  @Override
  public void cleanup() {
    isInitialized = false;
    mapRenderer.cleanup();
    resourceManager.free(gameMapName);
  }

  @Override
  public SceneObjectDimensions getSceneObjectDimensions() {
    return new SceneObjectDimensions(0, 0);
  }

  @Override
  public ScenePositioner getPosition() {
    return new AbsoluteScenePositioner(new SceneCoordinate(0, 0, 0),
        new SceneCoordinateOffset(0, 0));
  }

  @Override
  public void setPosition(ScenePositioner scenePositioner) {
  }

  @Override
  public void render(WindowSize windowSize) {
    if (!isInitialized) {
      throw new IllegalStateException("Object not initialized");
    }
    mapRenderer.render(windowSize, this);
  }

  @Override
  public void update(float interval) {
  }
}

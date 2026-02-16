package com.shepherdjerred.castlecasters.engine.scene;

import com.shepherdjerred.castlecasters.engine.object.GameObject;
import com.shepherdjerred.castlecasters.engine.resource.ResourceManager;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import com.shepherdjerred.castlecasters.game.objects.background.parallax.ParallaxBackground;

import java.util.LinkedHashSet;
import java.util.Set;

public abstract class AbstractUIScene implements UIScene {

  protected final ResourceManager resourceManager;
  protected final WindowSize windowSize;
  protected final Set<GameObject> gameObjects;
  private final SceneRenderer sceneRenderer;
  protected ParallaxBackground background;

  public AbstractUIScene(ResourceManager resourceManager,
                         WindowSize windowSize,
                         SceneRenderer sceneRenderer) {
    this.resourceManager = resourceManager;
    this.windowSize = windowSize;
    this.sceneRenderer = sceneRenderer;
    this.gameObjects = new LinkedHashSet<>();
    background = null;
  }

  public Set<GameObject> getGameObjects() {
    var objects = new LinkedHashSet<>(gameObjects);
    if (background != null) {
      objects.add(background);
    }
    return objects;
  }

  protected abstract Set<GameObject> createGameObjects();

  @Override
  public void initialize() throws Exception {
    gameObjects.addAll(createGameObjects());
    sceneRenderer.initialize(this);
    for (GameObject gameObject : getGameObjects()) {
      gameObject.initialize();
    }
  }

  @Override
  public void render(WindowSize windowSize) {
    sceneRenderer.render(this);
  }

  @Override
  public void cleanup() {
    getGameObjects().forEach(GameObject::cleanup);
    sceneRenderer.cleanup();
  }

  @Override
  public void updateState(float interval) {
    getGameObjects().forEach(gameObject -> gameObject.update(interval));
  }

}

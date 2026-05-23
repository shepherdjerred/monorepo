package com.shepherdjerred.castlecasters.engine.scene;

/**
 * Renders an entire scenes on the screen.
 */
public interface SceneRenderer<T extends Scene> {

  void initialize(T scene) throws Exception;

  void render(T scene);

  void cleanup();
}

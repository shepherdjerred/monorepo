package com.shepherdjerred.castlecasters.engine.scene;

import com.shepherdjerred.castlecasters.engine.object.GameObject;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;

import java.util.Set;

public interface Scene {

  void initialize() throws Exception;

  void cleanup();

  void updateState(float interval);

  Set<GameObject> getGameObjects();

  void render(WindowSize windowSize);

}

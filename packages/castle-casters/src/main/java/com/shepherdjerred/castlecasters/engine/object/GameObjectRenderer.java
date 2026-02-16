package com.shepherdjerred.castlecasters.engine.object;

import com.shepherdjerred.castlecasters.engine.window.WindowSize;

public interface GameObjectRenderer<T extends GameObject> {

  void initialize(T gameObject) throws Exception;

  void render(WindowSize windowSize, T gameObject);

  void cleanup();
}

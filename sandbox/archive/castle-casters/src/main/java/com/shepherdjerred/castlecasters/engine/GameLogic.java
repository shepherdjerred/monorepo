package com.shepherdjerred.castlecasters.engine;

import com.shepherdjerred.castlecasters.engine.window.WindowSize;

public interface GameLogic {

  void initialize(WindowSize windowSize) throws Exception;

  void updateGameState(float interval);

  void render();

  void cleanup();
}

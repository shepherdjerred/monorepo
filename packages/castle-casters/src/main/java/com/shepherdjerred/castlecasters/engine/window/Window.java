package com.shepherdjerred.castlecasters.engine.window;

public interface Window {

  void initialize();

  boolean shouldClose();

  void swapBuffers();

  void pollEvents();

  WindowSettings getWindowSettings();

  void cleanup();
}

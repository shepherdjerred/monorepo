package com.shepherdjerred.castlecasters.engine.window;

public record WindowSettings(String title, WindowSize windowSize, boolean isVsyncEnabled, boolean isDebugEnabled, boolean visible) {
  public WindowSettings(String title, WindowSize size, boolean vsync, boolean debug) { this(title, size, vsync, debug, true); }
}

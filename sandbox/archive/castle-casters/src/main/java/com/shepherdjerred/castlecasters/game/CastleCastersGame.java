package com.shepherdjerred.castlecasters.game;

import com.shepherdjerred.castlecasters.engine.InspectableGame;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import com.shepherdjerred.castlecasters.events.*;
import com.shepherdjerred.castlecasters.game.desktop.DesktopGame;
import java.util.Map;

/** Public engine entrypoint retained for the original game. */
public final class CastleCastersGame implements InspectableGame {
  private final DesktopGame desktop;

  public CastleCastersGame(EventBus<Event> events) {
    desktop = new DesktopGame(events);
  }

  public CastleCastersGame(EventBus<Event> events, boolean muted) {
    desktop = new DesktopGame(events, muted);
  }

  public void initialize(WindowSize size) throws Exception {
    desktop.initialize(size);
  }

  public void updateGameState(float interval) {
    desktop.updateGameState(interval);
  }

  public void render() {
    desktop.render();
  }

  public void cleanup() {
    desktop.cleanup();
  }

  public Map<String, Object> inspect() {
    return desktop.inspect();
  }

  public void scenario(String name, long seed) {
    desktop.scenario(name, seed);
  }

  public void interruptConnection() {
    desktop.interruptConnection();
  }
}

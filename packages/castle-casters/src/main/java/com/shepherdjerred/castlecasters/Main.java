package com.shepherdjerred.castlecasters;

import com.shepherdjerred.castlecasters.engine.GameEngine;
import com.shepherdjerred.castlecasters.engine.window.WindowSettings;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.game.CastleCastersGame;
import lombok.extern.log4j.Log4j2;

@Log4j2
public class Main {

  private static final EventBus<Event> eventBus = new EventBus<>();

  public static void main(String[] args) {
    try {
      run();
    } catch (Exception e) {
      log.catching(e);
      log.error(e);
      System.exit(1);
    }
  }

  private static void run() {
    var settings = getSettings();
    var logic = new CastleCastersGame(eventBus);
    var engine = new GameEngine(logic, settings, eventBus);
    engine.run();
  }

  private static WindowSettings getSettings() {
    return new WindowSettings("Castle Casters",
        new WindowSize(1360, 768),
        true,
        true);
  }
}

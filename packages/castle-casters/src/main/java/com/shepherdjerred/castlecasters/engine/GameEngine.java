package com.shepherdjerred.castlecasters.engine;

import com.shepherdjerred.castlecasters.engine.events.ToggleBlendingEvent;
import com.shepherdjerred.castlecasters.engine.events.ToggleDepthEvent;
import com.shepherdjerred.castlecasters.engine.events.ToggleWireframeEvent;
import com.shepherdjerred.castlecasters.engine.events.WindowResizeEvent;
import com.shepherdjerred.castlecasters.engine.events.handlers.OpenGlWindowResizeHandler;
import com.shepherdjerred.castlecasters.engine.events.handlers.ToggleBlendingEventHandler;
import com.shepherdjerred.castlecasters.engine.events.handlers.ToggleDepthEventHandler;
import com.shepherdjerred.castlecasters.engine.events.handlers.ToggleWireframeEventHandler;
import com.shepherdjerred.castlecasters.engine.events.handlers.input.KeyReleasedEventHandler;
import com.shepherdjerred.castlecasters.engine.events.handlers.input.MouseMoveEventHandler;
import com.shepherdjerred.castlecasters.engine.events.input.KeyReleasedEvent;
import com.shepherdjerred.castlecasters.engine.events.input.MouseMoveEvent;
import com.shepherdjerred.castlecasters.engine.input.mouse.MouseCoordinate;
import com.shepherdjerred.castlecasters.engine.input.mouse.MouseTracker;
import com.shepherdjerred.castlecasters.engine.window.GlfwWindow;
import com.shepherdjerred.castlecasters.engine.window.Window;
import com.shepherdjerred.castlecasters.engine.window.WindowSettings;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.events.handlers.EventLoggerHandler;
import lombok.extern.log4j.Log4j2;

import java.util.Set;

@Log4j2
public class GameEngine {

  private static final int TARGET_FRAMES_PER_SECOND = 60;
  private static final int TARGET_UPDATES_PER_SECOND = 20;

  private final Window window;
  private final EventBus<Event> eventBus;
  private final MouseTracker mouseTracker;
  private final GameLoop gameLoop;

  public GameEngine(GameLogic gameLogic, WindowSettings windowSettings, EventBus<Event> eventBus) {
    this.eventBus = eventBus;
    this.mouseTracker = new MouseTracker(false, new MouseCoordinate(-1, -1));
    window = new GlfwWindow(windowSettings, mouseTracker, eventBus);
    gameLoop = new GameLoop(gameLogic,
        window,
        TARGET_FRAMES_PER_SECOND,
        TARGET_UPDATES_PER_SECOND);
  }

  public void run() {
    initialize();
    gameLoop.start();
  }

  private void initialize() {
    registerEventHandlers();
  }

  private void registerEventHandlers() {
    eventBus.registerHandler(new EventLoggerHandler<>(Set.of(MouseMoveEvent.class)));
    eventBus.registerHandler(WindowResizeEvent.class, new OpenGlWindowResizeHandler());
    eventBus.registerHandler(MouseMoveEvent.class, new MouseMoveEventHandler(mouseTracker));
    eventBus.registerHandler(ToggleWireframeEvent.class, new ToggleWireframeEventHandler());
    eventBus.registerHandler(ToggleBlendingEvent.class, new ToggleBlendingEventHandler());
    eventBus.registerHandler(KeyReleasedEvent.class, new KeyReleasedEventHandler(eventBus));
    eventBus.registerHandler(ToggleDepthEvent.class, new ToggleDepthEventHandler());
  }
}

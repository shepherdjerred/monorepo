package com.shepherdjerred.castlecasters.engine;

import com.shepherdjerred.castlecasters.engine.graphics.ErrorConverter;
import com.shepherdjerred.castlecasters.engine.window.Window;
import lombok.extern.log4j.Log4j2;

import static org.lwjgl.openal.AL10.AL_NO_ERROR;
import static org.lwjgl.openal.AL10.alGetError;
import static org.lwjgl.opengl.GL11.glGetError;

@Log4j2
public class GameLoop implements Runnable {

  private final GameLogic gameLogic;
  private final Window window;
  private final Timer timer;
  private final Thread gameLoopThread;
  private final int targetFramesPerSecond;
  private final int targetUpdatesPerSecond;

  public GameLoop(GameLogic gameLogic,
                  Window window,
                  int targetFramesPerSecond,
                  int targetUpdatesPerSecond) {
    this.gameLogic = gameLogic;
    this.window = window;
    this.timer = new Timer();
    gameLoopThread = new Thread(this, "GAME_LOOP_THREAD");
    this.targetFramesPerSecond = targetFramesPerSecond;
    this.targetUpdatesPerSecond = targetUpdatesPerSecond;
  }

  public void initialize() throws Exception {
    window.initialize();
    gameLogic.initialize(window.getWindowSettings().windowSize());
  }

  private void sync() {
    float loopSlot = 1f / targetFramesPerSecond;
    double endTime = timer.getLastLoopTime() + loopSlot;
    while (timer.getTime() < endTime) {
      try {
        //noinspection BusyWait
        Thread.sleep(1);
      } catch (InterruptedException ignored) {
      }
    }
  }

  private void updateGameState(float interval) {
    gameLogic.updateGameState(interval);
  }

  private void render() {
    gameLogic.render();
    window.swapBuffers();
    window.pollEvents();
  }

  private void cleanup() {
    gameLogic.cleanup();
    window.cleanup();
  }

  @Override
  public void run() {
    try {
      initialize();
      runGameLoop();
    } catch (Exception e) {
      log.catching(e);
    } finally {
      cleanup();
    }
  }

  private void runGameLoop() {
    float elapsedTime;
    float accumulator = 0f;
    float updateInterval = 1f / targetUpdatesPerSecond;

    while (!window.shouldClose()) {
      elapsedTime = timer.getElapsedTime();
      accumulator += elapsedTime;

      while (accumulator >= updateInterval) {
        updateGameState(updateInterval);
        accumulator -= updateInterval;
      }

      render();

      if (!window.getWindowSettings().isVsyncEnabled()) {
        sync();
      }

      printOpenGlErrors();
      printOpenAlErrors();
    }
  }

  public void start() {
    if (isOperatingSystemMacOs()) {
      //noinspection CallToThreadRun
      gameLoopThread.run();
    } else {
      gameLoopThread.start();
    }
  }

  private void printOpenGlErrors() {
    int errCode = glGetError();
    if (errCode != 0) {
      var converter = new ErrorConverter();
      log.error("OpenGL error: {}", converter.convert(errCode));
    }
  }

  private void printOpenAlErrors() {
    int error = alGetError();
    if (error != AL_NO_ERROR) {
      log.error("OpenAL error: {}", error);
    }
  }

  private boolean isOperatingSystemMacOs() {
    return System.getProperty("os.name").contains("Mac");
  }
}

package com.shepherdjerred.thestorm.tracks.adapter.paper;

import com.shepherdjerred.thestorm.core.text.HouseStyle;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.function.Consumer;
import net.kyori.adventure.audience.Audience;
import net.kyori.adventure.text.Component;
import org.slf4j.Logger;

/**
 * Track messages in the house style, and the one way this adapter waits for work: a future
 * completed back onto the main thread, never joined.
 */
final class Replies {

  static final String LABEL = "Tracks";

  private final Executor mainThread;
  private final Logger logger;

  Replies(Executor mainThread, Logger logger) {
    this.mainThread = mainThread;
    this.logger = logger;
  }

  static Component info(String message) {
    return HouseStyle.info(LABEL, Component.text(message));
  }

  static Component info(Component message) {
    return HouseStyle.info(LABEL, message);
  }

  static Component success(String message) {
    return HouseStyle.success(LABEL, Component.text(message));
  }

  static Component error(String message) {
    return HouseStyle.error(LABEL, Component.text(message));
  }

  /**
   * Runs {@code onValue} on the main thread once {@code future} completes. A failed future, or an
   * exception thrown by {@code onValue}, is logged and {@code audience} is told something went
   * wrong; no failure is dropped.
   */
  <T> void whenDone(CompletableFuture<T> future, Audience audience, Consumer<T> onValue) {
    var _ =
        future.whenCompleteAsync(
            (value, failure) -> {
              if (failure != null) {
                fail(audience, failure);
                return;
              }
              try {
                onValue.accept(value);
              } catch (RuntimeException e) {
                fail(audience, e);
              }
            },
            mainThread);
  }

  private void fail(Audience audience, Throwable failure) {
    logger.error("Tracks operation failed", failure);
    audience.sendMessage(error("Tracks are unavailable right now; try again."));
  }
}

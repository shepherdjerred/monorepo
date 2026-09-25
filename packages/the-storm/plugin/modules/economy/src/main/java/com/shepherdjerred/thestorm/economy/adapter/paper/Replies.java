package com.shepherdjerred.thestorm.economy.adapter.paper;

import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import net.kyori.adventure.audience.Audience;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;

/**
 * Economy messages in the house style, and the one way this adapter waits for the ledger: a future
 * completed back onto the main thread, never joined.
 */
final class Replies {

  static final String LABEL = "Crystals";

  private final Scheduler scheduler;
  private final ComponentLogger logger;

  Replies(Scheduler scheduler, ComponentLogger logger) {
    this.scheduler = scheduler;
    this.logger = logger;
  }

  static Component info(String message) {
    return HouseStyle.info(LABEL, Component.text(message));
  }

  static Component success(String message) {
    return HouseStyle.success(LABEL, Component.text(message));
  }

  static Component error(String message) {
    return HouseStyle.error(LABEL, Component.text(message));
  }

  /**
   * Runs {@code onValue} on the main thread once {@code future} completes. A failure is logged and
   * {@code audience} is told the ledger could not be reached.
   */
  <T> void whenDone(CompletableFuture<T> future, Audience audience, Consumer<T> onValue) {
    var _ =
        future.whenCompleteAsync(
            (value, failure) -> {
              if (failure == null) {
                onValue.accept(value);
              } else {
                logger.error("Economy operation failed", failure);
                audience.sendMessage(error("The ledger is unavailable right now; try again."));
              }
            },
            scheduler.mainThread());
  }
}

package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;

/** Hands storage results back to the main thread, logging every failure. */
public final class Async {

  private final Scheduler scheduler;
  private final ComponentLogger logger;

  public Async(Scheduler scheduler, ComponentLogger logger) {
    this.scheduler = scheduler;
    this.logger = logger;
  }

  /**
   * Runs {@code then} on the main thread with {@code future}'s value. A failure (of the future or
   * of {@code then}) is logged and handed to {@code failed} on the main thread.
   */
  <T> void onMain(
      CompletableFuture<T> future, String what, Consumer<T> then, Consumer<Throwable> failed) {
    var _ =
        future.whenCompleteAsync(
            (value, failure) -> {
              if (failure != null) {
                logger.error("Failed {}", what, failure);
                failed.accept(failure);
                return;
              }
              try {
                then.accept(value);
              } catch (RuntimeException e) {
                logger.error("Failed {}", what, e);
                failed.accept(e);
              }
            },
            scheduler.mainThread());
  }

  /** {@link #onMain(CompletableFuture, String, Consumer, Consumer)} that only logs failures. */
  <T> void onMain(CompletableFuture<T> future, String what, Consumer<T> then) {
    onMain(future, what, then, failure -> {});
  }

  /** Logs {@code future}'s failure, if any. For writes nobody waits on. */
  void logFailure(CompletableFuture<?> future, String what) {
    var _ =
        future.whenComplete(
            (value, failure) -> {
              if (failure != null) {
                logger.error("Failed {}", what, failure);
              }
            });
  }

  ComponentLogger logger() {
    return logger;
  }
}

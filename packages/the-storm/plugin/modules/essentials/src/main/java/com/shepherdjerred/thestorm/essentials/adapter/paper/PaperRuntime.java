package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import java.time.InstantSource;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.function.Consumer;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.Server;

/**
 * What the Paper adapters share: the server, the main-thread scheduler, the clock and the logger.
 *
 * @param server the server
 * @param scheduler main-thread scheduling
 * @param time the clock
 * @param logger the module logger
 */
public record PaperRuntime(
    Server server, Scheduler scheduler, InstantSource time, ComponentLogger logger) {

  /**
   * Runs {@code then} on the main thread with the result of {@code future}. If the future fails, or
   * {@code then} throws, the failure is logged and handed to {@code failed} on the main thread.
   */
  <T> void onMain(
      CompletableFuture<T> future, String what, Consumer<T> then, Consumer<Throwable> failed) {
    var _ =
        future.whenCompleteAsync(
            (value, failure) -> {
              if (failure != null) {
                report(what, failure);
                failed.accept(failure);
                return;
              }
              try {
                then.accept(value);
              } catch (RuntimeException e) {
                report(what, e);
                failed.accept(e);
              }
            },
            main());
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
                report(what, failure);
              }
            });
  }

  /** Logs a failed background task. */
  void report(String what, Throwable failure) {
    logger.error(Component.text("essentials: " + what + " failed"), failure);
  }

  /** The main thread, as an executor. */
  Executor main() {
    return scheduler.mainThread();
  }
}
